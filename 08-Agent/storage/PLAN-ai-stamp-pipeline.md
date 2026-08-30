# Plan: AI-stämpel-pipeline för EventPulse (2026-08-30)

## Vad som är klart idag

### 1. Source/derivative-separation i bucketen `event-posters`

| Prefix | Roll | Skrivs av | Innehåll |
|---|---|---|---|
| `ai-originals/` | Källan — aldri stämplad, aldrig överskriven | seed_ai_originals.ts (engångs) | 908 PNG (1024×1024) från flux-dev |
| `ai-stamped/` | Publik yta — derivat med stämpel + XMP | build_ai_stamped.ts | 908 PNG, alla stämplade |
| `ai-quarantine/` | Bortplockade legacy-filer | quarantine_legacy_stamps.ts | 2 PNG med inbakad legacy-stämpel |
| `events/` | Nya ingestion-bilder (rå output idag, borde vara stämplade) | imageGen.ts | växande |

### 2. Stämpel-design (ai_compliance.ts, 2026-08-30)

```
SVG 202×48, viewBox 0 0 202 48
  rect x=2 y=2 width=199 height=44 rx=22
    fill=rgba(15,15,18,0.20)       ← plattan transparent
    stroke=rgba(255,180,84,0.45)   ← orange kantlinje transparent
  circle cx=26 cy=24 r=6
    fill=#FFB454 fill-opacity=0.60 ← orange prick transparent
  text x=44 y=31 "AI-genererad" 18px Arial bold
    fill=#FFFFFF fill-opacity=0.60  ← text transparent
    filter=textShadow (gauss+offset+slope 0.55)
Position: bottom-left, top=740 (safe-zone inom cover-crop),
          24 px inset.
```

Text-bredd uppmätt med librsvg till 115 px → rect-bredd 199 = 42 px
marginal på varje sida om texten (samma som vänsterkant-till-text-start).

### 3. Verifiering (content-oberoende)

`checkAiStamp(buffer, position, reference)` jämför pixel-differens mellan
original och resultat *bara på stämpelns egna opaka pixlar* (alpha ≥ 0.4).
Tidigare färgdetektering övergavs efter 9/25 falska positiva på rena
original (varm scenbelysning).

Distribution mätt på 12 lokala testbilder:
- Stämplade filer: changedRatio 0.995–1.000
- Ostämplade original: changedRatio 0.000

### 4. Skript som tillkom idag

| Skript | Roll |
|---|---|
| `08-Agent/scripts/seed_ai_originals.ts` | ai-generated/ → ai-originals/ (910 kopierade, 10 ruined exkluderade) |
| `08-Agent/scripts/build_ai_stamped.ts` | ai-originals/ → ai-stamped/ (lokal Sharp-compute) |
| `08-Agent/scripts/quarantine_legacy_stamps.ts` | ai-originals/ → ai-quarantine/ (2 legacy-filer) |
| `08-Agent/scripts/scan_legacy_xmp.ts` | Hittar legacy-stämplade via XMP-metadata |
| `08-Agent/scripts/scan_legacy_stamps.ts` | Orange-pixel-skanner (låg precision, ersatt av XMP-versionen) |

---

## Vad som INTE är klart — auto-stämpel på ingestion

### Problemet

`08-Agent/services/imageGen.ts:uploadAndPersist()` laddar upp raw
modell-output till `event-posters/events/<id>.png` **utan att anropa
`applyAiCompliance`**. UI-hooken `useAiImageUrl` returnerar
`stampVisible: true` för dessa events eftersom `image_ai_generated=true`
i databasen — men pixelstämpeln finns inte i filen.

Detta är en **EU AI Act Art. 50-brist** som uppstår för varje ny ingestion.

### Var kroken ska sitta

Enda punkten där nya AI-bilder produceras: `imageGen.ts → uploadAndPersist()`.
Smoketest-scriptet (`generate_ai_image_smoketest.ts:91`) anropar redan
`applyAiCompliance` korrekt — samma mönster ska flyttas till imageGen.

### Konkret ändring

`08-Agent/services/imageGen.ts`, mellan rad 335 och 339:

