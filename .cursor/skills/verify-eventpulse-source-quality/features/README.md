# Feature map — verify-eventpulse-source-quality

Källans **sannhet** och **rikedom**: är det som landar i EventPulse verkligen
evenemang, och bär det den information som står på evenemangssidan?

Feature-kartan svarar på: "vilken användarväg kan jag driva för att bevisa att
det här stämmer?" — inte "vilken modul finns?".

| Feature | Vad användaren vill veta | Feature-fil |
|---|---|---|
| Kvalitetsgaten | Blockerar discovery verkligen bloggar och nyhetssajter? | [p3d-quality-gate.md](p3d-quality-gate.md) |
| Retro-gate | Vad hade gaten blockat på de källor vi redan har? | [retro-gate.md](retro-gate.md) |
| Detaljberikning | Kommer beskrivning, plats och bild från evenemangssidan? | [detail-enrichment.md](detail-enrichment.md) |
| Källkvalitet | Vilka källor i grafen är bra, och hur ser de ut? | [source-audit.md](source-audit.md) |

## Vad denna skill INTE täcker

- **Pipelinförandet** (steg, loggar, launchd) → `verify-eventpulse-discovery`
- **Överlämningen discovery → ingestion** → `verify-eventpulse-ingestion-discovery`
- **Själva appen och UI:t** → `verify-eventpulse-ui`

Den här skillen svarar på en annan fråga: **är det vi hittat riktigt?**

## Snabbstart

```bash
cd /Users/claudgashi/EventPulse
npx tsx scripts/verify-source-quality.mjs          # hela gaten Q1–Q9
npx tsx scripts/audit-source-quality.mjs           # källöversikt (radarar inte)
npx tsx scripts/enrich-event-details.mjs --dry-run # berikning, utan skrivning
```

Alla tre kräver `npx tsx` — de importerar `.ts`-moduler direkt. `node` kan
inte lösa dem.
