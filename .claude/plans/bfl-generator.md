# Plan: BFL-generator — klustring, raykning, parallellitet

**Skapad:** 2026-10-11
**Scope:** Ny top-level-mapp `BFL-generator/`, liten patch i `scripts/_generate_bfl_round5.mjs` + `_generate_bfl_round5_images.mjs` (429-hantering), migration för events-tagg. Working tree: bevara 6 orörda ändringar.
**Spegel:** `~/.claude/plans/bfl-generator.md` (samma innehåll, plan-mode-kopia).
**Branch:** ny `bfl` från `cae65bb4` (användarens uttryckliga godkännande).

## Kontext

Användarens begäran (2026-10-11): göra BFL-bilderna mer varierade genom att klustra events inom varje kategori baserat på råa beskrivningar, och matcha rätt bild till rätt event. Formel: `minst 10 bilder per kategori + 1 per 30 events därefter` (användarens ord: "minst 10 bfl-bilder finns genererade per kategori och efter 10 är det 1 bild på 30 events").

Befintliga observationer:
- `image_library.tags TEXT[]` finns redan (migration `20260827-0001-image-library.sql:27–48`) — kan återanvändas.
- `events.raw_description` finns (migration `20261005-0001-description-rights-summary.sql:67`) med 30-dagars TTL.
- Round5-pipelinen (`scripts/_generate_bfl_round5.mjs` + `_generate_bfl_round5_images.mjs`) kör idag 4 parallella BFL-anrop, hanterar INTE 429, och bygger prompter per kategori (inte per kluster).
- BFL tillåter **24** samtidiga anrop för `flux-pro-1.1` (officiell docs).
- `tmp_image_corpus/_summary.json` har per-kategori-siffror: music 5009/264, theatre-drama 1776/0, kids 101/0, många undergenrer (jazz/pop/rock/electronic/hip-hop) med 0 bibliotek.
- Klustringskälla: MiniMax-M3 (användarens val).
- `scripts/_check_image_quota.ts:127–132` har en gammal formel (`events < 50 → 20`, annars `ceil(ev/30)`). Vi patchar inte detta idag — BFL-generatorn har sin egen räkning.

## Vad användaren godkänt

| # | Beslut | Val |
|---|---|---|
| 1 | Konkurrens default | 7 (säker, långt under BFLs 24-gräns). Override via `--concurrency=N` flagga eller env `BFL_CONCURRENCY` |
| 2 | 429-hantering | Ja — läs `retry_after`, exponentiell backoff, max 3 retries per item |
| 3 | Val-läge | Alla tre: `--count=N` (antal), `--event=<uuid>` (specifikt event), `--cluster=<slug>` (specifikt kluster). Kan kombineras |
| 4 | Plan-förklaring | Ja — skriv ut plan till terminal innan körning: vilka events, vilka kluster, antal prompts, beräknad kostnad ($0.04/bild), concurrency |
| 5 | Branch | Ja — skapa `bfl` från `cae65bb4` |
| 6 | Klustrings-LLM | MiniMax-M3 (nyckel finns redan i root `.env` som `MINIMAX_API_KEY`) |

## Mappstruktur

```
BFL-generator/
├── README.md                          # Användarinstruktioner (svenska, enkel)
├── package.json                       # Lokalt nod-skript (privat, inga workspaces)
├── .gitignore                         # Ignorera tmp/, plan.json, lockfiler
├── lib/
│   ├── quota.ts                       # Formel: max(10, ceil(ev/30))
│   ├── cluster.ts                     # Anropar MiniMax-M3 för klustring
│   ├── safety.ts                      # Säkerhets-suffix (samma som round5)
│   ├── bfl-client.ts                  # BFL fetch-wrapper med 429-backoff
│   └── tags.ts                        # Event-tagg ↔ image_library.tags konvertering
├── bin/
│   ├── bfl-plan.ts                    # Plan: hämta raw_descriptions, klustra, räkna, skriv plan.json + print plan
│   ├── bfl-quota.ts                   # Ren räkning (utan LLM): hur många bilder behövs
│   ├── bfl-generate.mjs               # Wrapper runt _generate_bfl_round5_images.mjs med concurrency=7 + 429
│   ├── bfl-stamp.ts                   # Wrapper runt _stamp_bulk.ts
│   └── bfl-match.ts                   # Runtime-helper: givet event-id → bästa biblioteksbild
├── prompts/
│   └── cluster-templates.json         # Mallar per kluster (hårdrock, pop, jazz, ...)
└── tmp/                               # .gitignore: working state, plan.json
```