```typescript
const buffer = Buffer.from(b64, 'base64');
const ext = mime === 'image/png' ? 'png' : 'jpg';
const path = `events/${storagePath}.${ext}`;

// ── NY KOD: EU AI Act Art. 50-disclosure ────────────────────
// All AI-genererad bild måste ha stämpel + XMP innan publicering.
// applyAiCompliance är idempotent på input-nivå och kostar ~10–50 ms.
const stampedBuffer = mime === 'image/png'
  ? await applyAiCompliance({ buffer, prompt, model: 'flux-dev', position: 'bottom-left' })
  : buffer;
// ──────────────────────────────────────────────────────────

const { error: uploadErr } = await supabase.storage
  .from(STORAGE_BUCKET)
  .upload(path, stampedBuffer, {
    contentType: mime,
    upsert: true,
    cacheControl: '31536000',
  });
```

### Varför `events/` och inte `ai-originals/`

imageGen skriver redan till `events/<storagePath>` idag. Att flytta till
`ai-originals/` skulle kräva att alla 4 sökvägar i useAiImageUrl.js
uppdateras + att URL:en i events.image_url pekas om. Värt det bara om
vi vill ha samma source/derivative-garanti för nya bilder som vi har
för backfill. Rekommenderad approach: **stämpla in-place i `events/`
för nu, refactorera till `events/` + `events-stamped/` i en separat
omgång om/när vi har ett migrationsskript**.

### Migration av existerande `events/`-filer

Innan kroken slås på finns det sannolikt ett antal AI-bilder i
`events/` som saknar stämpel. För att inte bryta prod:

1. Skript `08-Agent/scripts/restamp_events_bucket.ts`:
   - Lista `event-posters/events/` (inte `events-public/`, det är DB-namespace)
   - För varje PNG: ladda ner, anropa applyAiCompliance, ladda upp (upsert)
   - Hoppa över om XMP redan har `EventPulse:AIGenerated=true`
2. Kör efter att kroken ovan är på plats, som en engångs-backfill.
3. Verifiering: lista events med `image_ai_generated=true` och kontrollera
   att motsvarande URL:er i `event-posters/events/` har stamp + XMP.

### Risker och open questions

1. **Storlek.** Varje stämplad bild växer med ~5–20 KB pga XMP-chunk.
   För 908 bilder är det ~10 MB extra på CDN. Försummbart.

2. **Cache.** CDN har befintliga cachelagrade versioner av de
   stämplade bilderna. Om vi ändrar SVG-design måste vi antingen byta
   filnamn eller bumpa cache-buster. För nu: `cacheControl: '31536000'`
   — designändringar kräver cache-bustning.

3. **JPEG-path.** Bildgenerering kan returnera JPEG (vissa providers).
   applyAiCompliance förväntar PNG. Hooken ovan villkorar på
   `mime === 'image/png'`; JPEG faller igenom till raw upload. För
   fullständig compliance bör vi konvertera JPEG → PNG efter stämpling,
   men det ändrar URL och kräver DB-uppdatering. Skjut på det.

4. **Verifiering vid ingestion.** När vi stämplar i uploadAndPersist
   finns det ingen automatisk check att stämpeln faktiskt kom med.
   Lägg till: ladda ner den uppladdade bilden och kör checkAiStamp
   mot originalet (som vi har i minnet) — kasta om changedRatio < 0.5.

5. **Legacy 10 RUINED + 2 quarantined.** Dessa berörs inte av auto-hook
   (de ligger i `ai-generated/` och `ai-quarantine/`, inte `events/`).
   Beslut om dom väntar: användaren har inte sagt vad som ska hända.

---

## Implementation order (när du säger till)

1. Lägg till applyAiCompliance-hook i imageGen.ts:uploadAndPersist (rad 335–339)
2. Lägg till post-upload verifiering i samma funktion
3. Skriv `08-Agent/scripts/restamp_events_bucket.ts`
4. Kör bakåtfyllnadsskriptet på prod
5. Verifiering: plocka 10 slumpmässiga events med AI-bilder och inspektera
   pixelstämpeln i web-appen (samma Playwright-skript som för Utforska*)
6. Vault update: 01-Projects/EventPulse/02-Operations/03-Current-Task.md ←
   [VERIFIED] att ingestion bär stämpel automatiskt
7. Commit + PR
