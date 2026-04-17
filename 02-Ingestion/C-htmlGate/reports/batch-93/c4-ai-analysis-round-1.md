## C4-AI Analysis Round 1 (batch-93)

**Timestamp:** 2026-04-16T18:44:57.988Z
**Sources analyzed:** 7

### Overall Pattern
Top failure categories: 1× ssl_domain_mismatch, 1× unicode_domain_not_resolved, 1× site_not_found

---

### Source: goteborgs-stadsbibliotek

| Field | Value |
|-------|-------|
| likelyCategory | ssl_domain_mismatch |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.65 |
| nextQueue | retry-pool |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
C2 failed with SSL cert mismatch. Certificate shows DNS:goteborg.se, *.goteborg.se but URL uses goteborgsstad.se. This suggests a domain redirect or configuration issue - the site likely exists but with different domain. C4 cannot proceed without successful fetch.

**discoveredPaths:**
(none)

**improvementSignals:**
- certificate altnames suggest correct domain is goteborg.se not goteborgsstad.se
- C2 fetch failed due to SSL mismatch - network layer issue, not content issue

**suggestedRules:**
- For Swedish municipal sites, try common domain variations: [name]stad.se, [name]sstad.se, goteborg.se
- Add SSL certificate domain validation to handle mismatched certs gracefully

---

### Source: malmo-icc

| Field | Value |
|-------|-------|
| likelyCategory | unicode_domain_not_resolved |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.88 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
DNS resolution failed - punycode domain not found. This is a terminal network failure. Could try ASCII version 'malmoicc.se' but without C0 discovery signals, human-like discovery cannot proceed. No event links found.

**discoveredPaths:**
(none)

**improvementSignals:**
- Punycode domain xn--malmicc-d1a.se cannot be resolved via DNS
- Site may have moved to different domain or gone offline
- Check if malmoicc.se (without Swedish chars) is valid

**suggestedRules:**
- For Swedish domains with unicode, also try ASCII version without Swedish characters (å→a, ö→o, ä→a)
- DNS ENOTFOUND suggests defunct site - route to manual review to verify

---

### Source: lulea-hf

| Field | Value |
|-------|-------|
| likelyCategory | site_not_found |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.92 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
DNS resolution failed completely - domain not found. No C0 links discovered. Cannot attempt navigation since initial fetch failed. Exhausted network-based discovery paths.

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS ENOTFOUND - domain luleahf.se not registered or pointing to inactive DNS
- No discovered paths due to complete network failure
- Could verify if hockey team has moved to different domain

**suggestedRules:**
- DNS ENOTFOUND = definitive no path found - manual review required
- Consider checking if team/organization has rebranded or moved to new domain

---

### Source: vega

| Field | Value |
|-------|-------|
| likelyCategory | low_event_signal |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.78 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /events |

**humanLikeDiscoveryReasoning:**
C0 found /events link with score 10. C2 found 'event-heading' class in page but score too low (2 vs threshold 6). Signals suggest /events page exists but HTML structure may not match extraction patterns. Retry with adjusted C2 scoring for known event pages.

**candidateRuleForC0C3:**
- pathPattern: `/events`
- appliesTo: Sites where C0 finds /events navigation with score ≥8
- confidence: 0.82

**discoveredPaths:**
- /events [derived] anchor="derived-rule" conf=0.82

**improvementSignals:**
- C0 found /events path with score 10 - high confidence nav link exists
- C2 score=2 but mentions 'event-heading' in page - partial signal present
- c1 shows no time tags or dates - may need JS rendering or different extraction pattern

**suggestedRules:**
- When C0 finds /events path with score≥8, automatically route to retry-pool regardless of C2 score
- Lower C2 score threshold for sites with explicit /events navigation links

---

### Source: hv71

| Field | Value |
|-------|-------|
| likelyCategory | site_timeout |
| failCategory | ENTRY_PAGE_NO_EVENTS |
| failCategoryConfidence | 0.75 |
| nextQueue | retry-pool |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
Network timeout - site is reachable but did not respond within 20s. Cannot extract C0/C1/C2 signals. Timeout is typically transient; retry-pool appropriate. Would need to increase timeout or try alternate route.

**discoveredPaths:**
(none)

**improvementSignals:**
- Timeout of 20000ms exceeded - site reachable but slow/overloaded
- No C0 links or C1/C2 signals due to fetch failure
- Timeout suggests transient network issue, not site content issue

**suggestedRules:**
- Timeout errors should route to retry-pool with higher timeout value
- Consider increasing timeout to 30000ms for Swedish sites known to be slow

---

### Source: storsj-odjuret

| Field | Value |
|-------|-------|
| likelyCategory | site_defunct |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.90 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
DNS resolution failed. Cannot discover any paths. Terminal network failure with no resolution path available.

**discoveredPaths:**
(none)

**improvementSignals:**
- DNS ENOTFOUND - domain storsjoodjuret.se not found
- No network connectivity to source
- May be rebranded venue or moved to different domain

**suggestedRules:**
- DNS not found = definitive no path found
- Check if venue has moved to new domain or social media presence

---

### Source: spanggatan

| Field | Value |
|-------|-------|
| likelyCategory | unicode_domain_not_found |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.91 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
DNS ENOTFOUND for punycode domain. Could theoretically try ASCII version 'spanggatan.se' but without any C0 signals, no discovered paths to attempt. Human-like discovery exhausted.

**discoveredPaths:**
(none)

**improvementSignals:**
- Punycode domain xn--spnggatan-62a.se not found in DNS
- Unicode domain resolution failed
- Could try ASCII version spanggatan.se but no C0 signals found

**suggestedRules:**
- For Swedish unicode domains (xn-- prefix), also attempt ASCII version before manual review
- DNS failure with unicode domain = route to manual review after attempting ASCII version

---
