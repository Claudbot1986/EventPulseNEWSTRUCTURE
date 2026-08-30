# `ai-originals/` — ostämplad källa

Prefix i Supabase Storage-bucketen `event-posters`.

## Vad ligger här

**908 PNG-filer**, 1024×1024, genererade av **flux-dev** via EventPulse
bild-backfill. Ett event per fil; filnamnet är eventets slug plus
venue-slug, t.ex. `afrorave-debaserstrand.png`.

## Roll

Detta är **källan**. Filer här stämplas aldrig och skrivs aldrig över.
Allt som publiceras byggs som ett derivat:

```
ai-originals/  ──build_ai_stamped.ts──▶  ai-stamped/  ──▶  UI
```

Regeln som gör strukturen meningsfull: **byggsteget läser aldrig sin egen
output.** Därför kan stämpelns design ändras obegränsat antal gånger utan
att plattor staplas.

## Varför strukturen finns (2026-08-29)

Före det här datumet läste och skrev `restamp_all_event_posters.ts` till
samma prefix, `ai-generated/`. Varje körning komponerade en ny stämpel
ovanpå den förra. Under tre designiterationer (platt-opacitet 0.82 → 0.50
→ 0.20) fick de tio alfabetiskt första filerna tre staplade plattor med
effektiv opacitet ~0.93. Pixlarna under är oåterkalleligt förstörda, och
en mer transparent stämpel gick inte längre att uppnå oavsett vilket värde
som sattes.

De tio filerna kopierades därför **inte** hit. De listas i `RUINED` i
`08-Agent/scripts/seed_ai_originals.ts`.

## Legacy-filer i karantän (2026-08-30)

XMP-skanning avslöjade att **2 av 910** filer bar en legacy pixel-stämpel
i nedre höger hörn (resterna `christmasnightstage1-stage1.png` och
`pjolterguysstockholm-stockholm.png` från en restamp-körning 2026-08-28).
Dessa flyttades till `ai-quarantine/` så att de inte propagerar en
dubbelstämpel när nya vänsterstämplar läggs på av build-steget.

Kvar i `ai-originals/`: 908 rena original.

## Tio RUINED-filer (2026-08-30)

De tio alfabetiskt första filerna i den gamla `ai-generated/`-prefixen
blev under tre designiterationer 2026-08-29 stämplade tre gånger var —
pixlarna i nedre höger är överskrivna av tre staplade plattor med
effektiv opacitet ~0.93. Det går inte att laga, så de seedades aldrig
hit och **ligger kvar i `ai-generated/`** (inte `ai-quarantine/`,
eftersom de fortfarande pekas ut av `events.image_url` för 161 events).

Den nya vänsterstämpeln kan inte heller appliceras på dem, eftersom
den då skulle komponeras ovanpå den förstörda högerstämpeln och
ytterligare förvärra artefakten. Istället bygger
`build_ruined_into_stamped.ts` en separat `ai-stamped/<ruined>`-fil
med en ny transparent vänsterstämpel placerad på orörda pixlar. Den
befintliga trasiga högerstämpeln lämnas orörd — disclosure finns
ändå, bara i legacy-form.

Körning (engångs, idempotent):

```bash
npm run stamp:build-ruined       # bygger ai-stamped/<10 ruined>
npm run stamp:repoint-ruined     # events.image_url → ai-stamped/<ruined>
npm run stamp:quarantine-ruined  # flyttar ruined från ai-generated/ → ai-quarantine/
```

Efter det pekar **inga events** längre på `ai-generated/<ruined>` —
filerna är inte längre "i bruk".

## Åtkomst

Prefixet ska **inte** exponeras publikt. EU AI Act Art. 50 kräver att den
publika ytan bär disclosure; `ai-stamped/` är den ytan.

## Scripts

| Script | Roll |
|---|---|
| `08-Agent/scripts/seed_ai_originals.ts` | Seedade prefixet från `ai-generated/` (engångs) |
| `08-Agent/scripts/build_ai_stamped.ts` | Läser härifrån, skriver `ai-stamped/` |
| `08-Agent/scripts/scan_legacy_xmp.ts` | Hittar filer med inbakad legacy-stämpel via XMP |
| `08-Agent/scripts/quarantine_legacy_stamps.ts` | Flyttar legacy-filer till `ai-quarantine/` |
| `08-Agent/scripts/build_ruined_into_stamped.ts` | Bygger `ai-stamped/<ruined>` för 10 förstörda filer |
| `08-Agent/scripts/repoint_ruined_events.ts` | Uppdaterar events.image_url för 161 ruined-events |
| `08-Agent/scripts/quarantine_ruined_files.ts` | Flyttar ruined-filer från `ai-generated/` till `ai-quarantine/` |
