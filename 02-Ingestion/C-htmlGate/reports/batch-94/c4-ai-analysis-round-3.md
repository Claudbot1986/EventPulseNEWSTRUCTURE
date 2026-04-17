## C4-AI Analysis Round 3 (batch-94)

**Timestamp:** 2026-04-16T18:50:38.676Z
**Sources analyzed:** 2

### Overall Pattern
Top failure categories: 1× SSL certificate mismatch preventing fetch, 1× Connection refused - server unreachable

---

### Source: goteborgs-kulturfestival

| Field | Value |
|-------|-------|
| likelyCategory | SSL certificate mismatch preventing fetch |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.92 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Cannot attempt human-like discovery: fetchHtml failed completely due to SSL certificate mismatch (hostname 'kulturfestivalen.se' not in cert altnames). No HTML content received, c0LinksFound is empty array. Human-like discovery requires actual page content to analyze navigation links.

**discoveredPaths:**
(none)

**improvementSignals:**
- SSL certificate mismatch: hostname doesn't match certificate altnames (*.one.com, one.com)
- 2 consecutive failures with path_network
- No HTML content available for human-like discovery attempt

**suggestedRules:**
- For SSL mismatch errors: Flag for manual review - either ignore SSL errors with appropriate flag or contact site admin about misconfigured certificates
- Consider adding SSL strictness override option for known stable domains with certificate issues

---

### Source: goteborgs-stadsteatern

| Field | Value |
|-------|-------|
| likelyCategory | Connection refused - server unreachable |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Cannot attempt human-like discovery: fetchHtml failed with connection refused (ECONNREFUSED 139.162.135.242:443). No TCP connection established, no HTTP response received. c0LinksFound is empty because no page content was fetched. Human-like discovery requires analyzing actual HTML from the entry page to identify event-indicating navigation links.

**discoveredPaths:**
(none)

**improvementSignals:**
- ECONNREFUSED on IP 139.162.135.242:443 - server not accepting connections
- 2 consecutive network failures
- No HTML content available for human-like discovery attempt

**suggestedRules:**
- For ECONNREFUSED errors: Site may be down temporarily or moved - flag for manual review
- Consider retrying with different IP resolution or check if domain has migrated
- Investigate if 139.162.135.242 is the correct server for stadsteatern.se

---
