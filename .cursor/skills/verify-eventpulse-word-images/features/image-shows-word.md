# Gate: bilden visar ordet

**Kommando:** `node --env-file=.env --import tsx scripts/verify-word-images.ts --recheck`

## Vad gaten bevisar

M3 vision läser av den **faktiska bildfilen** och svarar på två frågor:

1. `match` — visar bilden det efterfrågade ordets innebörd? (`confidence` 0–1)
2. `appropriate` — är bilden lämplig för ett offentligt evenemangskort?

`--recheck` tvingar omgranskning även om sidecaren redan har ett resultat —
använd det när granskningsreglerna har ändrats.

## Varför två frågor

`match` ensam räcker inte. En bild kan visa en bastu och ändå vara oanvändbar:

- **Nakenhet.** 2026-10-31 släppte MiniMax igenom en "mixbastu"-bild med
  nakna bröst, samtidigt som innehållsfiltret blockerade den *mildare*
  "bastu"-prompten. Filtret är inkonsekvent, så verifieringen måste fråga
  separat om kläderna.
- `appropriate=false` om någon är naken, visar blotta bröst, har badkläder som
  visar för mycket, eller om bilden är sexuellt suggestiv.

Båda måste vara sanna för att ordet ska godkännas.

## Vad granskaren får se

Ordet, ordets inneböld (genererad av M3 ur de riktiga titlarna) och själva
bilden som base64-data-URL. Ingen bild modelleras om.

## Exit

0 = alla bilder matchar och är lämpliga. 1 = minst en bild matchar inte, eller
är olämplig.

## Historik

| Datum | Fynd | Åtgärd |
|---|---|---|
| 2026-10-31 | MiniMax:s innehållsfilter blockerade "bastu"-prompten men släppte igenom en avklädd "mixbastu"-bild | prompten skärptes med klädkrav, `appropriate`-fält lades till i granskningen, bilden genererades om |
