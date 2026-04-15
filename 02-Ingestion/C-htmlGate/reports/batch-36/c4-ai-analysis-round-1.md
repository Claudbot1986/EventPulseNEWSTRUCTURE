## C4-AI Analysis Round 1 (batch-36)

**Timestamp:** 2026-04-14T19:04:19.814Z
**Sources analyzed:** 9

### Overall Pattern
Top failure categories: 4× DNS resolution failure, 1× Connection timeout, 1× Subpage contains events

---

### Source: ostersunds-fk

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
DNS ENOTFOUND indicates domain does not exist - no network path to attempt

**discoveredPaths:**
(none)

**improvementSignals:**
- Domain ofksverige.se does not resolve - may be registered as ofk.se or ostersundsfk.se

**suggestedRules:**
- Check if domain uses alternative TLD or subdomain structure

---

### Source: eggers-arena-ehco

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
DNS ENOTFOUND indicates domain does not exist - no network path to attempt

**discoveredPaths:**
(none)

**improvementSignals:**
- Domain eggersarena.se does not resolve - venue may use different domain

**suggestedRules:**
- Verify venue domain - may be eggers.se or eggersarena.com

---

### Source: kungstradgarden

| Field | Value |
|-------|-------|
| likelyCategory | Connection timeout |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.70 |
| nextQueue | retry-pool |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Timeout without DNS failure indicates server reachable but slow - retry may succeed

**discoveredPaths:**
(none)

**improvementSignals:**
- Server timeout may be transient - site appears to exist (no ENOTFOUND)

**suggestedRules:**
- Site reachable but slow - consider increasing timeout threshold for Swedish municipal sites

---

### Source: studieframjandet

| Field | Value |
|-------|-------|
| likelyCategory | Subpage contains events |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.82 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /amnen/musik/ |

**humanLikeDiscoveryReasoning:**
C0 found 3 candidates including /amnen/musik/ which has 'event-heading' in breadcrumb - likely contains course/workshop events rather than traditional calendar

**candidateRuleForC0C3:**
- pathPattern: `/amnen/*/|/kurser/|/utbildningar/`
- appliesTo: Swedish educational/cultural organizations with category-based event listings
- confidence: 0.70

**discoveredPaths:**
- /amnen/musik/ [derived] anchor="Musik" conf=0.65

**improvementSignals:**
- C0 found 3 candidates with /amnen/musik/ as winner - content signal 'event-heading' detected
- Score=8 but breadcrumb suggests event-adjacent content

**suggestedRules:**
- For Swedish educational/cultural sites, try /amnen/*/ category pages
- Increase C2 threshold for sites with breadcrumb 'event-heading' classification

---

### Source: club-mecca

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
DNS ENOTFOUND indicates domain does not exist - no network path to attempt

**discoveredPaths:**
(none)

**improvementSignals:**
- Domain clubmecca.se does not resolve - nightclub may have closed or use different domain

**suggestedRules:**
- Verify venue is still operational - may have closed or moved to clubmeccasverige.se

---

### Source: goteborgs-domkyrka

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
DNS ENOTFOUND indicates domain does not exist - no network path to attempt

**discoveredPaths:**
(none)

**improvementSignals:**
- Domain goteborgsdomkyrka.se does not resolve - church may use goteborgsdomkyrka.org or svenskakyrkan.se subdomain

**suggestedRules:**
- Verify official church website - likely on svenskakyrkan.se platform

---

### Source: dubblett-v2-test

| Field | Value |
|-------|-------|
| likelyCategory | Invalid URL format |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.98 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Invalid URL prevents any network discovery - needs URL normalization before processing

**discoveredPaths:**
(none)

**improvementSignals:**
- URL missing protocol scheme - should be https://dubblett-v2-test.se/

**suggestedRules:**
- URL preprocessor should normalize URLs to include https:// scheme

---

### Source: stromma

| Field | Value |
|-------|-------|
| likelyCategory | Cross-domain redirect blocked |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.88 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | https://www.stromma.com/ |

**humanLikeDiscoveryReasoning:**
Cross-domain redirect from .se to .com is a known pattern for Swedish tour operators - destination site likely has full event listings

**candidateRuleForC0C3:**
- pathPattern: `.*stromma\.com.*`
- appliesTo: Swedish tour/cruise operators with multi-TLD presence
- confidence: 0.90

**discoveredPaths:**
- https://www.stromma.com/ [derived] anchor="Stromma" conf=0.90

**improvementSignals:**
- Redirects to www.stromma.com - Swedish tour operator with international presence

**suggestedRules:**
- For cross-TLD redirects (.se → .com), fetch destination domain
- Add exception for known multi-TLD Swedish tour operators

---

### Source: malmo-hockey

| Field | Value |
|-------|-------|
| likelyCategory | DNS/Punycode resolution failure |
| failCategory | UNKNOWN |
| failCategoryConfidence | 0.90 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Punycode resolution failed - domain may not exist or encoding was incorrect

**discoveredPaths:**
(none)

**improvementSignals:**
- Domain with Swedish character ö may have encoding issue - xn-- punycode conversion failed
- Actual domain may not be registered or use ASCII alternative

**suggestedRules:**
- For IDN domains, verify punycode conversion is correct
- Try ASCII alternatives: malmohockey.se

---
