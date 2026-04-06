# Phase 1 Reset Report

**Skapad:** 2026-04-06T16:47:47Z
**Phase:** Fas 1 — Reset enligt RebuildPlan.md

---

## Sammanfattning

Denna fil dokumenterar Fas 1-reset av EventPulse source-arkitektur.
Reset genomfördes för att bryta den parallella sanningssituationen mellan
`runtime/sources_status.jsonl`, `sources/*.jsonl` och `C-candidates-queue.jsonl`.

---

## Reset-resultat

| Kategori | Antal |
|----------|-------|
| Total sources | 420 |
| status=success (behållna) | 25 |
| status=untreated (nollställda) | 395 |

---

## Detaljer

### sources/ vs runtime/sources_status.jsonl — inkonsistens före reset

- **420** poster i `sources/*.jsonl`
- **420** poster i `runtime/sources_status.jsonl`
- **Ingen** avvikelse mellan antalet poster (bra)

### preferredPath-fördelning före reset

| preferredPath | Antal (non-success) |
|---------------|----------------------|
| unknown | 402 |
| network | 6 |
| html-heuristics | 7 |
| html | 3 |
| api | 2 |

**12** icke-success-källor hade redan en `preferredPath != unknown`
före reset. Dessa har nu `preferredPath=unknown` i reset-state.

### Gamla filer arkiverade

| Fil | Destination |
|-----|-------------|
| `runtime/sources_status.jsonl` | `runtime/archive/sources_status_PRE_RESET.jsonl` |

Arkivfilen är **bit-identisk** med originalet (md5: `b473783d538da673d97e9adebea8b900`).

---

## Nya filer skapade

| Fil | Syfte |
|-----|-------|
| `runtime/sources_reset_state.jsonl` | Nytt operativt state — **ÄNNU INTE canonical** |
| `runtime/archive/sources_status_PRE_RESET.jsonl` | Bit-exakt kopia av före reset |
| `01-Sources/tools/reset-sources-state.ts` | Reproducerbart reset-script |

---

## VIKTIGT: sources_reset_state.jsonl är INTE canonical ännu

Enligt RebuildPlan.md Fas 3 ska `sources/` vara canonical truth.
`runtime/sources_reset_state.jsonl` är ett **operativt mellansteg**, inte slutlig arkitektur.

**Inga ändringar har gjorts i:**
- `sources/*.jsonl` — canonical truth är orörd
- `runtime/sources_status.jsonl` — original finns kvar som arkiv
- `C-candidates-queue.jsonl` — orörd
- Någon queue-katalog (A/B/C/D/H) — orörd

---

## Reset-logik

### success-källor (n=25)
- `status` behålls som `success`
- All nuvarande metadata bevaras
- `resetAt` och `resetReason` adderas

### untreated-källor (n=395)
- `status` ändrades från föregående värde till `untreated`
- `preferredPath` nollställdes till `unknown`
- All tidigare state (status, attempts, triageHistory, etc.) sparades i `legacyState`-fält
- `resetAt` och `resetReason` adderades

---

## Nästa steg (enligt RebuildPlan)

1. **Fas 2:** Fastställ eller bygg 00A-verktyget (Raw Import Tool)
2. **Fas 3:** Canonical Sources Architecture — bygg sources_v2/ parallellt
3. **Fas 4:** Queue Architecture (A/B/C/D/H)
4. **Fas 5:** Initial Routing — kör routing på reset-state

---

## TODO

- [ ] Verifiera att `runtime/sources_reset_state.jsonl` fungerar som input till Fas 5
- [ ] Granska de 25 success-källorna — ska alla verkligen vara i produktion?
- [ ] Bestäm huruvida de 52 källor som inte finns i C-candidates-queue ska inkluderas
- [ ] Definiera exakt betydelse av `untreated` vs `wrong_type` vs `network_error`
