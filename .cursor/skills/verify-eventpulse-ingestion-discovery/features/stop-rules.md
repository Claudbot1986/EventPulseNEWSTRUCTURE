# Stoppreglerna — när något inte fungerar

**Grundregel (användaren, 2026-10-31):** *"Om inte, stanna den, starta den
ingen."*

En trasig ingestion- eller discovery-kedja får inte fortsätta att köa i
bakgrunden som om allt var bra. Det är så den brutna länken i discovery
levde i sex dagar: kedjan var grön, loggen var full, och ingen människa tittade
på "0 claimade".

## 1. Stoppa kedjan

```bash
# Ingen parallell kedja — resultaten blir oläsbara
ps auxww | grep -E "ingestion-cron|runDaily|drainQueue" | grep -v grep

# Stäng av cron-jobben (reversibelt)
launchctl bootout gui/$(id -u)/com.eventpulse.ingestion
launchctl bootout gui/$(id -u)/com.eventpulse.post-ingest
```

Kör inte `kill -9`. Kedjan har en egen avslutningsväg som låser upp preA-rader
och markerar kvarlämnade jobb:

```bash
node scripts/verify-shutdown-safety.mjs   # verifierar att avslutandet är säkert
```

## 2. Fixa rotorsaken

Symptomen ("0 nya events", "kedjan grön men inget händer") har nästan alltid
en konkret brytpunkt. Leta efter den i den ordning kedjan kör:

1. `runtime/ingestion-cron/status.json` — stegets exit-kod.
2. `runtime/ingestion-cron/steps/<steg>-<TS>.err.log` — feltexten.
3. `runtime/ingestion-cron/chain-overview.log` — stegordning och var det
   faktiskt tog tid.

Exempel på orsaker som hittats i den här kedjan (2026-10-31):

- P3D claimade 0 rader → kön matades aldrig → `enqueue_source_candidate_tests()`
  saknades i koden.
- Purgen raderade sparade events → skydden frågade en tabell som inte finns,
  och felet svaldes till en varning.

## 3. Skriv ner fyndet

`00-Vault/01-Projects/EventPulse/02-Operations/06-Verification-Status.md` —
med `[VERIFIED]`/`[CLAIMED]`/`[UNVERIFIED]` och fil:line-bevis. Ett fynd utan
nedskrivning hittas inte igen.

## 4. Verifiera fixen med samma gate

Samma kommando, samma negativa kontroller. En fix utan körning är en hypotes.

## 5. Starta om — först när gaten är grön

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.eventpulse.ingestion.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.eventpulse.post-ingest.plist
```

Verifiera att jobben är tillbaka: `launchctl list | grep eventpulse`.
