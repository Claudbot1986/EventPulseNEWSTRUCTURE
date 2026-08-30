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
