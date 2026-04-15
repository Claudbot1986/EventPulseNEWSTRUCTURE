## C4-AI Analysis Round 3 (batch-38)

**Timestamp:** 2026-04-14T19:13:47.261Z
**Sources analyzed:** 2

### Overall Pattern
Top failure categories: 1× TLS/SSL connection failure, 1× Domain not resolving

---

### Source: dalarna

| Field | Value |
|-------|-------|
| likelyCategory | TLS/SSL connection failure |
| failCategory | insufficient_html_signal |
| failCategoryConfidence | 0.78 |
| nextQueue | retry-pool |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
Could not perform human-like discovery because C2 fetchHtml failed with SSL error (alert 112). Without HTML content, no c0LinksFound are available to analyze. However, dalarna.se is a Swedish regional site where event pages typically live at /evenemang or /kalender. Routing to retry-pool to attempt fetch with adjusted TLS settings before concluding path is non-viable.

**candidateRuleForC0C3:**
- pathPattern: `/evenemang|/kalender|/program`
- appliesTo: Swedish regional and municipal websites
- confidence: 0.55

**discoveredPaths:**
- /evenemang [url-pattern] conf=0.45
- /kalender [url-pattern] conf=0.40

**improvementSignals:**
- SSL alert 112 (handshake failure) preventing any HTML fetch
- c0LinksFound empty due to fetch failure, not absence of links
- Swedish municipal site typically has /evenemang or /kalender paths

**suggestedRules:**
- Retry with TLS 1.2 fallback disabled or different cipher suites
- Try alternative user-agent strings to bypass server TLS restrictions

---

### Source: din-gastrotek

| Field | Value |
|-------|-------|
| likelyCategory | Domain not resolving |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
Cannot attempt human-like discovery because DNS resolution failed for gastrotek.se. The domain is either unregistered, expired, or experiencing DNS outage. This is a terminal network failure — no HTML could be fetched to discover event paths. Site likely defunct or rebranded. Routing to manual-review for domain status verification.

**candidateRuleForC0C3:**
- pathPattern: ``
- appliesTo: 
- confidence: 0.00

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS ENOTFOUND indicates domain gastrotek.se does not exist or is not registered
- 2 consecutive failures with same DNS resolution failure
- gastrotek is a Swedish gastrotek site (food/beverage technology)

**suggestedRules:**
- Verify domain registration status for gastrotek.se
- Check if site migrated to different domain or brand consolidation

---
