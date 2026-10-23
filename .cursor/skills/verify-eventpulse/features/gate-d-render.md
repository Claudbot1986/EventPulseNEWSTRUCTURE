# Gate D — renderGate (Scrapingbee)

## Sub-features

- **Ingång** — `runtime/postTestC-D.jsonl` (JS-SPA-källor som C-gatet hittade
  men inte kunde läsa). Byt med `--input=FILE.jsonl`.
- **Renderbeteende** — `--behavior=auto|static-only|premium-only|stealth`.
  **Default `premium-only`** (`:451-453`), dvs. varje render kostar credits.
- **Utdata** — `postD-UI.jsonl` (events hittade), `postD-man1.jsonl` /
  `postD-man.jsonl` (kvarantän), och `back-to-<fil>` för poster som gick
  tillbaka till sin in-kö.
- **Recovery-inputs** — `--input=postTestC-manual-review|serverdown|404|error500`
  routar poster tillbaka in i den filen istället för framåt.
- **Dedup + limit** — poster dedupas på `sourceId`, sedan `slice(0, limit)`.
  Resten blir `remaining` och stannar i in-kön.

## How to get to it (user POV)

Du vet att EventPulse har en venue den inte kan läsa utan rendering, och du
vill veta om den faktiskt har evenemang. Du kör:

```bash
npx tsx 02-Ingestion/D-renderGate/runD-scrapingbee.ts --behavior=static-only --limit=5
```

för att testa gratis först, och `--behavior=premium-only` när du är beredd
att betala för riktig rendering.

## Driving it

```bash
cd /Users/claudgashi/EventPulse
SANDBOX=$(mktemp -d /tmp/ep-ingest-XXXXXX)
mkdir -p "$SANDBOX"/{runtime,sources,03-Queue/03-extractedevents}
export EVENTPULSE_SANDBOX_ROOT="$SANDBOX"
TIMED="$PWD/.cursor/skills/verify-eventpulse/scripts/timed.sh"

cat > "$SANDBOX/runtime/postTestC-D.jsonl" <<'EOF'
{"sourceId":"_verify-fixture","url":"https://www.nalen.com/","name":"Nalen"}
EOF

# Tömvyn först — ingen rendering, inga credits.
sh "$TIMED" 120 npx tsx 02-Ingestion/D-renderGate/runD-scrapingbee.ts --dry --limit=5
echo "dry-exit=$?"

# static-only kostar inga credits.
sh "$TIMED" 600 npx tsx 02-Ingestion/D-renderGate/runD-scrapingbee.ts --behavior=static-only --limit=5 --workers=2
echo "exit=$?"

# Summary-raden (allt på en rad):
#   SUMMARY postD-UI: N | postD-man1: N | postD-man: N | back-to-…: N | remaining: N | creditsUsed=N
wc -l "$SANDBOX/runtime/postD-UI.jsonl" "$SANDBOX/runtime/postD-man1.jsonl" \
      "$SANDBOX/runtime/postD-man.jsonl" "$SANDBOX/runtime/postTestC-D.jsonl" 2>/dev/null

rm -rf "$SANDBOX"
```

## Gotchas

**`premium-only` är default och kostar pengar.** `--behavior=premium-only`
utan att tänka sig för bränner credits. Börja med `--dry` eller
`--behavior=static-only`. Cron tvingar `static-only` under `--smoke`.

**Alla flaggor är `--key=value`, inte `--key value`.** `--limit=200`,
`--workers=4`, `--max-pages=3`, `--input=x.jsonl`, `--behavior=static-only`.
Bara `--dry` är ett ensamt ord. `runD-scrapingbee.ts:437-449`.

**`--limit 5` (mellanslag) tyst ignoreras.** Koden letar med
`args.find(a => a.startsWith('--limit='))` — mellanslagsformen matchar
inte, och du får `DEFAULT_LIMIT` utan felmeddelande.

**`Input queue postTestC-D.jsonl does not exist — nothing to do.`** är en
`return`, exit 0 (`:461-464`). Tom D-kö är steady state.

**`SCRAPINGBEE_API_KEY` är valfri.** Saknas den används en lokal
Puppeteer-fallback (`renderGate.ts:167,188`). Fallbacken är långsammare och
kan ge annat resultat än ScB — rapportera vilken väg som kördes.

**Gate D avslutas alltid exit=0** (`process.exit(0)` vid `:565`). Exit 1
bara för orkastrerat kast.

**`back-to-<fil>` i summaryn betyder att inga credits köptes** för de
posterna — de skickades tillbaka. Kolla `creditsUsed=N` innan du rapporterar
något som kostnad.