# Queue Architecture — Fas 4

**Fas:** 4 av RebuildPlan.md
**Status:** Implementerad — ej aktiverad (Fas 5 = initial routing)
**Datum:** 2026-04-07

---

## 1. Grundprincip

Köerna A/B/C/D/H är **tunna operativa lager** — inte egna masterregister.

- `sources/` (under 00-Sources/) är den enda canonical sanningen
- Varje queue-post refererar till en sourceId och lägger till endast queue-specifik metadata
- Köerna får inte duplicera source-sanning

---

## 2. Köstruktur

```
02-Ingestion/
  A-Direct-API/A-queue/      ← Network/API-källor
  B-networkGate/B-queue/     ← JSON/feed-källor
  C-htmlGate/C-queue/        ← HTML-källor
  D-renderGate/D-queue/      ← JS-render-källor
  H-manualReview/H-queue/     ← Manuellt granskning
```

---

## 3. Queue-postmodell

### 3.1 Obligatoriska fält

| Fält | Typ | Beskrivning |
|------|-----|-------------|
| `sourceId` | `string` | Pekar till `sources/{id}.jsonl` — enda kopplingen till canonical source |
| `queuedAt` | `string` (ISO 8601) | När source lades i kön |
| `queueName` | `'A' \| 'B' \| 'C' \| 'D' \| 'H'` | Vilken kö |
| `attempt` | `number` | Antal behandlingsförsök (start: 0 eller 1) |

### 3.2 Valfria fält

| Fält | Typ | Beskrivning |
|------|-----|-------------|
| `priority` | `number` | Lägre = högre prioritet. Default: 100 |
| `queueReason` | `string` | Kort motivering varför källan är i denna kö |
| `workerNotes` | `string?` | Frivillig anteckning från worker (max 200 tecken) |

### 3.3 Exempel: C-queue-post

```json
{
  "sourceId": "moderna-museet",
  "queuedAt": "2026-04-07T18:30:00.000Z",
  "queueName": "C",
  "attempt": 1,
  "priority": 100,
  "queueReason": "HTML-candidate, C0 candidate discovered"
}
```

---

## 4. Vad som INTE får ligga i en queue-post

Följande fält är **förbjudna** i queue-poster (de finns redan i `sources/`):

- `url` — finns i source-filen
- `name` — finns i source-filen
- `type`, `city`, `discoveredAt`, `discoveredBy` — finns i source-filen
- `preferredPath`, `preferredPathReason` — routingbeslutstillhörighet, inte queue-metadata
- `verifiedAt`, `needsRecheck` — lifecycle-fält, inte queue-specifika
- `metadata` — all metadata finns i source-filen
- `grouping` — Pre-C-gruppering, inte queue-specifik
- Raw event-data, HTML, eller annat som gör kön till ett andra source-register

---

## 5. Jämförelse: source vs. queue-post

### Source-post (`sources/abf.jsonl`)

```json
{
  "id": "abf",
  "url": "https://www.abf.se",
  "name": "ABF",
  "type": "förening",
  "city": "Stockholm",
  "discoveredAt": "2026-04-04T00:00:00.000Z",
  "discoveredBy": "RawSources20260404",
  "preferredPath": "unknown",
  "preferredPathReason": "Initial import from RawSources20260404.md: Studieförbund",
  "verifiedAt": null,
  "needsRecheck": true,
  "metadata": {
    "rawSourceFile": "RawSources20260404.md",
    "rawCity": "Stockholm"
  }
}
```

### Motsvarande C-queue-post (`C-queue/abf.jsonl`)

```json
{
  "sourceId": "abf",
  "queuedAt": "2026-04-07T18:30:00.000Z",
  "queueName": "C",
  "attempt": 1,
  "priority": 100,
  "queueReason": "HTML-candidate, C0 candidate=/kalender/ discovered"
}
```

**Skillnaden:** Queue-posten innehåller INTE url, name, type, city, metadata.

---

## 6. Förhållande till befintliga strukturer

### 6.1 `C-candidates-queue.jsonl` (befintlig, ej tunn)

Den befintliga `C-candidates-queue.jsonl` innehåller **fullständiga source-kopior** — inte tunna poster.
Den ska **inte** användas som queue i den nya arkitekturen.
Den representerar ett äldre arbetsflöde (C-batch-maker) och bör betraktas som legacy.

### 6.2 `pendingRenderQueue.ts` (befintlig)

`runtime/pending_render_queue.jsonl` (via `tools/pendingRenderQueue.ts`) innehåller redan tunna poster
med endast `url`, `sourceName`, `reason`, `signal`, `confidence`, `detectedAt`, `attemptedPaths`.
**Denna struktur är redan tunn** och liknar den nya queue-modellen.
Denna fil används av `D-renderGate/D-queue/` som mellanlagring.

### 6.3 `phase1ToQueue.ts` (befintlig)

Denna fil hanterar redan händelseflöde (events → rawEventsQueue) men är inte en queue-arkitekturfil.
Den ska inte ändras.

---

## 7. Nästa steg: Fas 5 (Initial Routing)

I Fas 5 ska varje source i `sources/` tilldelas:

- `currentQueue` — vilken kö den tillhör
- `routingConfidence` — low / medium / high / verified
- `routingReason` — konkret orsak
- `routedAt` — ISO timestamp
- `route-history` — array av tidigare köbeslut

**Samtidigt** ska en queue-post skapas i motsvarande queue-mapp.

**OBS:** Routinglogik ska inte implementeras i denna fas.

---

## 8. Filspecifikation

### 8.1 Queue-post-fil

- Filnamn: `{sourceId}.jsonl` (samma sourceId som i `sources/`)
- Format: En queue-post per rad (JSONL)
- Plats: `XX-queue/` i motsvarande gate-mapp

### 8.2 Ingen parallel source-sanning

Varje queue-post ska endast innehålla fält enligt avsnitt 3.
Om verktyg eller worker behöver tillgång till source-metadata,
läses den från `sources/{sourceId}.jsonl`.

---

## 9. TODO (ej implementerat ännu)

- [ ] Fas 5: Initial routing — kör alla sources och skapa queue-poster
- [ ] Fas 5: Uppdatera source-filer med `currentQueue`, `routingConfidence`, `routingReason`, `routedAt`, `route-history`
- [ ] Verifieringsregler för flytt mellan köer (Fas 8)
- [ ] C-Batchmaker (Fas 6)
- [ ] 123-loop förbättringar (Fas 7)
