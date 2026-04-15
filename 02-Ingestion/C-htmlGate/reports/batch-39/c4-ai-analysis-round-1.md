## C4-AI Analysis Round 1 (batch-39)

**Timestamp:** 2026-04-14T19:14:34.543Z
**Sources analyzed:** 6

### Overall Pattern
Top failure categories: 3× DNS resolution failure, 1× SSL certificate mismatch, 1× Unicode domain redirect blocked

---

### Source: fyrfaderna

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.95 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | https://fyrfaderna.se/ |

**humanLikeDiscoveryReasoning:**
Domain fyrfaderna.se returned ENOTFOUND. No HTML could be fetched to analyze links. DNS resolution failed entirely — likely domain expired or misconfigured. No navigation paths can be discovered from a 404-level failure.

**discoveredPaths:**
(none)

**improvementSignals:**
- Domain may have expired or DNS not configured
- Check if subdomain or alternative TLD exists

**suggestedRules:**
- Retry with www prefix: www.fyrfaderna.se
- Verify domain registration status

---

### Source: sundsvall-musik

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.95 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | https://musiksundsvall.se/ |

**humanLikeDiscoveryReasoning:**
Domain musiksundsvall.se returned ENOTFOUND. No server reachable. Cannot analyze navigation structure. Domain likely inactive or never registered.

**discoveredPaths:**
(none)

**improvementSignals:**
- Domain musiksundsvall.se does not resolve
- Domain may be parked or expired

**suggestedRules:**
- Try alternative domains: sundsvallsmusik.se, musiksundsvall.nu
- Search for correct music venue/event site in Sundsvall area

---

### Source: vaxjo-alcazar

| Field | Value |
|-------|-------|
| likelyCategory | SSL certificate mismatch |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.85 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | https://alcazar.se/ |

**humanLikeDiscoveryReasoning:**
Domain alcazar.se exists in DNS but returns certificate for yono1.active24.cz. Site is either hijacked or serving placeholder content. Original venue content unavailable at this domain.

**discoveredPaths:**
(none)

**improvementSignals:**
- alcazar.se serves content from active24.cz — likely parked or hijacked domain
- Certificate mismatch prevents HTTPS fetch

**suggestedRules:**
- Try HTTP instead of HTTPS: http://alcazar.se
- Search for actual Alcazar Väckjö venue site with correct domain

---

### Source: malmo-stad

| Field | Value |
|-------|-------|
| likelyCategory | Unicode domain redirect blocked |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.80 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | https://malmö.se/, https://malmo.se/ |

**humanLikeDiscoveryReasoning:**
Punycode domain Malmö (xn--malm-8qa.se) redirects to malmo.se but cross-domain redirect was blocked. The actual municipality site malmo.se exists and likely contains events. Retry with canonical ASCII URL to allow proper redirect chain.

**candidateRuleForC0C3:**
- pathPattern: `/kalender|/evenemang|/arrangemang|/event`
- appliesTo: Swedish municipal sites (kommun)
- confidence: 0.85

**discoveredPaths:**
(none)

**improvementSignals:**
- Punycode domain xn--malm-8qa.se redirects to malmo.se but blocked
- Root page was not fetched — need corrected URL

**suggestedRules:**
- Use canonical ASCII URL: https://malmo.se/ instead of punycode
- Retry with decoded Unicode domain properly resolved

---

### Source: downtown

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.95 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | https://downtown.se/ |

**humanLikeDiscoveryReasoning:**
Domain downtown.se returned ENOTFOUND. No DNS resolution possible. Site may have moved or use different domain. Cannot extract navigation structure.

**discoveredPaths:**
(none)

**improvementSignals:**
- Domain downtown.se does not resolve
- May be international brand with different TLD

**suggestedRules:**
- Try downtown.nu, downtown.se (alternatives)
- Check if Swedish 'Downtown' venue has different domain

---

### Source: sundsvall

| Field | Value |
|-------|-------|
| likelyCategory | Promising paths but extraction failed |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.88 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /kultur |
| directRouting | D (conf=0.68) |

**humanLikeDiscoveryReasoning:**
Sundsvall municipality site had promising C2 score (13) indicating event-list structure detected. C0 found 8 event-indicating links. The /kultur path was selected as winner but C3 extraction still returned 0 events. Pattern mismatch suggests subpages use JS rendering or different HTML structure. Multiple high-confidence Swedish event paths available: /events, /program, /kalender, /evenemang, /schema, /aktiviteter.

**candidateRuleForC0C3:**
- pathPattern: `/events|/program|/kalender|/schema|/evenemang|/aktiviteter|/kultur|/kalendarium`
- appliesTo: Swedish municipal and cultural sites (kommuner, kulturhus, stadsteatern)
- confidence: 0.82

**discoveredPaths:**
- /kultur [derived] anchor="derived-rule" conf=0.72
- /events [nav-link] anchor="derived-rule" conf=0.85
- /program [nav-link] anchor="derived-rule" conf=0.82
- /kalender [nav-link] anchor="derived-rule" conf=0.78
- /schema [nav-link] anchor="derived-rule" conf=0.70
- /evenemang [nav-link] anchor="derived-rule" conf=0.75

**improvementSignals:**
- C2 scored 13 (promising) but C3 extraction returned 0 events
- Multiple event-indicating links found in navigation
- Event structure likely JS-rendered or uses dynamic loading

**suggestedRules:**
- Investigate why promising score didn't yield events — extraction pattern mismatch
- Try D queue for JS-rendered content on subpages
- Human-like: test /events, /program, /kalender subpages directly

---
