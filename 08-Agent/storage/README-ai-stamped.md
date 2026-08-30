# `ai-stamped/` — publicerat derivat

Prefix i Supabase Storage-bucketen `event-posters`. Detta är ytan som UI
läser.

## Vad ligger här

PNG-filer byggda av `08-Agent/scripts/build_ai_stamped.ts` från
`ai-originals/`. Filnamnen är identiska med källan, så mappning mellan
original och derivat är 1:1 på namn.

Varje fil har fått två saker av `applyAiCompliance`
(`08-Agent/tools/ai_compliance.ts`):

1. **Synlig AI-stämpel** — 202×48 px tight pill, `● AI-genererad`,
   orange accent `#FFB454`. Alla element (platta 0.20, kantlinje 0.45,
   prick 0.60, text 0.60) är halvgenomskinliga. Text-skugga-filter
   (gauss+offset+slope 0.55) gör den halvgenomskinliga texten läsbar
   även mot ljusa motiv. Position: `bottom-left`, 24 px inset,
   `top=740`.
2. **XMP-metadata** — `EventPulse:`-namespacade fält injicerade som
   PNG `iTXt`-chunk. Maskinläsbart via exiftool, Photoshop, Adobe Bridge.

## Hur bilderna genererats

```
flux-dev  ──▶  ai-originals/  ──build_ai_stamped.ts──▶  ai-stamped/
```

Byggsteget är ren lokal Sharp-compute, ~10–50 ms per bild. Ingen
modell-API anropas, så ombyggnad kostar 0 kr.

## Position

Default och enda position: `bottom-left`. CLI:t accepterar
`--position=bottom-left|bottom-right` men `--position=both` finns inte
längre (2026-08-30) — dubbelstämpel i båda hörnen skapade förvirring
kring vilken som var "den riktiga".

`top=740` gäller för båda och är valt så att stämpeln överlever
cover-crop i alla kända UI-containrar. Worst-case synlig y-range är
210–815 (HomeScreen `cardImage`, aspect 1.69:1), vilket ger 27 px
marginal under stämpelns underkant vid y=788.

Horisontellt är stämpeln inte säker vid godtyckligt bred container:
cover-crop behåller en centrerad remsa, så hela x=24-225-pillan
faller utanför när aspect blir stor. Kravet är aspect ≤ 1.5:1.
Därför bär `06-UI/App.js` `eventImage` en `maxWidth: 420` mot
`height: 280`. Utan den croppas stämpeln bort horisontellt på bred web —
det var grundorsaken till att stämpeln länge såg ut att saknas trots att
den fanns i filen.

## Dubbelstämpel på enstaka filer

Inga. 2026-08-30: XMP-skanning visade att **2 av 910** filer i
`ai-originals/` bar en legacy-stämpel. Dessa flyttades till
`ai-quarantine/` så att derivatet inte får dubbelstämpel.

## Bygga om

```bash
# Alla som saknas
npm run stamp:build

# Bygg om allt från originalen (aldrig från befintligt derivat)
npm run stamp:build -- --force

# Smoke-test på första 10
npm run stamp:build -- --limit=10
```

`--force` bygger om **från `ai-originals/`**, inte från den befintliga
filen här. Stämplar kan därför aldrig stapla sig, oavsett hur många gånger
designen ändras.

## Relaterat

| Fil | Roll |
|---|---|
| `08-Agent/tools/ai_compliance.ts` | `applyAiCompliance`, `checkAiStamp`, stämpel-SVG |
| `08-Agent/scripts/build_ai_stamped.ts` | Byggsteget |
| `08-Agent/storage/README-ai-originals.md` | Källan |
| `scripts/verify_utforska_star.py` | Playwright-verifiering av renderad stämpel |
