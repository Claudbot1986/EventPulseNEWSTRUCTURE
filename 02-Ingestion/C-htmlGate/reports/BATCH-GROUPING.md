# C-htmlGate Batch Grouping

## Syfte

Gör framtida C-batchar mer lärorika genom att gruppera källor efter liknande egenskaper istället för slumpmässigt. Batchar med hög homogenitet (lika källor) ger bättre generellt lärande än batchar med blandade källor.

## Problem med nuvarande batchar

### Batch-001 Analys

| Egenskap | Värde |
|----------|-------|
| HeterogeneityScore | high |
| LearningPotential | low |
| SiteFamilies | 4 (kommunal, museum, universitet, idrott) |
| Issues | too-many-site-families, js-rendered-mixed-with-static |

**Problem:** Batch-001 blandar källor från helt olika webbplatstyper:
- Kommunala (SharePoint-baserade)
- Museer (JS-rendered, anpassade)
- Universitet ( blandat)
- Idrottsföreningar (enkla/privata)

Detta gör det omöjligt att identifiera generella HTML-mönster effektivt.

## Grupperingsfält

### siteFamily
```
sharepoint-kommunal    - Kommunala webbplatser (ofta .se)
museum                 - Museer och kulturobjekt
universitet           - Universitet och högskolor
idrott                - Idrottsföreningar
teater                - Teatrar och konserthus
förening              - Övriga föreningar
```

### likelyCms
```
sharepoint            - Microsoft SharePoint
wordpress             - WordPress
custom-js             - Anpassad JS-applikation
sitevision             - SiteVision CMS
wp-plugin             - WordPress med event-plugin
unknown               - Okänt
```

### contentPatternGuess
```
root-event-page       - Event på förstasidan
subpage-event-calendar - Event på undersida/kalender
article-list          - Blogg/nyhetslista
category-page         - Kategorisida
```

### likelyEventPresentation
```
time-tag-list         - Event i <time> element
date-text             - Datum som text
card-grid             - Kortvisning
agenda-list           - Agendalista
calendar-widget       - Kalenderwidget
```

### likelyJsShell
```
none                  - Sannolikt statisk HTML
possible              - Kan vara JS-rendered
likely                - Sannolikt JS-rendered
verified              - JS-rendered bekräftad
```

### candidateDifficulty
```
easy                  - Tydliga HTML-mönster, borde fungera
medium                - Mindre tydliga mönster
hard                  - Komplex struktur eller JS-rendering
unknown               - Behöver undersökas
```

### needsSubpageDiscovery
```
true                  - Event finns på undersidor
false                 - Event finns på förstasidan
unclear               - Behöver undersökas
```

## Idealiskt batchformat för lärande

### Per siteFamily: 3-5 källor
```
batch-NNN-sharepoint: 4 kommunala SharePoint-sajter
batch-NNN-museum: 4 museer
```

### Per contentPattern: 3-5 källor
```
batch-NNN-subpage-calendar: 5 källor med undersidskalendrar
batch-NNN-root-events: 5 källor med förstasidesevent
```

### Max heterogenitet: low
- Max 2 siteFamily per batch
- Max 2 likelyCms per batch
- Max 2 contentPatternGuess per batch

## Framtida batchrekommendation

### Förslag: Omorganisera kvarvarande fail-sources

**Batch-002: SharePoint-kommuner**
```
ifk-uppsala (idrott - kan ha SharePoint)
hallsberg (kommunal - SharePoint)
karlskoga (kommunal - SharePoint)
kumla (kommunal - SharePoint)
orebro-sk (idrott - kan ha SharePoint)
```
→ Lärande: SharePoint-event-mönster

**Batch-003: Museer + Kultursajter**
```
moderna-museet
naturhistoriska-riksmuseet
liljevalchs-konsthall
```
→ Lärande: Museum-event-mönster (JS-rendered?)

**Batch-004: Universitet**
```
kungliga-musikhogskolan
lulea-tekniska-universitet
```
→ Lärande: Universitetskalendrar

## Batch-designregler

1. **Heterogenitet ≤ low** innan batch körs
2. **Max 2 siteFamily** per batch
3. **Max 2 likelyCms** per batch
4. **Minst 3 källor** per grupp för statistisk signifikans
5. **Kör först** de batchar med högst learningPotential

## Körexempel

```bash
# Kontrollera heterogenitet innan batch
grep '"heterogeneityScore": "high"' batch-state.jsonl && echo "STOP - för heterogen"

# Kör endast om learningPotential >= medium
grep '"learningPotential": "low"' batch-state.jsonl && echo "STOP - för lågt lärande"
```
