## C4-AI Analysis Round 2 (batch-48)

**Timestamp:** 2026-04-15T02:47:03.168Z
**Sources analyzed:** 4

### Overall Pattern
Top failure categories: 1× redirect_domain_mismatch, 1× timeout_uncertain_cause, 1× domain_does_not_exist

---

### Source: mejeriet

| Field | Value |
|-------|-------|
| likelyCategory | redirect_domain_mismatch |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.88 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | https://mejeriet.se/, https://kulturmejeriet.se/ |

**humanLikeDiscoveryReasoning:**
Fetch failed with cross-domain redirect blocked. The redirect target kulturmejeriet.se is the actual content domain. Common Swedish cultural venues use /evenemang for event listings. Retry with resolved redirect URL.

**candidateRuleForC0C3:**
- pathPattern: `/evenemang|/kalender|/program`
- appliesTo: Swedish cultural venues (mejeriet, kulturhus, stadsteater variants)
- confidence: 0.85

**discoveredPaths:**
- https://kulturmejeriet.se/evenemang [derived] anchor="kulturmejeriet.se subpath" conf=0.92

**improvementSignals:**
- Cross-domain redirect from mejeriet.se to kulturmejeriet.se blocked fetch
- c0LinksFound empty due to redirect interrupting HTML capture
- Need to capture final destination URL after redirects

**suggestedRules:**
- Follow redirect chains before declaring fetch failure
- Try kulturmejeriet.se as primary URL for Mejeriet events

---

### Source: tekniska-museet

| Field | Value |
|-------|-------|
| likelyCategory | timeout_uncertain_cause |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.72 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | https://tekniska.se/ |
| directRouting | D (conf=0.65) |

**humanLikeDiscoveryReasoning:**
Timeout occurred - unable to capture any HTML. Swedish museums typically organize events under /kalender or /evenemang. Retry with longer timeout or JS-rendering fallback.

**candidateRuleForC0C3:**
- pathPattern: `/kalender|/evenemang|/program`
- appliesTo: Swedish museums (tekniska, naturhistoriska, historiska)
- confidence: 0.72

**discoveredPaths:**
- /kalender [url-pattern] anchor="Common Swedish museum event path pattern" conf=0.70
- /evenemang [url-pattern] anchor="Swedish event listing standard path" conf=0.68

**improvementSignals:**
- 20 second timeout exceeded - server may be slow or overloaded
- c1TimeTagCount=0 and c1DateCount=0 due to no HTML received
- Could be transient network issue or server performance problem

**suggestedRules:**
- Increase timeout threshold for Swedish museum/government sites
- Implement exponential backoff for timeout failures
- Try D-route as fallback since server responsiveness suggests possible JS-heavy rendering

---

### Source: regionteatern

| Field | Value |
|-------|-------|
| likelyCategory | domain_does_not_exist |
| failCategory | insufficient_html_signal |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | false |
| discoveryPathsTried | https://regionteater.se/ |

**humanLikeDiscoveryReasoning:**
DNS resolution failed - domain regionteater.se does not exist. No HTML or links available to analyze. Cannot attempt human-like discovery without valid domain resolution. Requires manual investigation to find correct domain.

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS lookup failed: getaddrinfo ENOTFOUND regionteater.se
- Domain does not resolve - permanent infrastructure failure
- No alternative paths can be discovered without valid DNS

**suggestedRules:**
- Verify domain spelling - correct domain may be regionteatern.se or regionteatern.se (different variants)
- This source may have moved to different domain entirely

---

### Source: stockholms-stadsteater

| Field | Value |
|-------|-------|
| likelyCategory | connection_refused_server |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.78 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | https://stadsteatern.se/ |

**humanLikeDiscoveryReasoning:**
Connection refused means server is reachable but blocking/dropping connections. This is often transient. Retry later or try HTTP variant. Common Swedish theater event paths: /evenemang, /kalender, /program.

**candidateRuleForC0C3:**
- pathPattern: `/evenemang|/kalender|/program`
- appliesTo: Swedish theaters (stadsteater, regionteater, folketeater)
- confidence: 0.80

**discoveredPaths:**
- /evenemang [url-pattern] anchor="Standard Swedish theater event path" conf=0.75
- /kalender [url-pattern] anchor="Swedish theater calendar path" conf=0.73

**improvementSignals:**
- Server is reachable (IP 139.162.135.242 responds) but actively refuses port 443
- Could indicate SSL/TLS misconfiguration or server firewall blocking
- Connection refused is often transient - server may recover

**suggestedRules:**
- Retry with HTTP instead of HTTPS - server may only accept HTTP
- Try alternative ports or protocols if initial connection fails
- Implement connection retry with backoff for ECONNREFUSED failures

---
