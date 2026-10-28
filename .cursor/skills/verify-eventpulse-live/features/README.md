# verify-eventpulse-live/features — index

Feature-map för den NATTLIGA KEDJAN, verifierad mot riktig infrastruktur.
Skillen skiljer sig från `verify-eventpulse` (filkontroller) och
`verify-eventpulse-discovery` (discovery-steg) genom att den **startar
körningar och mäter före/efter**.

| Feature | Gate | Feature-fil | Status |
|---|---|---|---|
| Preflight — världen mäts innan kedjan startar | L1 | `preflight.md` | live (ny 2026-10-28) |
| Fail-fast — fel fälls i stället för att hänga | L2 | `fail-fast.md` | live (ny 2026-10-28) |
| Import-backlog — kön töms, importen är idempotent | L4 | `import-backlog.md` | live (ny 2026-10-28) |
| Chain-live — kedjan producerar events | L3 + L5 | `chain-live.md` | live (ny 2026-10-28) |
| Env-integrity — `.env` går att source:a | — | `env-integrity.md` | live (ny 2026-10-28) |

Varje feature-fil har fyra H2:er: `Sub-features`, `How to get to it (user POV)`,
`Driving it`, `Gotchas`.

**Varför denna skill finns (2026-10-28).** Rot-`GATES.md` hade 103 gröna
gates, varav ingen bevisade att kedjan producerar events. Under tre nätter
(26–28 okt) skrev kedjan "klart" med 0 events, nätverksstacken dog med
`EADDRNOTAVAIL`, och importen hängde i två timmar (583 KB identiska felrader).
Filkontroller kan inte fånga det — bara riktiga körningar mot riktig
infrastruktur kan det.

**Verifieringsprovenok:** alla fem gates kör mot den LEVANDE världen
(Supabase-projektet, Redis, Exa, Scrapingbee). Varje negativ kontroll kör
mot en medvetet trasig värld (död port) för att bevisa att gaten INTE är
permanent röd.

**Ordning:** L1 → L2 → env → chain-live. L1 först: mot en trasig värld ger
L2/L3 meningslösa röda svar.

**Korsreferens:**
- Kedjans stegordning (27 steg, P3 först) → `verify-eventpulse/features/orchestrator.md`
- Discovery-stegens utdata → `verify-eventpulse-discovery/`
- Dashboarden på 7777 och analytics på 7778 → `verify-eventpulse-agent/`
