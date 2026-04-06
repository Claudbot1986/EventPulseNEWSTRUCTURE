# CANONICAL SOURCES ARCHITECTURE — Fas 3 Design

**Fas:** 3 av RebuildPlan.md
**Status:** Analys och design — INGEN migrering ännu
**Datum:** 2026-04-06

---

## 1. Nulägesproblem

### 1.1 Fil-per-source vs site-level identity

Nuvarande `sources/` har **420 filer** men varje fil representerar en rad
i en importlista — inte en site-level canonical source. Samma hostname
kan ha flera filer.

**Korrigerad analys med canonical-collision-detector.ts:**

| Kategori | Antal hostname-grupper | Antal filer | Exempel |
|----------|------------------------|-------------|---------|
| Type C (Olika paths, samma hostname) | 13 | 37 | www.vasteras.se → 4 paths (/konserthus, /konstmuseum, /, /stadsteatern) |
| Type A (Olika venues, samma hostname) | 9 | 19 | www.stadsteatern.se → Göteborgs + Stockholms |
| Type B (Samma venue, duplicerad import) | 1 | 2 | www.uppsala-stadsteatern.se |
| 1 fil per hostname | ~396 | 396 | Normalt |

**Totalt:** 23 hostname-grupper med 51 duplicerade filer.

**Viktigt:** Type C är INTE kollisioner i traditionell mening — dessa 13
kommunala sajter HAR verkligen olika subsidor för konserthus, konstmuseum,
stadsteater etc. Site-level deduplication BEHÖVER besluta huruvida dessa
ska vara en enda source (kommunen) eller hanteras som sub-venues.
RebuildPlan.md-flaggan "TODO: edge case" avser dessa.

---

## 2. Målmodell

### 2.1 sourceIdentityKey = hostname (site-level)

All deduplication och matchning sker på hostname.
`normalizeToSiteIdentityKey()` stripping: protocol, www, path.

### 2.2 Obligatoriska fält per canonical source

```typescript
interface CanonicalSource {
  // ── Identity ─────────────────────────────────
  sourceId:        string;   // stabilt id, genererat från siteIdentityKey
  sourceIdentityKey: string; // hostname (t.ex. "liseberg.se")
  canonicalUrl:    string;   // repr. URL med path för audit (t.ex. "liseberg.se/")

  // ── Master metadata ────────────────────────────
  name:            string;
  city:            string;
  type:            string;   // nöje | teater | museum | etc.
  discoveredAt:    string;   // ISO-datum
  discoveredBy:    string;  // källa för upptäckt

  // ── Routing ───────────────────────────────────
  preferredPath:  'network'|'json'|'html'|'render'|'unknown';
  preferredPathReason: string;
  routingConfidence: 'low'|'medium'|'high'|'verified';
  routingReason:   string;
  routeHistory:    Array<{
    queue: string;
    reason: string;
    confidence: string;
    at: string;
  }>;

  // ── Operativ status ────────────────────────────
  currentQueue:    'A'|'B'|'C'|'D'|'H'|null;
  lastRouteChange: string|null; // ISO-datum
  needsRecheck:    boolean;
  systemVersionAtDecision: string|null;

  // ── Source quality ─────────────────────────────
  verifiedAt:      string|null;
  lastVerifiedPath: string|null;
  consecutiveFailures: number;

  // ── Original rows (för audit och dedup) ───────
  originalRows:    Array<{
    name: string;
    url: string;
    city: string;
    type: string;
    note: string;
    importedAt: string;
  }>;
}
```

### 2.3 sources_v2/ parallell struktur

```
NEWSTRUCTURE/
  sources/              ← Nuvarande, orörd
  sources_v2/           ← Ny canonical structure (ej aktiv ännu)
    _meta/
      schema.md         ← Fältdefinitioner
      migration-log.md   ← Dokumentation av eventuella ändringar
    _canonical/
      liseberg.se.jsonl
      gronalund.se.jsonl
      aik.se.jsonl
      ...
    _staging/
      import-preview-001.jsonl
      import-preview-002.jsonl
    _collision-report/
      unresolved-*.jsonl   ← Identifierade kollisioner för manuell granskning
    _tools/
      canonical-validate.ts
      collision-detector.ts
```

### 2.4 sourceId-generering (oförändrad)

Befintlig logik i import-raw-sources.ts används:
- Strippa .se/.no/.dk/.fi/.nu
- ÅÄÖ → A, Ö → O
- _- → -
- Max 40 tecken

---

## 3. Rekommenderad parallell struktur

### 3.1 Steg 1 — sources_v2/ skapas tom

Inga filer skrivs ännu. Endast mappstruktur och schema skapas.

### 3.2 Steg 2 — Collision report generator

Ett ofarligt skript (`canonical-collision-detector.ts`) som:
- Läser befintliga `sources/*.jsonl`
- Grupperar på sourceIdentityKey (hostname)
- Rapporterar kollisioner till `_collision-report/`
- Skriver INTE till `sources/`

### 3.3 Steg 3 — Manuell granskningsfas

Output från collision-detectorn granskas manuellt.
Beslut perHostname:
- `merge` → rätt rad vinner, övriga blir originalRows
- `keep-separate` → hostname har flera venues (flaggas)
- `fix` → hostname stämmer inte (t.ex. liseberg-1 fel hostname)

### 3.4 Steg 4 — Preview-migrering

Godkända sources skrivs till `sources_v2/_canonical/` som preview.
Ingen runtime påverkas.

### 3.5 Steg 5 — Switch-over

Efter verifiering:
- `sources/` döps om till `sources_legacy/`
- `sources_v2/` döps om till `sources/`
- switch dokumenteras i `_meta/migration-log.md`

---

## 4. Risker

| Risk | Mitigation |
|------|------------|
| `sources/` skrivs till av misstag | Skrivskydd (read-only verify) i alla verktyg |
| Dubbla canonical truths | Endast en aktiv källa — dokumenterad switch-regel |
| Manuell granskning blir flaskhals | Prioritera Typ B (klara merges) före Typ A (svårare) |
| sourceId-kollisioner vid merge | Kollisionsdetektor hanterar, winner-regel: lexically first sort() |
| Runtime läser från fel mapp | Switchover är atomisk: mkdir → rename → verify |

---

## 5. INTE ÄNNU — vad som INTE ska göras i denna fas

- [ ] Migrera data från `sources/` till `sources_v2/`
- [ ] Skriva till `sources/` i något steg
- [ ] Ändra `runtime/sources_status.jsonl`
- [ ] Ändra queue-arkitektur, routing, C-htmlGate
- [ ] Bygga merge-logic in i import-raw-sources.ts
- [ ] Ta bort eller döpa om `sources/`
- [ ] Ändra 123-loopen

---

## 6. Nästa lilla implementationsteg (Fas 3.1)

**Endast detta:**
1. Skapa `sources_v2/_meta/schema.md` med CanonicalSource-typexempel
2. Skapa `sources_v2/_canonical/.gitkeep`
3. Skapa `sources_v2/_tools/canonical-collision-detector.ts` (read-only rapport)
4. Kör rapporten en gång mot nuvarande `sources/`
5. Spara collision report i `sources_v2/_collision-report/initial-findings.jsonl`
6. Commit

Ingen data migreras. Ingen runtime påverkas.
