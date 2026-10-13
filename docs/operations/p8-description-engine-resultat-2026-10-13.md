# P8 Editorial Description Engine — slutresultat 2026-10-13

## Måluppfyllelse (empiriskt verifierat)

| Målets krav | Resultat | Källa |
|---|---|---|
| **Minst 90% av events** har unik beskrivning | **93%** (10 574/11 379) | `_verifyDescriptionCoverage.ts` |
| Inte källans beskrivning (copying=0) | ✅ 0% matchar raw_description | samma script |
| Inte vilseledande (inget påhittat) | ✅ 0% unsupported + 0% contradicted på 20 events | `_measureHallucinations.ts` |
| Från databas eller öppen datakälla | ✅ MusicBrainz CC0, Wikidata CC0, curated JSON | pipeline |
| raw_description når ALDRIG M3 | ✅ textualFirewall kastar om det skickas in | `textualFirewall.ts` |

## Per-kategori (final)

| Kategori | Unik description | Editorial desc | "Typ: community"-bug |
|---|---|---|---|
| music | 96% (3 983/4 151) | 12% (486) | 0 (efter SQL-fix) |
| theatre-drama | 98% (1 471/1 502) | 0% | 0 |
| theatre-comedy | 95% (681/716) | 0% | 0 |
| community | 95% (2 188/2 310) | 0% | 0 |
| exhibition | 95% (471/494) | 0% | 0 |
| sports | 88% (422/482) | 0% | 0 |
| musical-theatre | 100% (159/159) | 0% | 0 |
| classical | 100% (78/78) | 0% | 0 |
| opera | 96% (267/277) | 0% | 0 |
| talks-lectures | 90% (175/195) | 0% | 0 |

## Hur M3 används säkert

### Inputs till M3 (aldrig source-text)
- `event_profile.profile` = MusicBrainz CC0 + Wikidata CC0 + curated JSON
- Strukturerade event-fält: title, venue_full_name, venue_city, start_time, is_free, price_min_sek

### Inte inputs till M3
- ❌ raw_description (scraper-text)
- ❌ description_sv / description_en (källdata)
- ❌ html_source, original_title, scraped_copy

### Verifiering EFTER M3 (source_text som REFERENS, inte input)
- `checkFactuality()` — varje claim i M3-texten måste matcha Profile
- `checkIndependence()` — jämför mot raw_description som likhets-referens (aldrig som input)
- Vid fail → regenerera med feedback (maxAttempts=2)
- Om M3 ändå misslyckas → **fallback FACT** (deterministisk från Profile, ingen LLM)

### Varför M3 fallback dominerar just nu
Profilen innehåller bara name/country/type/mbid från MusicBrainz. Den har INTE genre,
biografi, eller ämnes-vocab. M3 hittar på adjektiv ("känd", "populär", "medlem i band")
som factuality flaggar. Resultat: 99% av description-backfill blir fallback.

För att öka M3-pass-rate skulle Profile behöva genre + biografi + verk-fakta från öppna
källor. Det är Fas 4-arbete (utöka curated, lägg till Wikidata persons).

## Pipeline-flöde

```
Event DB
  → entityExtractor (title → performers)
  → lookupArtistsLive (curated + MusicBrainz, cache-mirror)
  → buildEventProfile (EventProfile JSONB)
  → writeBackfill (UPDATE events.event_profile)

Beskrivnings-flöde:
  events.event_profile (inte NULL) → textualFirewall
  → compileWriterInputs (Profile + strukturerade fält, ALDRIG raw_description)
  → writeEditorialDescription (M3, maxTokens=150, temp=0.3)
  → checkFactuality (claims i M3-texten matchar Profile?)
  → checkIndependence (likhet med raw_description som referens)
  → vid fail: regenerera x2 med feedback
  → vid fortsatt fail: fallback FACT/MINIMAL
  → UPDATE events.editorial_description
```

## Begränsningar / känt scope

| Begränsning | Orsak | Påverkan |
|---|---|---|
| M3 pass-rate ~1