**Varför wrapper-arkitektur (Val A):** Återanvänder round5-pipelinen istället för att skriva en ny BFL-generator från scratch. Det enda vi duplicerar är BFL-anroparen (concurrency + 429). All annan logik (säkerhets-suffix, hash-idempotens, stämpling) bor kvar i `scripts/`.

## Detaljplan per fas

### Fas 1 — Förberedelser (1–2 h, ingen runtime-påverkan)

| # | Åtgärd | Fil | Output |
|---|---|---|---|
| 1.1 | Skapa branch | `git checkout -b bfl` från `cae65bb4` | Ny branch, working tree orörd |
| 1.2 | Skapa mappskelett | `BFL-generator/{lib,bin,prompts,tmp}/` + `README.md` + `package.json` + `.gitignore` | Tom struktur |
| 1.3 | Skriv `lib/quota.ts` | Formel: `target = Math.max(10, Math.ceil(events / 30))`, `need = Math.max(0, target - library)`. Tar emot `{events: number, library: number}` → `{target, need}` | Enhetstester inline |
| 1.4 | Migration för events-taggar | `05-Supabase/migrations/20261011-0001-events-image-cluster.sql`: `ALTER TABLE events ADD COLUMN image_cluster TEXT[]` + GIN-index. Bakåtkompatibel (NULL default). Kräver `--apply` på migration-toolet | Migration redo |
| 1.5 | Skriv `cluster.ts` (mock-läge) | Tar emot `{event_id, raw_description}` → anropar MiniMax-M3 med instruktion "ge 1–3 kluster-taggar från denna svenska event-beskrivning", returnerar `{tags: string[]}`. Mock-läge returnerar tom array (för test utan nätverk). | Interface klart |

### Fas 2 — Planläge (läs, ingen skriv till filsystem utöver plan.json)

| # | Åtgärd | Fil | Output |
|---|---|---|---|
| 2.1 | `bfl-quota.ts --category=<slug>` | Läser events + image_library från Supabase, skriver `tmp/quota_<cat>.json` | Siffror per kategori |
| 2.2 | `bfl-plan.ts --category=<slug> [--count=N] [--event=<id>] [--cluster=<name>]` | (i) Hämtar rå_description för events i kategorin (eller bara det specifika eventet). (ii) Anropar `cluster.ts` för att tagga varje event. (iii) Räknar ut `need` via `quota.ts`. (iv) Genererar plan: "ska skapa N prompts för events [lista], kluster [lista], uppskattad kostnad $X". Skriver `tmp/plan_<cat>.json` och printar i terminal | Plan JSON + utskrift |
| 2.3 | `--dry-run` är default | Inget anropar BFL i denna fas. Allt är bara beräkning + filskrivning till `tmp/` | Säker |

### Fas 3 — Generering (kräver `--apply`)

