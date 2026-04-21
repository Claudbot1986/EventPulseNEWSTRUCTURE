# Plan: ScrapingBee Deep Crawl — 95% Coverage

## Mål
Hitta events på 95% av källorna utan att crawla HELA siten (dyrbart).

## Nyckeln: sitemap.xml först

```
sitemap.xml = ALLA sidor på siten = GRATIS = 0 ScB-credits
```

Kostnad per source: **~50 credits max** (istället för 500+ för full crawl)

---

## Full Flow (i prioritetsordning)

### STEG 1: Hämta sitemap.xml

```
Input:  baseUrl (t.ex. https://konstfack.se/)
Output: { urls: string[], found: boolean }
```

**Logik:**
1. Försök: `fetch(baseUrl + "/sitemap.xml")`
2. Om 404: prova `/sitemap-index.xml`, `/wp-sitemap.xml`, `/sitemap.xml.gz`
3. Parsa XML → extrahera alla `<loc>` URLs
4. Returnera lista

**Kostnad:** 0 ScB-credits (vanlig HTTP, ingen rendering)

---

### STEG 2: AI — Välj event-URLs från sitemap

```
Input:  sitemap URLs + sidans HTML/kontext
Output: { eventUrls: string[], reason: string }
```

**Logik:**
1. Be AI (MiniMax/Ollama) analysera sitemap URLs
2. AI没说: "Dessa 5-15 URLs är sannolikt eventsidor"
3. Returnera valda URLs

**Prompt till AI:**
```
Du är en event-discovery assistant. Analysera dessa URLs från sitemap för: https://[site]/

URLs:
- /kalender
- /??==sss0'''sss
- /om
- /event/vernissage
- /kontakt

Vilka 5-15 URLs är SANNOLIKT eventsidor? Svara med bara URL-listan.
```

**Kostnad:** 1 AI-anrop per source (~0.01 credits)

---

### STEG 3: ScB — Fetcha AI-valda URLs

```
Input:  eventUrls (från AI)
Output: { events: ParsedEvent[], fetchedUrls: string[] }
```

**Logik:**
1. För varje AI-vald URL:
   - ScB fetch med `render_js=true`
   - UniversalExtractor: extrakta events
2. Parallellt: 3-5 samtidiga anrop
3. Merge & dedup events

**Kostnad:** 5 credits × antal URLs (max 15 = 75 credits)

---

### STEG 4: Swedish Paths — Fallback (om Steg 1-3 gav få events)

```
Input:  baseUrl
Output: { events: ParsedEvent[], pathsFound: number }
```

**Om Steg 1-3 hittade < 3 events:**

```
Swedish event paths:
/kalender
/kalender/
/evenemang
/evenemang/
/events
/events/
/program
/program/
/biljetter
/biljetter/
/tickets
/tickets/
/whatson
```

**Logik:**
1. För varje Swedish path:
   - ScB fetch: `baseUrl + path`
   - UniversalExtractor: extrakta events
2. Om events hittas → spara

**Kostnad:** 5 credits × 8 paths = 40 credits (endast om nödvändigt)

---

### STEG 5: AI-analys av startsida — Fallback #2

```
Input:  startsida HTML
Output: { eventUrls: string[] }
```

**Om sitemap saknades ELLER Steg 1-4 gav < 3 events:**

**Logik:**
1. ScB fetcha startsida (render_js=true)
2. AI analyserar HTML + nav links
3. AI väljer 5-10 event-liknande links
4. ScB fetcha AI-valda links

**Prompt till AI:**
```
Analysera startsidan för https://[site]/

Hitta alla <a href> links som LEDER TILL EVENT-SIDOR.
Titta på:
- Link text ("Kalendarium", "Evenemang", "Biljetter")
- URL path (/kalender, /events, /program)
- Kontekst runtom (datum, "Boka", "Anmälan")

Svara med bara URLs: /kalender, /event/vernissage, /whatson
```

---

## 95% Coverage Strategy

