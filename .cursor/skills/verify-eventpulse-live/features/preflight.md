# Preflight — världen mäts innan kedjan startar

## Sub-features

- **`scripts/lib/preflight.mjs`** — körsviten. Anropas från
  `scripts/ingestion-cron.ts` (före stegloopen) och från
  `scripts/cron/runPostIngest.sh` (kl 04:00).
- **`scripts/verify-preflight.mjs`** — gate L1. Kör både den levande världen
  och en simulerat trasig värld.
- **Hårda kontroller** (blockerar kedjan → exit 69): `redis-tcp`,
  `redis-ping`, `dns-supabase`, `supabase-rest`, `keys`,
  `env-parse`.
- **Mjuka kontroller** (rapporteras, blockerar inte): `dns`,
  `egress-tcp`, `keys-third-party` (tredjepart: Exa + ScrapingBee),
  `local-servers` (7777 supervisor + 7778 analytics). `local-servers`
  blir hård med `--require-local-servers`. Tredjepart blir hård med
  `--strict-preflight`.
- **Artefakter:** `runtime/ingestion-cron/preflight-<TS>.json` och en rad i
  `runtime/ingestion-cron/chain-overview.log` (`preflight-ok` /
  `preflight-fail`).

### Varför tredjepart är mjuk (2026-10-28)

Exa och ScrapingBee är inte kedjans stomme — de flesta stegen klarar sig
utan dem. En tredjepartsoutage som stoppade hela kedjan (exit 69) gjorde
att NOLL events importerades, trots att Redis och Supabase var friska.
Det är värre än en röd kedja: en kedja som tyst producerar ingenting.

Nu är tredjepart mjukt som standard — kedjan startar, och de steg som
faktiskt behöver tjänsten faller med sin egen felklass (kedjan går RÖD,
men de övriga stegen producerar events). Redis och Supabase är hårda
oavsett: utan dem sparas ingenting.

### Varför (2026-10-28)

Tre nätter i rad (26–28 okt) loggade kedjan "klart" med 0 events.
Rotorsaken: nätverksstacken dog (`EADDRNOTAVAIL` mot både `127.0.0.1:6379`
och externa värdar) och ingen HTTP-status nåddes — kodens felhantering
översatte det tysta transportfelet till "klar". Kedjan behövde inte veta
*varför* världen var trasig; den behövde sluta ljuga.

### Utan preflight, med

| Kontroll | Vad den mäter | Utan |
|---|---|---|
| `redis-tcp` | TCP-connect mot `REDIS_URL` (3 s) | `EADDRNOTAVAIL` dyker upp först i BullMQ |
| `redis-ping` | `PING` via IORedis (`enableOfflineQueue:false`, 5 s) | Kommandon liggar i offline-kön |
| `dns` | `api.exa.ai`, `app.scrapingbee.com` (mjuk) | NXDOMAIN efter 30 s retry |
| `dns-supabase` | Supabase-värden (hård) | Kedjan kör mot en död databas |
| `egress-tcp` | TLS-connect mot port 443 (3 s, mjuk) | Fångar `EADDRNOTAVAIL` utan HTTP-status |
| `supabase-rest` | `GET {SUPABASE_URL}/rest/v1/` (8 s) | 200 **eller 401** = nåbar |
| `keys` | `SUPABASE_SERVICE_ROLE_KEY` finns (hård) | Auth-fel efter 20 min |
| `keys-third-party` | Exa + ScrapingBee-nycklar (mjuk) | Auth-fel efter 20 min |
| `env-parse` | `.env` har 0 olåsta rader | `unknown command "TOKEN2"` i launchd |

**Varje kontroll har EGEN tidsgräns.** Ingen kontroll kan hänga kedjan.

## How to get to it (user POV)

"Natten igen? Är den igång?"

Preflight svarar på det innan något dyrt startar. Om världen är trasig svarar
kedjan med "jag kör inte, här är vad som är trasigt" i stället för att
ligga och vänta i två timmar. Det syns i dashboarden (7777) som röd status
med en tydlig orsak.

## Driving it

```bash
cd /Users/claudgashi/EventPulse

# Gate L1 — båda delarna
node scripts/verify-preflight.mjs

# Bara den levande världen
node scripts/verify-preflight.mjs --only live

# Bara simuleringen
node scripts/verify-preflight.mjs --only simulate-network-down

# Fristående preflight (skriver artefakter, exit 0/69)
node scripts/lib/preflight.mjs
```

**Förväntad utdata (levande värld):**

```
[verify-preflight] LIVE — alla hårda kontroller mot den levande världen
── live ──
  [OK  ] hard  redis-tcp         5ms  tcp localhost:6379 OK
  [OK  ] hard  redis-ping       14ms  PING → PONG
  [OK  ] soft  dns             318ms  2 värdar slås upp
  [OK  ] hard  dns-supabase     56ms  supabase-värd …supabase.co slås upp
  [OK  ] soft  egress-tcp      312ms  2 värdar svarar på 443
  [OK  ] hard  supabase-rest   716ms  Supabase REST svarade 200
  [OK  ] soft  keys-third-party   0ms  2 nycklar finns
  [OK  ] hard  keys               0ms  SUPABASE_SERVICE_ROLE_KEY finns
  [OK  ] hard  env-parse          1ms  64 nycklar, 0 olåsta rader
  [OK  ] soft  local-servers     12ms  supervisor:7777 OK; analytics:7778 OK
```

**Förväntad utdata (simulerad trasig värld):** `failed=redis-tcp,redis-ping,supabase-rest`
inom 30 000 ms.

## Gotchas

**`supabase-rest` returning 401/403 är OK.** Det betyder att värdet svarar men
kräver nyckel. Bara en timeout, DNS-fel eller oväntad status är fel.

**`api.scrapingbee.com` ger NXDOMAIN.** Rätt värd är `app.scrapingbee.com`.
Ett felaktigt värde här ger en permanent röd preflight som ser ut som
"nätet är nere".

**7777 och 7778 är mjuka.** Kedjan klarar sig utan dashboarden och analytics.
De är hårda bara med `--require-local-servers`, vilket är avsiktligt —
analytics-fel ska inte fälla en nattkörning.

**Exa/ScrapingBee är mjuka som standard.** Med `--strict-preflight` blir de
hårda igen (gammalt beteende). Standardvalet är mjukt för att en
tredjepartsoutage inte ska nollställa en hel natt.

**`env-parse` och `scripts/verify-env-integrity.mjs` överlappar.** Båda
fångar olåsta rader, men env-integrity kör dessutom `bash -c 'source .env'`
och verifierar de fem nycklar kedjan behöver. Använd env-integrity för
"kan vi source:a filen", preflight för "är världen körbar".

**Preflight är INTE en ersättning för fail-fast.** Preflight mäter världen
före kedjan; fail-fast fångar att världen dör *under* kedjan. Båda behövs.

**Exit 69 från preflight = världen trasig, inte gaten trasig.** Kedjan ska
inte starta. `scripts/cron/runPostIngest.sh` avbryter med exit 69 i så fall.
