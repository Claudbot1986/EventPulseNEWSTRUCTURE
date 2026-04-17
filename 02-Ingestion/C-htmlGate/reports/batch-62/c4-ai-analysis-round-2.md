## C4-AI Analysis Round 2 (batch-62)

**Timestamp:** 2026-04-15T19:10:34.365Z
**Sources analyzed:** 10

### Overall Pattern
Top failure categories: 5× domain does not exist, 1× transient network timeout, 1× SSL certificate mismatch

---

### Source: mall-of-scandinavia

| Field | Value |
|-------|-------|
| likelyCategory | transient network timeout |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.40 |
| nextQueue | retry-pool |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Cannot attempt discovery due to fetchHtml timeout. This is a transient network issue - server may be slow or temporarily unavailable. Common Swedish mall event paths would be /evenemang or /kalender but cannot verify without successful fetch.

**candidateRuleForC0C3:**
- pathPattern: `/evenemang|/kalender|/biljetter`
- appliesTo: Swedish shopping mall sites with event calendars
- confidence: 0.50

**discoveredPaths:**
(none)

**improvementSignals:**
- timeout_20000ms
- server_unresponsive

**suggestedRules:**
- Increase timeout threshold for large retail sites that may have slow responses

---

### Source: teknikens-och-sjofartens-museum

| Field | Value |
|-------|-------|
| likelyCategory | domain does not exist |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
DNS resolution failed with ENOTFOUND - the domain tsfm.se does not exist. No navigation paths can be attempted. This is a terminal failure requiring manual domain verification.

**discoveredPaths:**
(none)

**improvementSignals:**
- ENOTFOUND_tsfm.se
- DNS_resolution_failed

**suggestedRules:**
- Verify domain existence before adding to source list - tsfm.se returns NXDOMAIN

---

### Source: uppsala-teatern

| Field | Value |
|-------|-------|
| likelyCategory | domain does not exist |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
DNS resolution failed with ENOTFOUND - the domain uppsalateatern.se does not exist. No navigation paths can be attempted. This is a terminal failure requiring manual domain verification.

**discoveredPaths:**
(none)

**improvementSignals:**
- ENOTFOUND_uppsalateatern.se
- DNS_resolution_failed

**suggestedRules:**
- Verify domain existence before adding to source list - uppsalateatern.se returns NXDOMAIN

---

### Source: halland

| Field | Value |
|-------|-------|
| likelyCategory | SSL certificate mismatch |
| failCategory | robots_or_policy_blocked |
| failCategoryConfidence | 0.85 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
SSL certificate hostname mismatch prevents HTTPS access. The server certificate is issued for *.sitevision-cloud.se but not for halland.se. This is a server configuration issue that blocks all network access to the domain.

**discoveredPaths:**
(none)

**improvementSignals:**
- SSL_hostname_mismatch
- certificate_altnames_mismatch

**suggestedRules:**
- SSL certificate configuration error - halland.se hostname not in cert altnames (*.sitevision-cloud.se). Requires server-side fix or alternative domain access.

---

### Source: umea-stadsteatern

| Field | Value |
|-------|-------|
| likelyCategory | wrong entry page path |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.70 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /stadsteatern, /kultur, /evenemang |

**humanLikeDiscoveryReasoning:**
The path /stadsteatern returns 404, but umea.se root likely exists. Municipal theater events are typically found under /kultur, /evenemang, or /kalender paths on regional government sites.

**candidateRuleForC0C3:**
- pathPattern: `/kultur|/evenemang|/kalender|/kulturkalender`
- appliesTo: Swedish municipal/county government sites (region, kommun) with cultural event listings
- confidence: 0.70

**discoveredPaths:**
- https://umea.se/kultur [url-pattern] anchor="Kultur" conf=0.60
- https://umea.se/evenemang [url-pattern] anchor="Evenemang" conf=0.65

**improvementSignals:**
- HTTP_404_on_stadsteatern_path
- root_umea_se_may_work

**suggestedRules:**
- For municipal theater pages, try root domain first then /stadsteatern or /kultur as fallback paths

---

### Source: trollhattan

| Field | Value |
|-------|-------|
| likelyCategory | redirect loop detected |
| failCategory | robots_or_policy_blocked |
| failCategoryConfidence | 0.90 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Exceeded 3 redirects indicates a redirect loop or aggressive redirect policy. This prevents successful content retrieval and suggests either server misconfiguration or intentional blocking.

**discoveredPaths:**
(none)

**improvementSignals:**
- redirect_loop_exceeded_3
- server_misconfiguration

**suggestedRules:**
- Redirect loops indicate server misconfiguration or intentional blocking. Requires manual investigation of target URL structure.

---

### Source: kino

| Field | Value |
|-------|-------|
| likelyCategory | domain does not exist |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
DNS resolution failed with ENOTFOUND - the domain kinogoteborg.se does not exist. No navigation paths can be attempted. This is a terminal failure requiring manual domain verification.

**discoveredPaths:**
(none)

**improvementSignals:**
- ENOTFOUND_kinogoteborg.se
- DNS_resolution_failed

**suggestedRules:**
- Verify domain existence before adding to source list - kinogoteborg.se returns NXDOMAIN

---

### Source: skovde-if

| Field | Value |
|-------|-------|
| likelyCategory | domain does not exist |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
DNS resolution failed with ENOTFOUND - the domain skovdeif.se does not exist. No navigation paths can be attempted. This is a terminal failure requiring manual domain verification.

**discoveredPaths:**
(none)

**improvementSignals:**
- ENOTFOUND_skovdeif.se
- DNS_resolution_failed

**suggestedRules:**
- Verify domain existence before adding to source list - skovdeif.se returns NXDOMAIN

---

### Source: uppsala-reggae-festival

| Field | Value |
|-------|-------|
| likelyCategory | domain does not exist |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
DNS resolution failed with ENOTFOUND - the domain uppsala-reggae.se does not exist. No navigation paths can be attempted. This is a terminal failure requiring manual domain verification.

**discoveredPaths:**
(none)

**improvementSignals:**
- ENOTFOUND_uppsala-reggae.se
- DNS_resolution_failed

**suggestedRules:**
- Verify domain existence before adding to source list - uppsala-reggae.se returns NXDOMAIN

---

### Source: studieframjandet

| Field | Value |
|-------|-------|
| likelyCategory | weak event signals on subpage |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.75 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /amnen/musik, /kalender, /schema |

**humanLikeDiscoveryReasoning:**
C2 score of 8 is below threshold but event-heading was detected on the music subject page. Studiefrämjandet organizes events by subject area. The /amnen/musik page shows course listings which may contain event-like content with dates. A retry with adjusted scoring for educational sites may succeed.

**candidateRuleForC0C3:**
- pathPattern: `/amnen|/kurser|/kalender|/schema`
- appliesTo: Swedish educational organizations (Studiefrämjandet, folkbildning) with subject-organized course calendars
- confidence: 0.70

**discoveredPaths:**
- /amnen/musik [url-pattern] anchor="Musik" conf=0.70
- /kalender [url-pattern] anchor="Kalender" conf=0.75

**improvementSignals:**
- C2_score_8_too_low
- event_heading_detected
- c0WinnerUrl_exists

**suggestedRules:**
- When C2 score is borderline (8-11) and event-heading is detected, try deeper extraction with adjusted scoring thresholds for educational/course sites

---
