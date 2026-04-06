# 00A Idempotence Verification

**Date:** 2026-04-06
**Tool:** `00-Sources/00A-ImportRawSources-Tool/import-raw-sources.ts`
**Version:** v3 (site-level identity)

---

## Test Setup

### Input: `/tmp/test-raw-sources-v3.md`

```
8 rows:
1. Liseberg               | https://www.liseberg.se          | (new — matches existing)
2. Liseberg Evenemang     | https://liseberg.se/evenemang/   | (dup of above)
3. Liseberg Biljetter     | https://www.liseberg.se/biljetter| (dup of above)
4. AIK                    | https://www.aik.se/              | (matches existing)
5. AIK Fotboll            | https://AIK.se                   | (dup of above)
6. Unga Teatern           | https://www.ungateatern.se       | (matches existing)
7. Helt Ny Källa          | https://www.nyttest.se           | (truly new)
8. Pustervik              | https://www.pustervik.nu         | (matches existing)
```

### Environment
- `sources/` dir: 420 source files
- Existing sources loaded: 392 (after site-level dedup of collisions)

---

## Run 1 Results

```
Raw rows parsed:              8
NEW sources:                 1
MATCHED existing:            4
DUPLICATE rows in import:    3
Total output sources:         5
```

Sources:
1. liseberg-n-je → matched_existing, name="Liseberg (nöje)"
2. aik → matched_existing, name="AIK"
3. unga-teatern → matched_existing, name="Unga Teatern"
4. nyttest → new
5. pustervik → matched_existing, name="Pustervik"

---

## Run 2 Results

**Same input, same command, second execution.**

```
Raw rows parsed:              8
NEW sources:                 1
MATCHED existing:            4
DUPLICATE rows in import:    3
Total output sources:         5
```

Sources: Identical to Run 1.

---

## Deep Comparison

All 5 output sources: **IDENTICAL** between Run 1 and Run 2.

Fields compared:
- `sourceId` ✓
- `sourceIdentityKey` ✓
- `canonicalUrl` ✓
- `name` ✓
- `city` ✓
- `type` ✓
- `discoveredAt` ✓
- `note` ✓
- `isDuplicate` ✓
- `originalRows` ✓
- `matchStatus` ✓
- `matchedBy` ✓
- `existingSource.id` ✓
- `existingSource.name` ✓
- `existingSource.preferredPath` ✓

---

## Non-Determinism Risk Discovered and Fixed

### Problem: `readExistingSources` used unsorted file listing

`fs.readdirSync()` does not guarantee order. If two source files share the same
hostname (site-level collision), the first one alphabetically wins.

**Example found:**
- `liseberg.jsonl` → id=liseberg, url=https://www.liseberg.se
- `liseberg-n-je.jsonl` → id=liseberg-n-je, url=https://www.liseberg.se

Both map to siteIdentityKey `liseberg.se`. Without sorting, which one loads
first is non-deterministic.

**Fix applied:** Added `.sort()` to file listing in `readExistingSources()`.
This guarantees the same file always wins for a given siteKey.

---

## Remaining Edge Cases (TODO)

These are NOT bugs in the current test, but documented for future reference:

1. **Source name for matched_existing comes from import row, not existing source.**
   If import file says "AIK Fotboll" and existing source says "AIK", the preview
   will show "AIK Fotboll". This is deterministic but potentially confusing.
   **Action:** Document this; consider whether name from existing source should
   take precedence.

2. **canonicalUrl for matched_existing comes from first matching import row.**
   Same as above — if multiple rows match the same site, the first row in the
   import file determines canonicalUrl and name. This is deterministic for a
   given import file order.

3. **Subtle ordering dependency in originalRows.**
   The order of `originalRows[]` reflects the import file row order, which is
   deterministic for a given input. No fix needed.

---

## Conclusion

**Status:** ✓ IDEMPOTENT (after fix)

The tool produces identical output when run twice with the same input file
and the same `sources/` directory. The non-determinism in file ordering
has been fixed by adding `.sort()`.

**Conditions for idempotence:**
1. Same input file (same rows in same order)
2. Same `sources/` directory content
3. Same code version

If any of these change, output may differ — which is correct behavior.

---

## Commit

Fix applied: `fs.readdirSync().sort()` in `readExistingSources()`.
