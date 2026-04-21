# EventPulse

## 1. Projektöversikt

EventPulse är en AI-driven event discovery engine för Stockholm.

Mål:
- samla in verkliga events från externa källor
- normalisera data till en gemensam modell
- visa events i en mobilapp
- använda AI för att tolka och strukturera data (aldrig skapa data)

VIKTIGT:
- Endast verklig eventdata (ingen mock-data)
- Detta är aktivt rootprojekt: `00EVENTPULSE`

---

## 2. Working Directory (KRITISKT)

Denna mapp = root

/workspace = denna mapp

REGLER:
- All kod körs härifrån
- Inga referenser till andra mappar
- Använd aldrig `/workspace/project` eller liknande

---

## 3. Aktuell status

### ✅ Fungerar
- Ticketmaster ingestion (via API-server)
- Kulturhuset ingestion (verifierad verklig källa)
- Supabase lagring
- Events visas i appen (Expo)
- Queue + normalizer pipeline fungerar

### ⚠️ Delvis
- Malmö Live (hämtar data men stort drop-off)
- Discovery (struktur finns men begränsat värde)

### ❌ Problem
- Stockholm-källan var mock-data → borttagen
- Cloudflare blockerar vissa källor
- Stort drop-off mellan fetch → UI
- Ingen observability per source
- UI duplicerar events vid scroll

---

## 4. Arkitektur (kort)

Sources → Ingestion → Queue → Normalizer → DB → Frontend

---

## 5. Dataflöde (VERKLIG PIPELINE + MÅL)

### NUVARANDE PIPELINE

1. Sources (API / scraping)
          ↓
2. Raw event ingestion
          ↓
3. BullMQ Queue (Redis)
          ↓
4. Normalizer Worker
   - deduplication (dedup_hash)
   - field mapping
   - category assignment
          ↓
5. Supabase (events table)
          ↓
6. Frontend (Expo via Supabase REST)

---

### MÅL (AI-ASSISTERAD PIPELINE)

1. Ticketmaster API / andra APIs / scrapers
          ↓
2. Raw event ingestion
          ↓
3. AI-assisted mapping (NYTT LAGER)
   - tolkar rådata → eventmodell
   - föreslår venue/category/url
   - flaggar osäker data
   - FÅR INTE fabricera data
          ↓
4. BullMQ Queue (Redis)
          ↓
5. Normalizer Worker (deterministisk kärna)
   - deduplication (dedup_hash)
   - required field validation
   - final field mapping
   - category assignment
   - reject om låg kvalitet
          ↓
6. Supabase (events table)
          ↓
7. Multi-hop Discovery (framtid)
   - venue → promoter → events → venues
   - expansion queue
          ↓
8. Frontend via Supabase REST API

---

## 6. Körinstruktioner

### Starta Redis (KRITISK)
redis-server

MÅSTE använda:
redis://localhost:6379

---

### Starta API-server (Ticketmaster proxy)
node services/api-server.cjs

---

### Starta ingestion
cd services/ingestion
npm run dev

---

### Starta app (Expo)
npm start

VIKTIGT:
- använd LAN (inte tunnel)
- mobil måste nå din dator via IP

---

## 7. Viktiga tekniska regler

- Expo får INTE anropa Ticketmaster direkt
- API-server MÅSTE användas
- localhost fungerar inte från mobil → använd LAN-IP
- Alla sources måste gå via ingestion → Supabase → UI
- Ingen direktkoppling source → frontend

---

## 8. Agent-regler (KRITISKT)

- Ändra endast i /workspace
- Inga externa referenser
- Ingen mock-data
- Ingen fake-data
- Behåll fungerande pipeline
- Testa alltid med verklig körning

Pipeline-regel:
- Om källa inte fungerar → returnera 0 events
- ALDRIG generera sample/mock events

AI-regel:
- AI får tolka data
- AI får INTE skapa data
- AI får INTE gissa datum/venue/url

---

## 9. Kända problem

- Malmö Live: stort drop-off
- Kulturhuset: färre events än API
- UI: duplicering vid scroll
- Observability saknas (ingen stegvis loggning)
- Cloudflare blockerar vissa källor

---

## 10. Pipeline (sanning)

Source → ingestion → queue → normalizer → Supabase → frontend → UI

För VERIFIED krävs:
- riktig data
- hela kedjan fungerar
- data i DB
- data i UI

---

# EventPulse Roadmap & Status

## 🎯 Current Focus (NU)
- [ ] End-to-end stabil ingestion (2 källor)
- [ ] Ingen mock-data
- [ ] Source_counts stämmer

---

## 🚀 Phase 1 – Stable Ingestion
- [x] Ticketmaster (verified)
- [x] Kulturhuset (verified)
- [ ] Malmö Live (fix drop-off)
- [ ] Stockholm (DISABLED – mock-data)

---

## 🔍 Phase 2 – Observability
- [ ] fetched / parsed / filtered / normalized / upserted
- [ ] drop-off per steg
- [ ] debug per source

---

## 🧱 Phase 3 – Data Quality
- [ ] unified event shape
- [ ] required fields
- [ ] dedupe engine
- [ ] venue consistency
- [ ] category_slug consistency
- [ ] NO MOCK DATA

---

## 🧠 Phase 4 – Intelligence
- [ ] AI-assisted mapping
- [ ] confidence scoring
- [ ] field provenance
- [ ] AI tolkar, aldrig fabricerar

---

## 🌐 Phase 5 – Expansion
- [ ] fler källor
- [ ] multi-hop discovery
- [ ] venue graph

---

## 📱 Phase 6 – Frontend
- [ ] bättre filter
- [ ] source filtering
- [ ] event detail page
