## C4-AI Analysis Round 3 (batch-39)

**Timestamp:** 2026-04-14T19:16:23.131Z
**Sources analyzed:** 4

### Overall Pattern
Top failure categories: 2× DNS_unreachable, 1× cross_domain_redirect, 1× event_links_not_tested

---

### Source: do310-com

| Field | Value |
|-------|-------|
| likelyCategory | DNS_unreachable |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Domain do310.com is unreachable via DNS (ENOTFOUND). No HTML could be fetched, no links could be discovered, and no alternative paths exist to test. This is a terminal network failure, not a discovery failure.

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS resolution fails for do310.com — domain may be defunct or expired
- 2 consecutive failures with same ENOTFOUND error confirms persistent network failure

**suggestedRules:**
- Domains returning ENOTFOUND after 2+ failures should route to manual-review as permanently unreachable

---

### Source: ekero

| Field | Value |
|-------|-------|
| likelyCategory | DNS_unreachable |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Domain ekeroif.se is unreachable via DNS (ENOTFOUND). No HTML could be fetched and no links exist to discover. This is a terminal network failure requiring manual investigation to determine if domain is parked, expired, or typo of correct URL.

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS resolution fails for ekeroif.se — domain may be defunct or misconfigured
- 1 consecutive failure shows this is a persistent network issue

**suggestedRules:**
- Domains returning ENOTFOUND should be flagged for manual-review as permanently unreachable

---

### Source: emporia

| Field | Value |
|-------|-------|
| likelyCategory | cross_domain_redirect |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.88 |
| nextQueue | retry-pool |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
emporia.se returns cross-domain redirect to emporia.steenstrom.se. This is not a 404 or DNS failure — the content exists but at the subdomain. Since emporia.steenstrom.se is a subdomain (same organization), this redirect should be followed automatically by the scraper. Discovered path: emporia.steenstrom.se.

**candidateRuleForC0C3:**
- pathPattern: `https://*.original-domain.se/`
- appliesTo: Swedish municipal sites that redirect to subdomains for event content
- confidence: 0.82

**discoveredPaths:**
- https://emporia.steenstrom.se/ [derived] conf=0.82

**improvementSignals:**
- Cross-domain redirect blocked: emporia.se → emporia.steenstrom.se — event content likely exists on redirect target
- Need to handle cross-domain redirects as valid path discovery rather than blocking

**suggestedRules:**
- Cross-domain redirects should be followed when redirect target domain is a subdomain of original (same organization)
- Build rule: when fetchHtml returns redirect to *.original-domain, retry fetch from redirect target URL

---

### Source: eskilstuna

| Field | Value |
|-------|-------|
| likelyCategory | event_links_not_tested |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.92 |
| nextQueue | retry-pool |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
eskilstuna.se is a Swedish municipal website that has very strong event navigation signals. C0 discovered 11 links with event-indicating keywords (/events, /program, /kalender, /schema, /evenemang, /kalendarium, /aktiviteter, /kultur). c2Verdict='promising' with score 12 and event-heading class found. The failure occurred because C3 was reached without actually fetching any of these promising subpages. Entry page has no events, but the /events path almost certainly contains event listings. This source should be retried with path /events first, then /program if needed.

**candidateRuleForC0C3:**
- pathPattern: `/events|/program|/kalender|/schema|/evenemang|/kalendarium`
- appliesTo: Swedish municipal (.se) and cultural sites — these paths are standard event listing URLs and should be auto-tested before declaring failure
- confidence: 0.90

**discoveredPaths:**
- /events [nav-link] anchor="Kommande evenemang" conf=0.92
- /program [nav-link] conf=0.88
- /kalender [nav-link] conf=0.85
- /schema [nav-link] conf=0.75
- /evenemang [nav-link] conf=0.72

**improvementSignals:**
- C0 found 11 strong event-indicating links (/events, /program, /kalender, /evenemang) but none were actually fetched
- c2Verdict='promising' with score 12 and 'event-heading' class detected — subpages likely contain events
- C3 reached without testing any discovered paths — failure is premature

**suggestedRules:**
- C0 candidates must be fetched before C3 declares failure — if links with event keywords exist, at least top-2 should be attempted
- Swedish municipal sites (.se) have strong event signal: /events, /kalender, /program — always test these paths
- When c0LinksFound has 3+ candidates with score >= 6, automatically queue top paths for retry before final failure

---
