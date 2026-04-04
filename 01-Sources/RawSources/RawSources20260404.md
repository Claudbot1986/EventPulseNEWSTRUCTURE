# RawSources — Rå Inbox för Kandidatkällor

## Syfte

`RawSources/` är ett rått mellanlager mellan insamling och modellvalidering.

- **RawSources** = otestade kandidater, ingen förbearbetning
- **sources/** = verifierade startkällor (discoveredAt, preferredPath, discoveredBy)
- **candidates/** = scoutade kandidater med diagnosresultat

## Struktur

Varje rad representerar en grov kandidatkälla. Minimální metadata endast.

```
| Namn | URL | Stad | Kategori | Insamlad | Notis |
```

| Fält | Beskrivning |
|------|-------------|
| Namn | Kort identifikator (t.ex. "CaféOpera") |
| URL | Start-URL för testning |
| Stad | Stockholm, Göteborg, Malmö, Annan |
| Kategori | konserthus, arena, festival, museum, nattliv, idrott, Annan |
| Insamlad | YYYY-MM-DD |
| Notis | Fritext, valfri (t.ex. "hittad via Google", "tydlig kalender-sida") |

## Regler

1. **Ingen site-specifik logik** — endast generella fält
2. **Ingen djupanalys** — endast grov indikation
3. **Ingen teststatus** — RawSources är enbart insamlingsfasen
4. **Datumformat** — YYYY-MM-DD för sortable
5. **Tillägg** — Ny fil per datum: `RawSourcesYYYYMMDD.md`

## Exempel

| Namn | URL | Stad | Kategori | Insamlad | Notis |
|------|-----|------|----------|----------|-------|
| _lägg till kandidater här_ | | | | | |

---

*För batch-testning, parse denna fil och mata in i sourceTriage.*
