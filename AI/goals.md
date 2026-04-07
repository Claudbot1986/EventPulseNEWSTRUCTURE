# Goals: EventPulse Source Pipeline

## Syfte
Styrande referens för AI-agenter. Målbild: ett intelligent system som hittar, testar, väljer och promotar rätt källa med billigaste stabila väg först.

Projektets mappstruktur speglar pipeline-stegen:

00-ScoutingEvidence → rå bevisinsamling och manuella tester
01-Sources → källbeskrivningar, adapters och promotion
02-Ingestion → fetch + path-val + extraction
03-Queue → kö och raw events
04-Normalizer → mapping, confidence, dedup, canonicalization
05-Supabase → lagring
06-UI → verifiering i frontend
07-Discovery → expansion, relaterade venues/källor
08-testResults → verifieringar och regressionstest

---

# 00-ScoutingEvidence

Ansvar:
- Spara scouting-resultat
- Spara HTML, JSON-LD, network traces, screenshots
- Avgöra om källa verkar lovande eller ska till manual-review

Exempel:
- JSON-LD hittad
- Möjlig intern API-endpoint
- HTML-block med eventlista
- Kräver render/headless

---

# 01-Sources

Ansvar:
- Varje källa har egen mapp eller adapter
- Promotion från heuristik → dedikerad adapter
- Källor som fungerar stabilt flyttas hit permanent

En källa promotas hit när:
- Stabil struktur
- Låg felgrad
- Tillräckligt rik data
- Rimlig underhållskostnad

---

# 02-Ingestion

Här sker själva path-valet.

## Path-ordning

### 1. JSON-LD Fast Path
Först testas om sidan innehåller schema.org/Event eller annan JSON-LD.

Plats:
- `02-Ingestion/F-eventExtraction/`
- `02-Ingestion/phase1ToQueue.ts`

Verifierad:
- Eventbrite Stockholm (2026-03-28) — 46 events genom full pipeline

Om JSON-LD fungerar:
→ direkt till queue

---

### 2. Network Path
Om JSON-LD saknas:
Undersök om sidan laddar event via interna XHR/API-anrop.

Plats:
- `02-Ingestion/B-JSON-feedGate/`
- `02-Ingestion/networkInspector.ts`

Regel:
Network path används endast om endpointen ger renare, mer komplett och stabilare data än HTML-path.

Om network-resultatet är oklart eller sämre:
→ fallback till HTML-path

---

### 3. HTML Path
Om varken JSON-LD eller bättre network-endpoint finns:
analysera repetitiva HTML-block och DOM-struktur.

Plats:
- `02-Ingestion/C-htmlGate/`

Extrahera minst:
- title
- start_date
- venue
- city
- event URL
- ticket URL

---

### 4. Render / Headless Path
Om sidan kräver JavaScript och inte går att lösa via JSON-LD, Network eller HTML.

Plats:
- `02-Ingestion/D-renderGate/`

Använd:
- Cloudflare Browser Rendering
- Headless browser

Regel:
Dyraste vägen. Använd endast när HTML-path misslyckas.

---

# 03-Queue

Ansvar:
- Ta emot RawEventInput
- Köra BullMQ / Redis
- Säkerställa att ingestion inte tappar events

Plats:
- `03-Queue/queue.ts`

---

# 04-Normalizer

Ansvar:
- Mappa till standardformat
- Confidence scoring
- Dedup
- Venue matching
- Canonicalization

## Core fields
- title
- start_date
- venue
- city
- event_url
- ticket_url
- status
- source
- raw_payload

## Confidence-scoring

Positivt:
- tydligt datum
- tydlig titel
- venue
- detaljsida
- ticket-url
- konsekvent struktur

Negativt:
- blogg/nyhet-mönster
- saknat datum
- brutna länkar
- inkonsekvent struktur

## Dedup
- source_id/url exakt
- title + date + venue fuzzy

Serie och enskilt event hanteras separat.

---

# 05-Supabase

Ansvar:
- Spara normaliserade events
- Spara venues
- Spara discovery-resultat
- Möjliggöra verifiering mot verklig data

---

# 06-UI

Ansvar:
- Verifiera att riktiga events visas korrekt
- Ingen mock-data
- End-to-end betyder:
source → ingestion → queue → normalize → database → UI

---

# 07-Discovery

Ansvar:
- Hitta fler källor och venues
- venue → promoter → events → venues
- Hjälpa systemet mogna från heuristik till riktiga adapters

---

# 08-testResults

Ansvar:
- Regressionstest
- Bevis på att en path fungerar
- Spara verifieringar som:
  - JSON-LD fungerar
  - Network fallback fungerar
  - HTML fallback fungerar
  - Render krävs

---

# Slutprincip

EventPulse är inte en enda scraper.

Det är ett intelligent flerstegssystem där:
1. billigaste stabila väg testas först
2. fallback sker stegvis
3. bra källor promotas till riktiga adapters
4. verifiering avgör sanningen