| Steg | Metod | Coverage* | Kostnad | Prioritet |
|------|-------|----------|---------|-----------|
| 1 | sitemap.xml | 80% | 0 | HÖGST |
| 2 | AI på sitemap | 80% | ~0 | Hög |
| 3 | ScB fetch AI-valda | 80% | ~50 | Hög |
| 4 | Swedish paths | 90% | +40 | Medium |
| 5 | AI på startsida | 95% | +55 | Medium |

*Koverage = % av sites där denna metod fungerar

---

## Priority-Order Execution

```
1. Hämta sitemap.xml
   ↓
   Om sitemap finns (80% av sites):
   ├→ AI väljer event-URLs
   └→ ScB fetchar AI-valda
        ↓
        Om < 3 events:
        └→ Swedish paths fallback

   Om sitemap SAKNAS (20% av sites):
   ├→ AI analyserar startsidan
   └→ ScB fetchar AI-valda
        ↓
        Om < 3 events:
        └→ Swedish paths fallback
```

---

## Swedish Event Paths (exakt lista)

```
/kalender
/kalender/
/evenemang
/evenemang/
/events
/events/
/program
/program/
/biljetter
/biljetter/
/tickets
/tickets/
/whatson
/?view=events
/?type=event
```

---

## Implementation: Nya filer

### `tools/scrapingbeeDeep.ts` (NY)

```typescript
// Steg 1: Hämta sitemap
export async function fetchSitemap(baseUrl: string): Promise<{ urls: string[]; found: boolean }>

// Steg 2: AI — välj event URLs
export async function aiSelectEventUrls(sitemapUrls: string[], siteHtml: string): Promise<string[]>

// Steg 3: ScB fetch
export async function fetchUrls(urls: string[]): Promise<FetchResult[]>

// Steg 4: Swedish paths fallback
export async function testSwedishPaths(baseUrl: string): Promise<EventsResult>

// Steg 5: AI startsida-analys
export async function aiSelectFromHomepage(html: string, baseUrl: string): Promise<string[]>

// Huvudfunktion
export async function fullCrawl(sourceId: string, mode: 'shallow'|'medium'|'deep'): Promise<CrawlResult>
```

### `runC-scrapingbee.ts` (UPPDATERA)

```bash
# Shallow: bara startsida (nuvarande)
npx tsx runC-scrapingbee.ts --mode=shallow

# Medium: sitemap + AI (rekommenderad)
npx tsx runC-scrapingbee.ts --mode=medium

# Deep: sitemap + AI + Swedish paths
npx tsx runC-scrapingbee.ts --mode=deep
```

---

## AI Prompts (till MiniMax/Ollama)

### Sitemap-analys:
```
Du är en event-discovery assistant.
URLs från sitemap för [site]:
[...20-50 URLs...]

Vilka 5-15 URLs är sannolikt EVENTSIDOR (kalender, biljetter, program)?
Svara MED BARRE URL-listan, inget annat.
```

### Startsida-analys:
```
Analysera startsidan för [site].
Hitta alla <a href> links som LEDER TILL EVENT-SIDOR.
Titta på link text, URL path, och kontext runtom.
Svara MED BARRE URL-listan, inget annat.
```

---

## Flags & Modes

| Mode | Steg | ScB-credits | AI-anrop |
|------|------|-------------|----------|
| `--shallow` | bara startsida | 5 | 0 |
| `--medium` | sitemap + AI + 10 URLs | ~55 | 1 |
| `--deep` | sitemap + AI + Swedish paths + 15 URLs | ~100 | 2 |

---

## Output per Source

```typescript
interface CrawlResult {
  sourceId: string;
  eventsFound: number;
  events: ParsedEvent[];
  fetchedUrls: string[];        // URLs som ScB hämtade
  eventUrls: string[];           // URLs som hade events
  method: 'sitemap+ai' | 'homepage+ai' | 'swedish-paths';
  creditsUsed: number;
  exitReason: 'ui' | 'd' | 'manual';
}
```

---

## Max-credits guard

**Max 120 credits/source** — stoppa hellre än överdriva.

```
if (creditsUsed > 120) {
  log('Max credits reached, stopping');
  return partialResults;
}
```

---

## Rate Limiting

**200ms mellan varje ScB-anrop** (undvik burst)
**Max 5 parallella anrop**
**Timeout: 30s per fetch**