| # | Åtgäder | Fil | Output |
|---|---|---|---|
| 3.1 | Patch `scripts/_generate_bfl_round5.mjs` för att läsa `<cat>_<cluster>_prompts.json` när flagga `--cluster-prompts` sätts. Befintlig logik orörd om flaggan saknas. | Befintlig script | Bakåtkompatibel patch |
| 3.2 | Patch `scripts/_generate_bfl_round5_images.mjs` för 429-hantering: läs `retry_after` från svar, exponentiell backoff, max 3 retries. Befintlig `CONCURRENCY = 4` ändras till default 7 om `BFL_CONCURRENCY` env är satt. | Befintlig script | Bättre feltolerans |
| 3.3 | `bfl-generate.mjs --apply --plan=tmp/plan_<cat>.json [--concurrency=N]` | (i) Läser plan. (ii) Bygger prompts per kluster med `prompts/cluster-templates.json` + säkerhets-suffix från `safety.ts`. (iii) Skriver `<cat>_<cluster>_prompts.json` (eller utökar round5-formatet). (iv) Anropar patched `_generate_bfl_round5_images.mjs` med 7 konkurrenter + 429-hantering. (v) Loggar varje bild till `tmp/run_log.json`. | Filer i `local_image_library/<cat>/` |
| 3.4 | `bfl-stamp.ts --apply --category=<slug>` | Wrapper runt `_stamp_bulk.ts` med legacy 240×64 SE-pill (`position: 'bottom-right'`). Säkerhetsregel: aldrig röra `local_image_library/`, bara skriva till `local_image_library_stamped/`. | Stämplade bilder |
| 3.5 | Uppdatera `image_library`-rader | För varje ny bild: skapa/uppdatera rad i `image_library` med `tags` från klustret + `category_slug` + `venue_pattern` (om möjligt) | DB-konsistens |

### Fas 4 — Matchning

| # | Åtgärd | Fil | Output |
|---|---|---|---|
| 4.1 | `bfl-match.ts --event=<uuid>` | (i) Läs event från DB. (ii) Läs `raw_description` (eller fallback). (iii) Anropa `cluster.ts` för att få eventets kluster-taggar. (iv) Query `image_library` där `category_slug = event.category_slug` OCH `tags && event.tags` (Postgres array overlap). (v) Välj rad med bäst overlap (eller fall tillbaka till dedup-baserat val). Returnera `{public_url, score, tags}`. | Matchningsförslag |
| 4.2 | Integration med `08-Agent/services/imageGen.ts` | Patch `matchLibraryFirst` att först fråga `bfl-match.ts` (eller inkludera logiken inline) — om kluster-match finns, använd den; annars befintlig dedup_hash-match. **Frivilligt steg**, kan göras senare. | UI visar "rätt" bild |

## Säkerhetsregler (minnen + användarens krav)

