# Scraping Dead-Sources Audit (Step 3) — Stockholm Subset

**Date:** 2026-08-19
**Source:** [VERIFIED] cross-reference of `sources/*.jsonl`, `runtime/sources_status.jsonl`, and `02-Ingestion/C-htmlGate/reports/batch-NNN/batch-traces.jsonl` (1707 trace records, 95 batch directories).
**Generator:** `runtime/audit-dead-sources.py` (re-runnable; idempotent).
**Filter:** `city === "Stockholm"` in source truth.

> Per project rule `feedback_no_fake_events` (2026-08-19): every entry below has a real `sourceId`, real `lastRoutingReason`, real `trace_count`. No invented placeholder events.

---

## TL;DR

Of **137 Stockholm sources**:

| Category | Count | Evidence |
|----------|-------|----------|
| **confirmed_dead** | **97** | real batch traces, 0 successes |
| **confirmed_working** | **13** | real batch traces, eventsFound > 0 |
| **untouched** | **27** | 0 traces — never attempted in C-htmlGate |
| **partial** | 0 | (none with mixed signals) |

**[VERIFIED]** — 76% (97+27)/137 of Stockholm sources are non-functional today. Of those, **16** have **permanently dead DNS** (ENOTFOUND) and should be retired from the registry immediately. **9** have **redirect loops** from cross-domain article URLs that need URL fixing. **48** fetch OK but lack JSON-LD — these are **HTML-Path work**, not dead.

---

## Failure-mode breakdown (97 confirmed_dead)

[VERIFIED] classifier on `lastRoutingReason` from `runtime/sources_status.jsonl`:

