## C4-AI Analysis Round 2 (batch-36)

**Timestamp:** 2026-04-14T19:05:41.626Z
**Sources analyzed:** 10

### Overall Pattern
Top failure categories: 4× domain unreachable, 2× cross-domain redirect blocked, 1× server timeout

---

### Source: ostersunds-fk

| Field | Value |
|-------|-------|
| likelyCategory | domain unreachable |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
All stages failed with ENOTFOUND - the domain ofksverige.se cannot be resolved via DNS. No navigation paths exist to explore since no HTTP response was ever received. This is a terminal infrastructure failure, not a discovery problem.

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS resolution fails for ofksverige.se - verify if this is the correct domain
- Check if the organization uses a different domain entirely

**suggestedRules:**
- For DNS failures, first check alternate TLDs (.com, .org) and variants (with/without hyphen) before routing to manual-review

---

### Source: eggers-arena-ehco

| Field | Value |
|-------|-------|
| likelyCategory | domain unreachable |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
DNS ENOTFOUND - domain eggersarena.se is not registered or not accessible. No HTTP response means no HTML to parse, no links to discover. Terminal failure.

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS resolution fails for eggersarena.se
- Verify correct domain - might be eggersarena.com or similar

**suggestedRules:**
- Check for common Swedish arena naming variations: eggersarena.se vs arena eggers etc

---

### Source: kungstradgarden

| Field | Value |
|-------|-------|
| likelyCategory | server timeout |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.80 |
| nextQueue | retry-pool |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
Timeout indicates server responded but didn't complete within 20s - could be overloaded or slow. Not a dead domain. Retry-pool appropriate to test alternate domains or delay retry.

**discoveredPaths:**
(none)

**improvementSignals:**
- Server timeout after 20000ms - server may be slow but present
- Verify if site responds to different user agents

**suggestedRules:**
- Timeout failures should go to retry-pool with delay - server may recover
- Consider alternate paths if root times out

---

### Source: studieframjandet

| Field | Value |
|-------|-------|
| likelyCategory | event page on subpage |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.75 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /amnen/musik, /kalender |

**humanLikeDiscoveryReasoning:**
c0Candidates=3 and c0WinnerUrl points to /amnen/musik - this suggests the site organizes events by topic. StudieFramjandet is an educational association, so events may be within subject pages. Common Swedish paths /kalender, /evenemang, /schema should be tried in retry.

**candidateRuleForC0C3:**
- pathPattern: `/kalender|/evenemang|/schema|/amnen/*`
- appliesTo: Swedish educational/cultural sites like StudieFramjandet
- confidence: 0.72

**discoveredPaths:**
- /amnen/musik [derived] anchor="musik" conf=0.65
- /kalender [url-pattern] anchor="Kalender" conf=0.70

**improvementSignals:**
- c0Candidates=3 indicates navigation found event-like links
- c0WinnerUrl=/amnen/musik/ suggests music courses may have events
- c2Score=8 borderline - page has event-heading class
- Consider adding known Swedish event paths: /kalender, /evenemang, /schema

**suggestedRules:**
- When c2Score < 12 but c0Candidates > 0, route to retry-pool for subpage exploration
- Swedish educational/cultural sites often put events under /kalender or topic-specific pages

---

### Source: club-mecca

| Field | Value |
|-------|-------|
| likelyCategory | domain unreachable |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
DNS ENOTFOUND - domain unreachable. No paths to try.

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS resolution fails for clubmecca.se

**suggestedRules:**
- Check if venue has moved to different domain

---

### Source: goteborgs-domkyrka

| Field | Value |
|-------|-------|
| likelyCategory | domain unreachable |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
DNS ENOTFOUND - domain unreachable. No HTML content to analyze.

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS resolution fails for goteborgsdomkyrka.se
- Verify correct domain for Göteborgs domkyrka

**suggestedRules:**
- Swedish church sites often use .se but may have different naming - check svenskakyrkan.se

---

### Source: dubblett-v2-test

| Field | Value |
|-------|-------|
| likelyCategory | invalid url format |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.98 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
URL 'dubblett-v2-test.se/' has no protocol prefix and appears to be a test/duplicate entry. Invalid URL prevents any network request. This is a data quality issue, not a discovery problem.

**discoveredPaths:**
(none)

**improvementSignals:**
- Invalid URL - missing protocol prefix
- dubblett-v2-test is likely a test/placeholder entry

**suggestedRules:**
- Detect malformed URLs (missing https://) during validation phase before network fetch

---

### Source: stromma

| Field | Value |
|-------|-------|
| likelyCategory | cross-domain redirect blocked |
| failCategory | robots_or_policy_blocked |
| failCategoryConfidence | 0.85 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | https://www.stromma.com/ |

**humanLikeDiscoveryReasoning:**
Stromma.se redirects to stromma.com - blocked by cross-domain policy but the .com is the main site with events. Retry-pool should try the .com domain directly since this is a legitimate tour company with organized event content at /tours, /tickets, etc.

**candidateRuleForC0C3:**
- pathPattern: `/tours|/tickets|/tours/*|/en/*`
- appliesTo: Major tour operators like Stromma with multilingual sites
- confidence: 0.85

**discoveredPaths:**
- https://www.stromma.com/ [derived] anchor="www.stromma.com" conf=0.90

**improvementSignals:**
- Redirect blocked to www.stromma.com - events may be on .com domain
- Stromma is a major tour operator with substantial event content

**suggestedRules:**
- When redirect blocked but site is known major player, try alternate domain in retry-pool
- Stromma has events at stromma.com/en/se for English or country-specific paths

---

### Source: malmo-hockey

| Field | Value |
|-------|-------|
| likelyCategory | domain punycode mismatch |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.90 |
| nextQueue | retry-pool |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
The Punycode domain failed but Malmö sports venues often use simplified ASCII domains. Should try malmohockey.com, malmohockey.se variants. Hockey team sites typically have events at /matches, /biljetter, /spelschema.

**candidateRuleForC0C3:**
- pathPattern: `/matches|/biljetter|/spelschema|/schema`
- appliesTo: Swedish sports teams and hockey venues
- confidence: 0.78

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS failed for xn--malmhockey-hcb.se (Punycode of Malmö hockey)
- Try alternate: malmohockey.se, malmo-hockey.se without umlaut

**suggestedRules:**
- For Swedish IDN domains, try ASCII variants before giving up
- malmo.live, malmo.se for sports venues

---

### Source: centuri

| Field | Value |
|-------|-------|
| likelyCategory | cross-domain redirect blocked |
| failCategory | robots_or_policy_blocked |
| failCategoryConfidence | 0.85 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | https://centuri.cloud/ |

**humanLikeDiscoveryReasoning:**
Centuri.se redirects to centuri.cloud - blocked by policy but the cloud domain likely contains event content. Modern SaaS platforms often have well-structured event data. Retry-pool should test centuri.cloud directly.

**candidateRuleForC0C3:**
- pathPattern: `/events|/calendar|/dashboard|/events/*`
- appliesTo: SaaS platforms with cloud-based hosting like Centuri
- confidence: 0.80

**discoveredPaths:**
- https://centuri.cloud/ [derived] anchor="centuri.cloud" conf=0.85

**improvementSignals:**
- Redirect blocked to centuri.cloud - actual events likely there
- Only 1 consecutive failure - higher chance of success on retry

**suggestedRules:**
- When site redirects to cloud domain, try that domain in retry-pool
- Centuri appears to be a modern SaaS platform - events may be structured

---
