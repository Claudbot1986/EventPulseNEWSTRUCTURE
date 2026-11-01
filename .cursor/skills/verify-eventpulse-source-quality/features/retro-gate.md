# Retro-gate — vad hade gaten blockat?

## Sub-features

- **Motorn körs på riktiga data** — Q6 anroar P3D:s faktiska
  `decideSourceCandidateOutcome` med de verkliga raderna från varje
  promote:ad källa. Ingen förenklad kopia.
- **Falsklarmkontroll** — en källa vars sidor själva deklarerar ett
  **evenemang** (alla event-typerna: `event`, `musicEvent`, `theatreEvent`,
  `festival`, `exhibitionEvent`, …) flaggas om den ändå blockas. Det är en
  **mätning**, inte en kodgaranti — koden blockerar först och rapporterar
  sedan. Det är kontrollen som gör "gaten biter" begripligt.
- **Skuldbank** — de källor gaten skulle blockat, med radantal och skäl.

## How to get to it (user POV)

Användaren har redan 20–45 källor i grafen som slppt in innan gaten fanns.
Retro-gaten svarar på frågan som användaren faktiskt ställer: **"vilka av
mina nuvarande källor är skräp, och hur mycket skräp är det?"** — mätt på
verkliga rader, inte på en lista av misstänkta domäner.

Den gör det möjligt att rensa upp med öppna ögon i stället för att gissa.

## Driving it with <harness>

```bash
cd /Users/claudgashi/EventPulse
npx tsx scripts/verify-source-quality.mjs --window 48
```

Utskrift:

```
  OK      Q6 RETRO-GATE — P3D:s motor blockerar artikelkällor och släpper igenom evenemang — 3/45 källor skulle blockats, 0 falsklarm
  skuldbank (källor gaten skulle blockat): thatsupse (65 rader), kulturfestivalenstockholmse (4 rader), kollaborationse (8 rader)
```

Detaljer ur rapporten:

```bash
jq '.gates[] | select(.id=="Q6") | {blocked, falseAlarms, evaluated}' \
  runtime/verification-reports/source-quality-<TS>.json
```

`blocked[]` innehåller `sourceId`, `rows`, `reason` och exempelrubriker.
`reason` är beslutets faktiska skäl, t.ex.
`raderna ser ut att vara artiklar, inte evenemang (json-ld-typ=newsarticle; og:type=article; sidor-deklarerar-artikel=5/5)`.

Verifiera en enskild blockerad källa mot verkligheten — **använd `--deep`**:

```bash
npx tsx scripts/audit-source-quality.mjs --source thatsupse,kollaborationse --deep
```

## Gotchas

- **Retro-gaten är en mätning, inte en radering.** Den säger vad gaten skulle
  ha blockat. Att ta bort källorna är ett separat beslut.
- **Tre av 45 källor blockas per mätning 2026-11-01:** `thatsupse` (65 rader —
  en tidskrift, artiklarna deklarerar `newsarticle` på detaljsidorna),
  `kollaborationse` (8 rader — livsstilsblogg), `kulturfestivalenstockholmse`
  (4 rader — FAQ/artiklar). Alla tre har rubriker som avslöjar dem direkt.
- **`musikaliskase.se` blockades INTE efter fixen 2026-11-01.** Före fixen
  lästes kategorisidor som bär `article` i JSON-LD, och en källa med 30
  riktiga evenemang blockerades. Om en ny falsklarm uppstår: kontrollera
  först om de lästa sidorna är *detaljsidor* eller *listningssidor*.
- **En källa med noll detaljrader ger inget sidbevis.** Då faller bedömningen
  tillbaka på rubrikerna. Det är medvetet konservativt: en felaktigt
  blockerad bra källa är dyrare än en artikel som slinker igenom.
- **`wwwmynewsdeskcom` (1 rad) fångas inte.** Rubriken matchar visserligen ett
  artikelmönster (`snart släpps …`), men källan har bara **en** rad — och
  gaten kräver **minst två** artikelrader. Det är tröskeln, inte rubriken,
  som släpper igenom. Radens `url` är dessutom samma som listningssidan, så
  sidbeviset är noll. Medveten falsknegativ, inte ett fel.
- **Auditen utan `--deep` ger ett ANNAT svar än retro-gaten.** I titelläge
  bedöms 4 av 65 rubriker hos thatsupse som artiklar (6 %) → auditen säger
  "event" medan retro-gaten säger "artikel". Siffrorna säger olika saker
  eftersom signalerna är olika. Använd `--deep` för att få samma starka
  signal som retro-gaten.
