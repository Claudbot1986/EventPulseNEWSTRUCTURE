# Env-integrity — `.env` går att source:a

## Sub-features

- **`scripts/verify-env-integrity.mjs`** — gate. Parsar varje rad i `.env`,
  source:ar filen i en riktig `bash`, och kontrollerar att nycklarna kedjan
  behöver finns och inte är placeholders.
- **`scripts/lib/preflight.mjs`** → `findUnparsableEnvLines()` — samma
  parser som runtime, inbäddad i preflight.
- **Nycklar kedjan behöver:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `REDIS_URL`, `EXA_API_KEY`, `SCRAPINGBEE_API_KEY`.

### Vad som är fel

Tre former av trasig `.env`:

1. **Ociterat värde med blanksteg** — `FLY_API_TOKEN2=FlyV1 fm2_abc`.
   Bash läser det som två ord; `fm2_abc` körs som ett kommando →
   `unknown command "TOKEN2"`. **Detta var rad 58 den 28 oktober.**
2. **Ogiltigt nyckelnamn** — `1KEY=value`, `KEY-NAME=value`.
3. **Saknad `=`** — en rad som inte är en kommentar och inte har `=`.

### Varför det här är farligt

`scripts/cron/com.eventpulse.post-ingest.plist` och
`scripts/cron/runPostIngest.sh` gör `. ./.env` i en shell. Bash **fortsätter**
efter felet (körande `set -a` utan `set -e`), så en verklig
miljöregression är helt osynlig — kedjan startar med en manglande uppsättning
och loggar "klart".

### Värden skrivs aldrig ut

Gaten skriver bara **nyckelnamn, längder och felrader**. Aldrig värdet.
Det gäller även felmeddelanden — radnummer och nyckelnamn räcker för att
hitta felet.

## How to get to it (user POV)

"Varför fungerar inte nyckeln jag la till?"

Om en rad i `.env` har ett mellanslag i värdet, tror både bash och runtime
att det är två saker. Kedjan får då en trasig nyckel — men bara på
nattens körning, och bara som en tyst avbrott. Gaten hittar det direkt.

## Driving it

```bash
cd /Users/claudgashi/EventPulse
node scripts/verify-env-integrity.mjs
```

**Förväntad utdata (2026-10-28):**

```
[verify-env-integrity] .env: 148 rader
  OK: alla 60 nycklar parsas (inga olåsta rader)
  OK: `source .env` går rent igenom i bash
  OK: SUPABASE_URL finns (längd 45)
  OK: SUPABASE_SERVICE_ROLE_KEY finns (längd 250)
  OK: REDIS_URL finns (längd 32)
  OK: EXA_API_KEY finns (längd 63)
  OK: SCRAPINGBEE_API_KEY finns (längd 32)

[verify-env-integrity] GRÖN
```

**Exit 0 = grön, exit 1 = röd.**

### Samma sak, manuellt

```bash
# Kan bash source:a filen?
bash -c 'set -a; source .env; set +a; echo SOURCE_OK'
# → SOURCE_OK

# Hitta raderna med blanksteg i ociterat värde
grep -nE "^[A-Za-z_][A-Za-z0-9_]*=[^'\"].*[[:space:]]" .env
# → tomt = inga olåsta rader
```

## Gotchas

**`.env` har 148 rader men bara 60 nycklar.** Resten är kommentarer och
tomma rader. Antalet "nycklar" i utdatan är antalet parsade nycklar, inte
antalet rader.

**Citattecken är frivilliga men värden med blankstek MÅSTE citeras:**
`KEY="FlyV1 fm2_abc"` är korrekt, `KEY=FlyV1 fm2_abc` är inte.

**Prefixet `#` i ett värde gör raden till en kommentar.** `KEY=abc#def` →
värdet är `abc`, resten är kommentar.

**Gate-skillen överlappar med preflights `env-parse`.** Preflight ger "N
nycklar, 0 olåsta rader" som en del av världsmätningen. Env-integrity ger
samma information PLUS `bash source`-testet PLUS nyckelkontrollen. Kör
env-integrity när frågan gäller ".env", preflight när frågan gäller
"världen".

**`.env` ska aldrig skrivas ut i loggar.** Det har skett tidigare — och en
`service_role`-nyckel i en logg är en läckt nyckel. Kör alltid gaten, läs
aldrig filen rakt av.
