## C4-AI Analysis Round 3 (batch-88)

**Timestamp:** 2026-04-16T16:50:07.127Z
**Sources analyzed:** 2

### Overall Pattern
Top failure categories: 1× DNS_unreachable, 1× root_page_no_event_nav

---

### Source: ekero

| Field | Value |
|-------|-------|
| likelyCategory | DNS_unreachable |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.82 |
| nextQueue | retry-pool |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
No HTML content available due to DNS resolution failure (getaddrinfo ENOTFOUND). Cannot attempt any link-based discovery. Site may be temporarily unreachable or domain may have expired. Exhausted network-level options - no paths to try.

**discoveredPaths:**
(none)

**improvementSignals:**
- Domain ekeroif.se DNS resolution failed - potential temporary outage or expired domain
- No HTML content fetched to analyze for event signals
- c0LinksFound empty indicates complete network-level failure

**suggestedRules:**
- Add DNS reachability check before C0 candidate discovery to distinguish temporary vs permanent failures
- Consider implementing exponential backoff retry for ENOTFOUND failures within same session
- If 3+ consecutive ENOTFOUND failures, escalate to manual-review as likely dead domain

---

### Source: emporia

| Field | Value |
|-------|-------|
| likelyCategory | root_page_no_event_nav |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.71 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /events, /evenemang, /kalender, /program, /aktuellt, /konserter, /biljetter |

**humanLikeDiscoveryReasoning:**
Root page https://emporia.se/ yielded no event-navigation links in c0LinksFound. Applied Swedish cultural/retail path patterns: /events, /evenemang, /kalender, /program, /aktuellt, /konserter, /biljetter - none discovered from initial crawl. The one candidate /hyr-en-eventyra translates to 'rent an event space' suggesting venue rental, not event listings. Site structure for shopping centers often requires dedicated event microsites or subdomains. Without visible nav links, human-like discovery exhausted standard Swedish event path patterns.

**candidateRuleForC0C3:**
- pathPattern: `/events|/evenemang|/kalender|/program|/aktuellt|/konserter|/biljetter|/whatson|/whats-happening`
- appliesTo: Swedish retail/shopping center sites with potential event calendars
- confidence: 0.65

**discoveredPaths:**
(none)

**improvementSignals:**
- c0Candidates=1 but c0LinksFound empty suggests root page lacks nav links to events
- c1Verdict=noise with zero time/date tags indicates no obvious event content on entry page
- C2 score=1 too low despite page having 'event-heading' class - event content may be sparse or on subpages
- Existing candidate /hyr-en-eventyra may contain events but URL suggests rental/venue inquiry page

**suggestedRules:**
- For Swedish shopping mall sites, event content often on dedicated subdomain or /events path - try these explicitly
- Sites with 0 c0LinksFound but c0Candidates=1 may have hidden nav that requires hover/scroll to reveal
- Consider pattern: shopping centers often embed events in 'what's happening' sections requiring JS interaction

---
