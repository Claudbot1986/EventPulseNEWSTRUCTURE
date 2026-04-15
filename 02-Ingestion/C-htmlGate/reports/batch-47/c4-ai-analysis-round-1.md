## C4-AI Analysis Round 1 (batch-47)

**Timestamp:** 2026-04-15T02:44:50.250Z
**Sources analyzed:** 6

### Overall Pattern
Top failure categories: 1× cross_domain_redirect_blocked, 1× primary_url_404, 1× event_links_found_not_followed

---

### Source: medeltidsmuseet

| Field | Value |
|-------|-------|
| likelyCategory | cross_domain_redirect_blocked |
| failCategory | robots_or_policy_blocked |
| failCategoryConfidence | 0.92 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | https://medeltidsmuseet.se/ |

**humanLikeDiscoveryReasoning:**
Source domain redirects to medeltidsmuseet.stockholm.se - a cross-domain redirect blocked by policy. The redirect target is a valid subdomain of stockholm.se where museum events are typically hosted. Recommend retry with resolved domain.

**discoveredPaths:**
- https://medeltidsmuseet.stockholm.se/ [derived] anchor="domain redirect" conf=0.90

**improvementSignals:**
- Redirect target domain is accessible: medeltidsmuseet.stockholm.se
- Cross-domain redirect suggests site migration or subdomain structure

**suggestedRules:**
- Add domain mapping for medeltidsmuseet.se → medeltidsmuseet.stockholm.se
- Follow redirect chain before attempting event discovery

---

### Source: halmstad-konserthus

| Field | Value |
|-------|-------|
| likelyCategory | primary_url_404 |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.78 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | https://halmstad.se/konserthus |

**humanLikeDiscoveryReasoning:**
Direct /konserthus path returns 404. Swedish municipal venues often have events nested under parent /kultur paths. Root domain halmstad.se likely contains navigation to concert hall events. Recommend testing municipality root and /kultur paths.

**discoveredPaths:**
- https://halmstad.se [url-pattern] anchor="municipality root" conf=0.55

**improvementSignals:**
- Halmstad municipality uses /kultur for venue events
- Concert hall events may be under /kultur/konserthus or halmstad.se

**suggestedRules:**
- Try root domain halmstad.se for municipal event hub
- Explore /kultur path for concert hall events

---

### Source: push

| Field | Value |
|-------|-------|
| likelyCategory | event_links_found_not_followed |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.94 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /events, /program, /kalender |

**humanLikeDiscoveryReasoning:**
push.se homepage has no events but contains strong nav-derived candidates: /events, /program, /kalender all with high confidence scores. These are standard Swedish event page paths. C0 correctly identified candidates but didn't follow them. Recommend retry with subpage discovery enabled for these paths.

**candidateRuleForC0C3:**
- pathPattern: `/events|/program|/kalender|/evenemang|/schema`
- appliesTo: Swedish cultural/entertainment sites with event listings in navigation
- confidence: 0.90

**discoveredPaths:**
- /events [nav-link] anchor="derived-rule" conf=0.92
- /program [nav-link] anchor="derived-rule" conf=0.88
- /kalender [nav-link] anchor="derived-rule" conf=0.85

**improvementSignals:**
- Strong nav link candidates: /events (score 10), /program (score 9), /kalender (score 8)
- Multiple Swedish event path variants discovered in c0LinksFound
- C2 score=3 but anchor text clearly indicates event pages

**suggestedRules:**
- Swedish sites with /events or /program in nav should trigger C0 subpage follow
- Lower threshold for nav-derived links when anchor text matches Swedish event vocabulary

---

### Source: mittuniversitetet

| Field | Value |
|-------|-------|
| likelyCategory | js_rendered_or_api_based |
| failCategory | LIKELY_JS_RENDER |
| failCategoryConfidence | 0.85 |
| nextQueue | D |
| discoveryAttempted | true |
| discoveryPathsTried | https://miun.se/evenemang |
| directRouting | D (conf=0.85) |

**humanLikeDiscoveryReasoning:**
URL is already /evenemang (correct path) but C1 found zero time tags or date counts. This pattern strongly indicates client-side rendering where dates are populated via JavaScript after page load. University event systems commonly use React/Vue frameworks or separate API endpoints. Direct D routing recommended.

**discoveredPaths:**
(none)

**improvementSignals:**
- c1TimeTagCount=0 and c1DateCount=0 despite being an event page URL
- URL is already the correct /evenemang path but no signals found
- University event systems often use client-side rendering or API feeds

**suggestedRules:**
- University event URLs with 0 date signals should route directly to D (JS render fallback)
- Swedish universities (uu, ki, su, liu) often use separate event platforms

---

### Source: summerburst

| Field | Value |
|-------|-------|
| likelyCategory | server_connection_refused |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.88 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | https://summerburst.se/ |

**humanLikeDiscoveryReasoning:**
Connection refused (ECONNREFUSED) means the server is unreachable at 172.105.93.38:443. This is not a content issue but a connectivity issue. Could be temporary outage, DDoS protection, or seasonal shutdown. Recommend retry-pool with backoff. Summer festival events may only be available during booking season.

**discoveredPaths:**
(none)

**improvementSignals:**
- ECONNREFUSED indicates server down, not permanent 404
- Summer festival events may be seasonal - past events archived

**suggestedRules:**
- Connection refused should be retried with exponential backoff
- Seasonal event sites may return connection errors when out of season

---

### Source: uppsala-universitet

| Field | Value |
|-------|-------|
| likelyCategory | wrong_url_path_404 |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.82 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | https://uu.se/evenemang |

**humanLikeDiscoveryReasoning:**
URL /evenemang returns 404. Uppsala University migrated their event system and the /evenemang path may be deprecated. University events are likely now at /kalendarium or embedded in /aktuellt news section. Recommend testing root domain navigation paths.

**candidateRuleForC0C3:**
- pathPattern: `/kalendarium|/aktuellt|/nyheter`
- appliesTo: Swedish university event pages - universities often reorganize event paths
- confidence: 0.72

**discoveredPaths:**
- /kalendarium [url-pattern] anchor="Swedish calendar path" conf=0.70
- /aktuellt [url-pattern] anchor="news/current section" conf=0.60

**improvementSignals:**
- UU main site uses different event URL structure
- University events may be under /aktuellt or /kalendarium

**suggestedRules:**
- Swedish universities use /kalendarium for central event calendars
- Try root domain /kalendarium and /aktuellt for Uppsala University events

---