- **Aldrig bränna BFL-kredit utan `--apply`** (användarbeslut 2026-10-08). `--dry-run` är default.
- Innan `--apply`: skriv ut plan + kostnadsuppskattning, vänta på Enter.
- **BFL-stämpel = legacy 240×64 SE-pill** (bottom-right, 24px inset, 82% opacity, orange #FFB454). Inte den nya 150×36 hörnpillen.
- **Aldrig röra `local_image_library/`** — stämplade kopior hamnar i `local_image_library_stamped/`.
- **Inga syntetiska extraction-resultat** i CLIs. Allt kommer från riktiga events/raw_description.
- **Använd befintlig round5-pipeline** — bygg aldrig ny generator (patcha istället).
- **MiniMax-API-nyckel exponeras aldrig** i loggar/utdata.
- **Genereralization Gate** — kluster-ord och templates måste baseras på data från minst 3 olika Stockholm-domäner, inte en enda.

## Verifiering (per fas)

### Fas 1
- `node BFL-generator/bin/bfl-quota.ts --category=music --dry-run` skriver `tmp/quota_music.json` med rätt siffror (jämför med `tmp_image_corpus/_summary.json`).
- `npx tsc --noEmit BFL-generator/lib/quota.ts` passerar (eller motsvarande syntax-check).
- Migration körs i `--dry-run` på lokal Supabase (om tillgänglig), ellersparas för senare.

### Fas 2
- `bfl-plan.ts --category=music` skriver plan med N events, N kluster, korrekt räknat `need`. Inget BFL-anrop görs.
- Plan-utskrift är läsbar för icke-teknisk användare (testas genom att visa för dig).

### Fas 3 (först efter ditt godkännande)
- Kör mot `--category=music --count=3 --apply`. Förväntat: 3 bilder genereras med concurrency 7, ingen 429-krasch, alla stämplade.
- Inspektera 1 bild med `tools/review-explore-tiles.mjs` (M3 vision) — bekräfta att den matchar klustret visuellt.

### Fas 4
- `bfl-match.ts --event=<uuid>` returnerar korrekt bild för 3 test-events i olika kategorier.

## Leverabler (filer som skapas)

| Fil | Typ | Rör `scripts/`? |
|---|---|---|
| `BFL-generator/**` | Ny mapp, nya filer | Nej |
| `05-Supabase/migrations/20261011-0001-events-image-cluster.sql` | Ny migration | Nej |
| `scripts/_generate_bfl_round5.mjs` | Patch: lägg till `--cluster-prompts`-flagga (1 rad ändring) | Ja (liten patch) |
| `scripts/_generate_bfl_round5_images.mjs` | Patch: 429-backoff (ny funktion, inga ändringar i existerande workers om 429 ej triggas) | Ja (liten patch) |
| `08-Agent/services/imageGen.ts` | Valfri patch i Fas 4 (matchLibraryFirst) | Ja (endast om Fas 4 körs) |

## Vad jag INTE gör

- Inga ändringar i `02-Ingestion/A-directAPI-networkGate/runA.ts`.
- Inga ändringar i dedup_hash-algoritmen.
- Inga ändringar i `scripts/_check_image_quota.ts` (befintlig formel är en annan diskussion).
- Ingen ny BFL-generator från scratch (Val B är förkastad).
- Ingen `git push`/ingen PR utan ditt uttryckliga godkännande.

## Risker

| Risk | Sannolikhet | Mitigation |
|---|---|---|
| MiniMax-M3 hallucinerar kluster-taggar | Medel | Jämför mot befintlig 8-bucket music-taxonomi i `tagToCategory.ts`. Logga taggar med låg konfidens, skippa istället för att applicera |
| BFL 429-spam → hög kostnad | Låg | Concurrency 7 är långt under gränsen 24. Backoff max 3 retries. Skippa item efter 3 fel |
| Kluster-ord passar inte i stämpel-position (240×64 i SE) | Låg | Stämpeln är utanför motivet — påverkar inte innehåll |
| Round5-patchar bryter existerande körningar | Låg | Båda patchar är bakåtkompatibla (nya flaggor/ny funktion, inga ändringar i default-beteende) |
| Working tree (6 uncommitted) går förlorade | Låg | Vi skapar branch INNAN vi rör något. Working tree följer med till nya branchen |

## Öppet för diskussion

- **Kluster-cache:** Vill du att vi cachar M3-output (så vi inte anropar M3 för samma event igen)? Enkel JSON-cache på disk räcker.
- **Auto-rerun:** Vill du att `bfl-plan.ts` ska kunna köras på cron efter varje ingestion-batch? (Memorad regel säger ingen auto-körning utan godkännande — vi bygger den bara optional).
- **Kluster-naming:** "hårdrock" vs "hardrock" vs "Hard Rock" — vill du ha en normaliseringsfunktion (slugifier)?

## 👤 Min plan (förenklat)

Vi bygger en ny mapp som heter `BFL-generator/` med fyra små verktyg: ett som räknar, ett som planerar, ett som faktiskt genererar (med 7 bilder parallellt och som väntar snällt om tjänsten säger "vänta"), och ett som matchar rätt bild till rätt event. Allt börjar med att läsa rå beskrivningar och låta MiniMax-M3 hitta kluster som "hårdrock", "pop", "jazz". Vi återanvänder det mesta som redan finns — bara små patchar för att hantera 429-fel. Innan vi kör skriver verktyget ut en lista över vad som planeras och vi väntar på ditt " kör".