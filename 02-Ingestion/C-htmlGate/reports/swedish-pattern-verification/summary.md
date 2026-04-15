# Swedish Pattern Verification — Summary

**Generated:** 2026-04-12T15:42:16.484Z
**Sources tested:** 14

## Per-Source Summary

| Source | Root URL | Root Density | Patterns Tested | Hits | C2 Hits | Best Pattern | Best Density |
|--------|----------|-------------|----------------|------|---------|--------------|-------------|
| bk-hacken | https://hacken.se/ | 0 | 11 | 0 | 0 | none | 0 |
| blekholmen | https://blekholmen.se/ | 0 | 11 | 0 | 0 | none | 0 |
| boplanet | https://boplanet.se/ | 0 | 11 | 0 | 0 | none | 0 |
| borlange-kommun | https://borlange.se/ | 29 | 11 | 1 | 1 | /evenemang | 116 |
| botaniska-tradgarden | https://botaniska.se/ | 0 | 11 | 0 | 0 | none | 0 |
| brommapojkarna | https://bpxf.se/ | 0 | 11 | 0 | 0 | none | 0 |
| chalmers | https://chalmers.se/ | 0 | 11 | 0 | 0 | none | 0 |
| cirkus | https://cirkus.se/ | 330 | 11 | 2 | 2 | /events | 131 |
| club-mecca | https://clubmecca.se/ | 0 | 11 | 0 | 0 | none | 0 |
| dalarna | https://dalarna.se/ | 0 | 11 | 0 | 0 | none | 0 |
| mittuniversitetet | https://miun.se/evenemang | 2 | 11 | 0 | 0 | /program | 2 |
| kungsbacka | https://kungsbacka.se/ | 69 | 11 | 1 | 1 | /evenemang | 151 |
| h-gskolan-i-sk-vde | https://his.se/evenemang | 0 | 11 | 2 | 2 | /program | 4 |
| malm-opera | https://malmoopera.se/ | 25 | 11 | 0 | 0 | none | 0 |

## Pattern Hit Rate

| Pattern | Hits | Tests | Hit Rate |
|---------|------|-------|----------|
| /events | 1 | 14 | 7% |
| /program | 1 | 14 | 7% |
| /kalender | 0 | 14 | 0% |
| /schema | 1 | 14 | 7% |
| /evenemang | 3 | 14 | 21% |
| /kalendarium | 0 | 14 | 0% |
| /aktiviteter | 0 | 14 | 0% |
| /kultur | 0 | 14 | 0% |
| /fritid | 0 | 14 | 0% |
| /matcher | 0 | 14 | 0% |
| /biljetter | 0 | 14 | 0% |

## Failure Analysis

### All-miss sources (0 hits across all patterns)
- **bk-hacken** (https://hacken.se/): root_density=0 — 0 misses, 0 low_density, 11 errors
- **blekholmen** (https://blekholmen.se/): root_density=0 — 8 misses, 0 low_density, 3 errors
- **boplanet** (https://boplanet.se/): root_density=0 — 0 misses, 0 low_density, 11 errors
- **botaniska-tradgarden** (https://botaniska.se/): root_density=0 — 0 misses, 0 low_density, 11 errors
- **brommapojkarna** (https://bpxf.se/): root_density=0 — 0 misses, 0 low_density, 11 errors
- **chalmers** (https://chalmers.se/): root_density=0 — 0 misses, 0 low_density, 11 errors
- **club-mecca** (https://clubmecca.se/): root_density=0 — 0 misses, 0 low_density, 11 errors
- **dalarna** (https://dalarna.se/): root_density=0 — 0 misses, 0 low_density, 11 errors
- **mittuniversitetet** (https://miun.se/evenemang): root_density=2 — 2 misses, 2 low_density, 7 errors
  → Best attempt: /program density=2, C2=1, reason: C2 miss: score=1, verdict=unclear (threshold=12)
- **malm-opera** (https://malmoopera.se/): root_density=25 — 0 misses, 1 low_density, 10 errors

### C2 hit sources (potential successes if extraction is run)
- **borlange-kommun**: ✅ /evenemang → HTTP=301, density=116, C2 score=145, verdict=promising
- **cirkus**: ✅ /events → HTTP=308, density=131, C2 score=56, verdict=promising
- **kungsbacka**: ✅ /evenemang → HTTP=301, density=151, C2 score=105, verdict=promising
- **h-gskolan-i-sk-vde**: ✅ /program → HTTP=301, density=4, C2 score=56, verdict=maybe

## Root URL Analysis — Already event-specific URLs?
🏠 **bk-hacken**: https://hacken.se/ (root_density=0, root URL)
🏠 **blekholmen**: https://blekholmen.se/ (root_density=0, root URL)
🏠 **boplanet**: https://boplanet.se/ (root_density=0, root URL)
🏠 **borlange-kommun**: https://borlange.se/ (root_density=29, root URL)
🏠 **botaniska-tradgarden**: https://botaniska.se/ (root_density=0, root URL)
🏠 **brommapojkarna**: https://bpxf.se/ (root_density=0, root URL)
🏠 **chalmers**: https://chalmers.se/ (root_density=0, root URL)
🏠 **cirkus**: https://cirkus.se/ (root_density=330, root URL)
🏠 **club-mecca**: https://clubmecca.se/ (root_density=0, root URL)
🏠 **dalarna**: https://dalarna.se/ (root_density=0, root URL)
🏠 **mittuniversitetet**: https://miun.se/evenemang (root_density=2, root URL)
🏠 **kungsbacka**: https://kungsbacka.se/ (root_density=69, root URL)
🏠 **h-gskolan-i-sk-vde**: https://his.se/evenemang (root_density=0, root URL)
🏠 **malm-opera**: https://malmoopera.se/ (root_density=25, root URL)

## C2 Failure Breakdown — density > 0 but C2 rejected
- **mittuniversitetet**: best pattern=/program density=2, C2 score=1 (threshold=12) → C2 miss: score=1, verdict=unclear (threshold=12)

*Full results: 02-Ingestion/C-htmlGate/reports/swedish-pattern-verification/full-results.jsonl*