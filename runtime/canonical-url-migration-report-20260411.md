# Canonical URL Migration Report — 2026-04-11

## Syfte

Reparera befintliga `sources/*.jsonl` så att alla canonical URLs följer exakt samma regler som 00A-ImportRawSources-Tool nu använder. Detta är en migrering av befintlig masterdata, inte en ny import.

## URL-regler som användes (exakt identiska med 00A)

Funktion: `normalizeToCanonicalUrl()` (direkt kopierad från import-raw-sources.ts)

1. **Protokoll**: `http://` eller `https://` bevaras (case-insensitive)
2. **www-stripping**: `www.` prefix tas bort (case-insensitive)
3. **Lowercase**: host-delen lowercasas
4. **Trailing slash**: avslutande `/` tas bort
5. **Root-sökväg**: om ingen path finns läggs `/` till

Funktion: `hasValidProtocol()` — kontrollerar explicit `^https?:\/\//i`

Funktion: `isValidUrl()` — validerar via `new URL()` constructor

## Resultat

| Kategori | Antal |
|----------|-------|
| Totalt source-filer | 425 |
| Redan korrekta | 4 |
| Reparationer | 416 |
| Överhoppade/invalid | 5 |
| Fel | 0 |

## Redan korrekta (4 st)

Dessa följde redan 00A-format:

| sourceId | URL |
|----------|-----|
| fryshuset | https://fryshuset.se/kalendarium |
| g-teborgs-universitet | https://gu.se/evenemang |
| karolinska-institutet | https://ki.se/om/arrangement |
| svenska-schackf-rbundet | https://schack.se/evenemang |

## Överhoppade/invalid (5 st)

Dessa har URL utan protokoll — kan inte repareras automatiskt utan att gissa. Flaggas för manuell review:

| sourceId | Problem | URL |
|----------|---------|-----|
| abf-conflict-1 | Saknar protokoll | abf.se/ |
| dubblett-v2-test | Saknar protokoll | dubblett-v2-test.se/ |
| flaggad-v2-test | Saknar protokoll | flaggad-v2-test.se/ |
| ren-ny-kalla-v2-test | Saknar protokoll | ren-ny-kalla-v2-test.se/ |
| test-write-verify | Saknar protokoll | test-write-verify.se/ |

Alla är test-filer (test artifacts) som aldrig borde ha importerats som riktiga sources.

## Reparationsexempel

Typiska mönster:

| Före | Efter | Förändring |
|-------|-------|-----------|
| https://www.centeraj6.se | https://centeraj6.se/ | -www, +trailing / |
| https://www.liseberg.se | https://liseberg.se/ | -www, +trailing / |
| https://arkdes.se | https://arkdes.se/ | +trailing / |
| https://www.fotografiska.com | https://fotografiska.com/ | -www, +trailing / |

## Reparationslogik

**Lagt till trailing `/`:**
- `https://arkdes.se` → `https://arkdes.se/`
- `https://liseberg.se` → `https://liseberg.se/`

**Tagit bort `www.`:**
- `https://www.centeraj6.se` → `https://centeraj6.se/`
- `https://www.liseberg.se` → `https://liseberg.se/`
- `https://www.fotografiska.com` → `https://fotografiska.com/`

**Lowercase host:**
- `https://www.LISEBERG.SE` → `https://liseberg.se/` (00A lowercasar host)

**Bevarat protokoll:**
- `http://www.venue.se` → `http://venue.se/`
- `https://www.venue.se` → `https://venue.se/`

## Säkerhetskontroller

- **Backup**: Taget innan reparation: `00-Sources/tmp/canonical-url-migration-backup/backup-*.tar.gz`
- **Formatbevarande**: Endast `url`-fältet ändrades — filformat (multi-line JSON) bevarades
- **Inga egna regler**: URL-normaliseringsfunktionerna är identiska med 00A:s
- **Ingen överskrivning**: Test-filer (invalid URLs) lämnades oreparerade

## Teknik

Skript: `00-Sources/00A-ImportRawSources-Tool/migrate-canonical-urls.ts`

Normalisering: exakt kopia av `normalizeToCanonicalUrl()` från import-raw-sources.ts — ingen egen logik.

## Nästa steg

1. Granska de 5 överhoppade test-filerna — bör de tas bort från sources/ helt?
2. Köra 00A-import på nytt för att verifiera att nya importer producerar samma canonical format
3. Köra hela ingestion-pipelinen för att verifiera att inga biverkningar finns