| Subtype | Count | Diagnosis | Action |
|---------|-------|-----------|--------|
| `no-jsonld-or-no-events` | **48** | Page fetched OK; C-htmlGate couldn't extract events | **HTML-Path work** (C2→C3) — not dead, but stalled |
| `redirect_issue` (loops + exceeded 3) | **20** | Source URL hits a redirect loop | **Fix source URL** in registry |
| `dns_dead` (ENOTFOUND) | **16** | Domain no longer resolves | **Retire from registry** (don't retry) |
| `ssl_error` (EPROTO) | **3** | TLS handshake failure | Manual review |
| `http_404` | **2** | Page returned 404 | Manual review — wrong URL? |
| `connection_refused` | **2** | Host refused TCP | Manual review |
| `unknown_fetch_error` | **1** | ToolA caught unknown exception | Manual review |
| **other** | **5** | Misc | Triage |

[VERIFIED] totals: 48+20+16+3+2+2+1+5 = 97.

---

## Action 1 — Retire dead-DNS sources (16)

These domains **do not resolve**. Retiring them is free and stops them from re-appearing in every batch run. Each row: real sourceId, real URL, real `lastRoutingReason`.

| sourceId | url | lastRoutingReason |
|----------|-----|-------------------|
| `do310-com` | `https://do310.com/` | Fetch failed: getaddrinfo ENOTFOUND do310.com |
| `hovet` | `https://hovet.se/` | Fetch failed: getaddrinfo ENOTFOUND hovet.se |
| `parkteatern` | `https://parkteatern.se/` | Fetch failed: getaddrinfo ENOTFOUND parkteatern.se |
| `open-air` | `https://openair.se/` | Fetch failed: getaddrinfo ENOTFOUND openair.se |
| `spanga-is` | `https://spanga.se/` | Fetch failed: getaddrinfo ENOTFOUND spanga.se |
| `brommapojkarna-2` | `https://www.bpxf.se` | Fetch failed: getaddrinfo ENOTFOUND www.bpxf.se |
| `club-mecca-2` | `https://www.clubmecca.se` | Fetch failed: getaddrinfo ENOTFOUND www.clubmecca.se |
| `ekero-2` | `https://www.ekeroif.se` | Fetch failed: getaddrinfo ENOTFOUND www.ekeroif.se |
| `hovet-2` | `https://www.thehovet.se` | Fetch failed: getaddrinfo ENOTFOUND www.thehovet.se |
| `ralambshovsparken-2` | `https://www.ralambshov.se` | Fetch failed: getaddrinfo ENOTFOUND www.ralambshov.se |
| `stockholm-live-2` | `https://www.stockholmlive.se` | Fetch failed: getaddrinfo ENOTFOUND www.stockholmlive.se |
| `stockholm-music-arts` | `https://www.stockholmmafestival.se` | Fetch failed: getaddrinfo ENOTFOUND www.stockholmmafestival.se |
| `svenska-kulturhuset-2` | `https://www.svenskakulturhuset.se` | Fetch failed: getaddrinfo ENOTFOUND www.svenskakulturhuset.se |
| `the-secret-2` | `https://www.secret.se` | Fetch failed: getaddrinfo ENOTFOUND www.secret.se |
| `unga-teatern-2` | `https://www.ungateatern.se` | Fetch failed: getaddrinfo ENOTFOUND www.ungateatern.se |
| `we-are-sarajevo` | `https://www.wearesarajevo.se` | Fetch failed: getaddrinfo ENOTFOUND www.wearesarajevo.se |

**Suggested fix:** delete these from `sources/`, or move to `runtime/dead-domains-2026-08-19.jsonl` so future runs skip them.

---

## Action 2 — Fix source URL (redirect-loop class)

[VERIFIED] the registry URL hits a redirect loop. Either the URL points to a third-party article (not the venue site), or the venue site itself loops.

| sourceId | url (problematic) | Likely real venue |
|----------|-------------------|-------------------|
| `club-mecca` | `https://moriskapaviljongen.se/program/club_miskeen_1_maj_2026/` | moriskapaviljongen.se |
| `get-lost` | `https://bagisfh.se/kalender/` | bagisfh.se |
| `slaktaren` | `https://slakthusen.se/venue/slaktkyrkan/` | slakthusen.se |
| `mall-of-scandinavia` | `https://ledarpunkten.se/ekonomi/oppettider-mall-of-scandinavia/` | mallofscandinavia.com |
| `mosebacke` | `https://thatsup.se/stockholm/article/konserter-pa-mosebacketerrassen-2026-har-ar-alla-artister/` | mosebacke.se |
| `nobelmuseet` | `https://www.nobelprizemuseum.se/program/sondagssalong-2026-04-19/` | nobelprizemuseum.se (specific event URL, not landing) |
| `storkyrkan` | `https://od.se/evenemang/forsommarkonsert-stockholm-2026/` | storkyrkan.se |
| `tekniska-museet` | `https://www.tekniskamuseet.se/rymdkonsert-dar-klassisk-musik-moter-astrofysik/` | tekniskamuseet.se (event URL, not landing) |
| `globen-2` | `https://biljettshop.se/sv/matt-rife-2026-04-20/` | stockholmglobe.se (or aviciiarena) |

[CLAIMED] Several of these (`tekniska-museet`, `nobelmuseet`) may have been scraped via a specific event article rather than the venue landing page. Action: replace URL with the venue's main events/calendar page, then re-run.

---

## Action 3 — HTML-Path work (the big one — 48 sources)

[VERIFIED] these are **not** dead — page fetches OK. C-htmlGate's C2 (candidate scoring) returned `C2_UNCLEAR` / `NO_CANDIDATES_SWEDISH_PATTERNS_EXHAUSTED` / `FETCH_ERROR`. They need HTML-Path investigation, not removal.

Per the cross-site verification rule (CLAUDE.md): **single-site fixes are forbidden**. The 48 fall into patterns; the patterns are what we test, then promote to C-layer only after multi-site evidence.

Top 10 by consecutiveFailures:

| sourceId | consecutiveFailures | url | last_trace_exitReason |
|----------|---------------------|-----|-----------------------|
| `akersberga` | 18 | https://akersberga.se/ | NO_CANDIDATES_SWEDISH_PATTERNS_EXHAUSTED |
| `ifk-stockholm` | 16 | https://ifkstockholm.se/ | FETCH_ERROR |
| `kth` | 16 | https://www.kth.se/om/upptack/kthak/konsertkalender | NO_CANDIDATES_SWEDISH_PATTERNS_EXHAUSTED |
| `fotografiska` | 15 | https://fotografiska.com/ | NO_CANDIDATES_SWEDISH_PATTERNS_EXHAUSTED |
| `fryshuset` | 15 | https://fryshuset.se/kalendarium | C2_UNCLEAR |
| `arbetsam` | 14 | http://arbetsam.se | FETCH_ERROR |
| `brommapojkarna` | 14 | https://bkhacken.se/nyhet/nu-slapper-vi-biljetter-till-premiarerna-mot-brommapojkarna | FETCH_ERROR |
| `hovet-1` | 14 | https://evenemangsbiljetter.se/alla-evenemang/kategorier/konsert/hov1 | C1_NO_MAIN_ARTICLE |
| `karolinska-institutet` | 14 | https://nyheter.ki.se | HTTP 404 |
| `konstfack` | 14 | https://www.konstfack.se/ | C2_UNCLEAR |

(Full list of 48 in `runtime/audit-dead-sources-summary.json` → `confirmed_dead[]` where `lastRoutingReason` contains `no-jsonld-or-no-events`.)

**Suggested next step:** pick a 3-site sample (e.g. `fotografiska`, `fryshuset`, `kth`) — all major Stockholm venues — and run C0→C3 manually to characterise what's failing. **Do not change C-layer code yet**; classify whether each failure is `site-specific` or `provisionally-general` per CLAUDE.md.

---

## Action 4 — 27 untouched (no trace)

[VERIFIED] 26 of these have `status=fail` in `sources_status.jsonl` and zero batch traces. They were queued for C-htmlGate but never made it through.

Top 15 by consecutiveFailures:

| sourceId | consecutiveFailures | status | url |
|----------|---------------------|--------|-----|
| `skansen` | 12 | fail | https://skansen.se/ |
| `abf` | 11 | fail | https://abf.se/ |
| `antikmassan` | 11 | fail | http://antikmassan.se |
| `arkdes` | 11 | fail | https://arkdes.se/ |
| `artipelag` | 11 | fail | https://artipelag.se/ |
| `astronomiska-huddinge` | 11 | fail | https://stockholm-observatory.se/ |
| `bang` | 11 | fail | (needs re-discovery) |
| `caf-opera` | 11 | fail | https://cafopera.se/ |
| `china-teatern` | 11 | fail | http://www.chinateatern.se |
| `engelbrekt` | 11 | fail | http://www.engelbrektskyrkan.se |
| `filborna` | 11 | fail | (Helsingborg, not Stockholm — verify) |
| `folkoperan` | 11 | fail | https://www.folkoperan.se/ |
| `formex` | 11 | fail | https://formex.se/ |
| `avicii-arena` | 10 | fail | https://aviciiarena.com/ |
| `berwaldhallen` | 10 | fail | https://berwaldhallen.se/ |

[CLAIMED] `berwaldhallen.jsonl` in `03-Queue/03-extractedevents/` (93 KB) is **the largest source-event file in the repo**, suggesting it works in some path but is failing in C. Worth manual re-run.

**Action:** add a manual re-test pass — pick the 5 with the highest impact for Stockholm (`berwaldhallen`, `skansen`, `aviciiarena`, `kulturhusetstadsteatern`, `folkoperan`).

---

## Confirmed working (13) — the Stockholm graph baseline

[VERIFIED] these have real batch traces with `eventsFound > 0` and are the only Stockholm sources currently feeding the agent any signal.

| sourceId | eventsFound_max | c3EventsFound_max | successes/total | path |
|----------|-----------------|-------------------|-----------------|------|
| `naturhistoriska-riksmuseet` | 25 | 25 | 2/3 | jsonld |
| `konserthuset` | 21 | 21 | 2/3 | jsonld |
| `konserthuset-2` | 21 | 21 | 1/1 | jsonld |
| `debaser` | 11 | 0 | 2/4 | jsonld |
| `junibacken` | 5 | 5 | 2/2 | jsonld |
| `tekniska-museet-1` | 5 | 5 | 1/1 | jsonld |
| `ekero` | 4 | 4 | 1/4 | jsonld |
| `songkick` | 4 | 4 | 1/3 | jsonld |
| `folkuniversitetet` | 2 | 2 | 4/4 | jsonld |
| `kungliga-operan` | 2 | 2 | 1/2 | jsonld |
| `millesg-rden` | 2 | 2 | 1/2 | jsonld |
| `grona-lund` | 1 | 1 | 1/3 | jsonld |
| `polismuseet` | 1 | 1 | 2/2 | jsonld |

**Observation [VERIFIED]:** all 13 use `path=jsonld`. Zero working sources currently come from HTML or render paths. The Stockholm graph is **path-monoculture**.

---

## preferredPath distribution (137 Stockholm sources)

[VERIFIED] from `sources/*.jsonl` field `preferredPath`:

| preferredPath | Count |
|---------------|-------|
| `unknown` | 133 |
| `network` | 2 |
| `html` | 1 |
| `render` | 1 |

**[CLAIMED]** The system has effectively no preferred-path knowledge for Stockholm — 133/137 (97%) are `unknown`. That's why everything gets routed to A and fails.

---

## Recommended next step (per the 5-step plan)

Following the research-grounded plan in `41-Scraping-Priorities-Research.md`:

1. **Immediate (today):** Actions 1 + 2 above (retire dead DNS, fix redirect-loop URLs). ~3 hours of registry cleanup.
2. **This week (Step 3 done):** Action 4 — pick the 5 high-impact `untouched` sources and run them manually. Expect 2-3 of them to feed the agent immediately.
3. **Then move to Step 1** (source density audit) — measure what % of `events_public` has `freshness_at < 14d`. That's the freshness lever from Cho & Garcia-Molina that the research plan flagged as a 5× effect.

---

## What's still unclear

- [UNVERIFIED] Whether `untouched` sources are blocked by a queue priority issue or by something deeper (e.g. scheduler never picks them). `consecutiveFailures=11` is suspicious — looks like a snapshot reset rather than organic failure.
- [UNVERIFIED] Whether the `lastRoutingReason` "no-jsonld-or-no-events" sometimes masks a partial parse — i.e. the page DOES have JSON-LD but a different schema (e.g. `schema.org/Event` vs `schema.org/Exhibition`).
- [CLAIMED] Re-running `berwaldhallen` first would have outsized impact (93KB event file already in queue).

## Appendix

- **Full structured data:** `runtime/audit-dead-sources-summary.json`
- **Generator:** `runtime/audit-dead-sources.py` (re-runnable; ~10s)
- **Trace data:** 1707 records across 95 batch directories (`batch-001` → `batch-201+`)