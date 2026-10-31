# Gate: ordet finns i titeln

**Kommando:** `node --env-file=.env --import tsx scripts/verify-word-images.ts`

## Vad gaten bevisar

För varje genererad ordbild: finns ordet som bilden påstår sig visa faktiskt i
någon av de eventtitlar som bilden byggdes från?

Det här är **deterministiskt** — ingen LLM, ingen bildläsning. Det är ett
sorteringsproblem i ren text.

## Matchningsregel

Ordet förekommer i titeln om det antingen:

- är ett helt ord i titeln (`bastu` i "Dambastu lördagmorgon Inre **Bastu**"), eller
- är en del av ett sammansatt ord (`bastu` i "**Dambastu** lördagmorgon").

Båda nyckel- och ordformen matchas: bildnyckeln `bastu` (korrekt form) och
ordformen `bastun` (bestämd form) pekar på samma bild.

## Vad som också kontrolleras

- **Ordet finns i ord-inventeringen.** Ett ord som inte finns i
  `huvudattraktioner-2026-10-31-ord-inventering.csv` har inte gått genom
  ordklassningen — gaten flaggar det.
- **Ordet är INTE klassat som namn.** Om ordet finns i
  `huvudattraktioner-2026-10-31-namn.csv` ska det inte ha någon bild alls.

## Exit

0 = alla ord finns i sina titlar. 1 = minst ett ord saknas, saknas i
inventeringen, eller är ett namn.

## Historik

| Datum | Fynd | Åtgärd |
|---|---|---|
| 2026-10-31 | "bastun" matchade inte titeln "Fredagsmix Inre bastun" eftersom matchningen använde ordformen i stället för nyckeln | matchning på nyckel + ordform (`matchForms()`) |
