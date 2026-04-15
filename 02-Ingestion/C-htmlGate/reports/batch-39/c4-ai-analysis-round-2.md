## C4-AI Analysis Round 2 (batch-39)

**Timestamp:** 2026-04-14T19:15:29.344Z
**Sources analyzed:** 7

### Overall Pattern
Top failure categories: 4× DNS unreachable, 1× SSL cert mismatch, 1× IDN redirect blocked

---

### Source: fyrfaderna

| Field | Value |
|-------|-------|
| likelyCategory | DNS unreachable |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.98 |
| nextQueue | manual-review |
| discoveryAttempted | true |
| discoveryPathsTried | https://fyrfaderna.se/ |

**humanLikeDiscoveryReasoning:**
DNS resolution failed for fyrfaderna.se - domain is unreachable. No alternative paths available since no HTTP response was received. This is a fundamental connectivity issue, not a navigation problem.

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS ENOTFOUND - domain may have expired or never existed
- 2 consecutive fetch failures to same host

**suggestedRules:**
- Verify domain registration status externally before adding to source list
- Consider removing or archiving permanently unreachable sources

---

### Source: sundsvall-musik

| Field | Value |
|-------|-------|
| likelyCategory | DNS unreachable |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.98 |
| nextQueue | manual-review |
| discoveryAttempted | true |
| discoveryPathsTried | https://musiksundsvall.se/ |

**humanLikeDiscoveryReasoning:**
DNS resolution failed for musiksundsvall.se - the subdomain does not exist. The parent domain (sundsvall.se) likely exists but this specific subdomain is not configured.

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS ENOTFOUND - subdomain or domain may not exist
- 2 consecutive fetch failures

**suggestedRules:**
- Verify subdomain exists at parent domain
- Check if site moved to different subdomain

---

### Source: vaxjo-alcazar

| Field | Value |
|-------|-------|
| likelyCategory | SSL cert mismatch |
| failCategory | insufficient_html_signal |
| failCategoryConfidence | 0.85 |
| nextQueue | manual-review |
| discoveryAttempted | true |
| discoveryPathsTried | https://alcazar.se/ |

**humanLikeDiscoveryReasoning:**
SSL certificate mismatch - server responds with certificate for yono1.active24.cz, indicating the domain is hosted but misconfigured. Could be a subdomain/path redirect issue or the actual Alcazar site uses different hostname.

**discoveredPaths:**
(none)

**improvementSignals:**
- SSL certificate hostname mismatch indicates shared hosting misconfiguration
- Server responds but serves wrong certificate
- Domain exists but not properly configured for this hostname

**suggestedRules:**
- Verify correct hostname for Alcazar venue in Växjö
- Domain may need proper DNS configuration
- SSL mismatch suggests possible IP-based hosting without SNI

---

### Source: malmo-stad

| Field | Value |
|-------|-------|
| likelyCategory | IDN redirect blocked |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.72 |
| nextQueue | manual-review |
| discoveryAttempted | true |
| discoveryPathsTried | https://malmö.se/, https://xn--malm-8qa.se/ |

**humanLikeDiscoveryReasoning:**
Cross-domain redirect blocked when trying to access IDN domain xn--malm-8qa.se which should resolve to malmo.se. The redirect target (malmo.se) likely exists but the IDN variant triggers policy block.

**discoveredPaths:**
(none)

**improvementSignals:**
- Punycode IDN domain (xn--malm-8qa.se) redirects to ASCII malmo.se
- Cross-domain redirect blocked by crawler policy
- Potential fix: use malmo.se directly instead of IDN variant

**suggestedRules:**
- Replace IDN variant with ASCII version (malmo.se) in source URL
- IDN domains may require special handling in crawler configuration

---

### Source: downtown

| Field | Value |
|-------|-------|
| likelyCategory | DNS unreachable |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.98 |
| nextQueue | manual-review |
| discoveryAttempted | true |
| discoveryPathsTried | https://downtown.se/ |

**humanLikeDiscoveryReasoning:**
DNS resolution failed for downtown.se - domain unreachable. No alternative paths available without HTTP response.

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS ENOTFOUND for downtown.se
- Domain may be expired or never registered
- 2 consecutive failures

**suggestedRules:**
- Verify domain registration status
- Consider updating to current site if domain expired

---

### Source: sundsvall

| Field | Value |
|-------|-------|
| likelyCategory | Wrong entry path selected |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.88 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /kultur |

**humanLikeDiscoveryReasoning:**
C0 selected /kultur as winner but it extracted 0 events. C2 gave promising score (13) suggesting events ARE on the site. Multiple event-indicating paths exist in c0LinksFound: /events, /program, /kalender, /evenemang. The /events path scored highest (10) and should be retried. Swedish municipal pattern shows /events|/program paths work better than /kultur for direct event listings.

**candidateRuleForC0C3:**
- pathPattern: `/events|/program|/kalender|/evenemang`
- appliesTo: Swedish .se municipal and cultural sites - these paths have higher event probability than /kultur
- confidence: 0.82

**discoveredPaths:**
- /events [derived] anchor="derived-rule" conf=0.90
- /program [derived] anchor="derived-rule" conf=0.87
- /kalender [derived] anchor="derived-rule" conf=0.82
- /evenemang [derived] anchor="derived-rule" conf=0.78
- /kultur [derived] anchor="derived-rule" conf=0.65

**improvementSignals:**
- C2 gave promising score (13) but C3 found 0 events
- C0 rootFallback selected /kultur but page has multiple event-indicating paths
- /events scored highest (10) but wasn't the winner URL

**suggestedRules:**
- For Swedish municipal sites: prioritize /events and /program over /kultur for event extraction
- C0 rule should weight /events|/program higher than /kultur for .se domains
- Consider multiple path candidates before rootFallback

---

### Source: do310-com

| Field | Value |
|-------|-------|
| likelyCategory | DNS unreachable |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.98 |
| nextQueue | manual-review |
| discoveryAttempted | true |
| discoveryPathsTried | https://do310.com/ |

**humanLikeDiscoveryReasoning:**
DNS resolution failed for do310.com - domain unreachable with only 1 failure so early detection. No HTTP response received, hence no alternative paths discovered.

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS ENOTFOUND for do310.com
- Domain appears to be expired or never registered
- 1 consecutive failure - early stage

**suggestedRules:**
- Verify domain registration status
- Site may have rebranded to different domain

---
