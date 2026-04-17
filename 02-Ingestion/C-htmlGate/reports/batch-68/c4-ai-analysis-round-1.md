## C4-AI Analysis Round 1 (batch-68)

**Timestamp:** 2026-04-16T20:45:41.539Z
**Sources analyzed:** 10

### Overall Pattern
Top failure categories: 4× DNS resolution failure, 1× SSL certificate mismatch, 1× Redirect loop on event path

---

### Source: roda-kvarn

| Field | Value |
|-------|-------|
| likelyCategory | SSL certificate mismatch |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Cannot attempt human-like discovery because the domain cannot be reached due to SSL certificate mismatch error. The fetchHtml call fails before any HTML can be retrieved.

**discoveredPaths:**
(none)

**improvementSignals:**
- SSL certificate altnames mismatch with hostname
- Infrastructure/CNAME resolution issue at one.com hosting

**suggestedRules:**
- Investigate SSL certificate configuration for rodakvarn.se at one.com
- Verify DNS resolution matches certificate subject alternative names

---

### Source: studio-acusticum

| Field | Value |
|-------|-------|
| likelyCategory | Redirect loop on event path |
| failCategory | NEEDS_SUBPAGE_DISCOVERY |
| failCategoryConfidence | 0.78 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /evenemang |

**humanLikeDiscoveryReasoning:**
C0 identified /evenemang as winner with 6 candidates, but C2 hit redirect loop. Swedish sites typically have /program, /schema as alternatives. Since no c0LinksFound array was populated, we derive potential paths from Swedish site conventions.

**candidateRuleForC0C3:**
- pathPattern: `/evenemang|/program|/schema`
- appliesTo: Swedish venue and cultural sites
- confidence: 0.70

**discoveredPaths:**
- /evenemang [derived] anchor="Evenemang" conf=0.65

**improvementSignals:**
- C0 found 6 candidates with winner /evenemang but redirect loop detected
- Swedish site likely has multiple event subpages

**suggestedRules:**
- Try alternative Swedish event paths: /program, /schema, /konserter when /evenemang loops
- Investigate redirect chain at /evenemang for pattern to break loop

---

### Source: songkick

| Field | Value |
|-------|-------|
| likelyCategory | Promising signals but no extraction |
| failCategory | EXTRACTION_PATTERN_MISMATCH |
| failCategoryConfidence | 0.82 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /festivals |
| directRouting | D (conf=0.65) |

**humanLikeDiscoveryReasoning:**
C0 winner URL points to /festivals with 49 time tags and score=323. C3 extraction failure suggests either JS rendering requirement or pattern mismatch. High candidate count and strong signals warrant retry.

**candidateRuleForC0C3:**
- pathPattern: `/festivals|/gigs|/concerts`
- appliesTo: Concert and festival aggregator sites
- confidence: 0.75

**discoveredPaths:**
- /festivals [derived] anchor="Festivals" conf=0.88

**improvementSignals:**
- C2 score=323 with 49 time tags indicates event content present
- Extraction failed despite strong breadth signals
- Festival listing page structure may differ from standard event patterns

**suggestedRules:**
- Investigate songkick.com/festivals page structure for dynamic content loading
- Consider festival-specific extraction patterns
- Test whether events load after page interaction

---

### Source: ekero

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.98 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Domain ekeroif.se cannot be resolved via DNS. No HTTP connection can be established, making any form of discovery impossible. Infrastructure-level issue requires human intervention.

**discoveredPaths:**
(none)

**improvementSignals:**
- getaddrinfo ENOTFOUND indicates domain does not exist or DNS misconfigured
- No network path exists to attempt discovery

**suggestedRules:**
- Verify domain ekeroif.se exists and DNS is properly configured
- Check if domain expired or was mistyped

---

### Source: globen

| Field | Value |
|-------|-------|
| likelyCategory | SSL/TLS protocol error |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
globen.se domain resolves but SSL/TLS handshake fails with unrecognized name alert. Cannot retrieve HTML content to perform human-like discovery. Infrastructure issue requiring cert investigation.

**discoveredPaths:**
(none)

**improvementSignals:**
- SSL alert 112 (unrecognized name) indicates certificate mismatch
- write EPROTO indicates TLS handshake failure
- Domain reachable but SSL handshake fails

**suggestedRules:**
- Investigate SSL certificate configuration for globen.se
- Verify certificate covers the hostname or check for load balancer misconfiguration

---

### Source: uppsala-stadsteatern

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.98 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
uppsala-stadsteatern.se domain cannot be resolved. This may indicate the theater website was migrated to a municipal platform (uppsala.se). Human review needed to identify current URL.

**discoveredPaths:**
(none)

**improvementSignals:**
- getaddrinfo ENOTFOUND for uppsala-stadsteatern.se
- Domain unreachable at network level

**suggestedRules:**
- Verify domain registration and DNS configuration
- Note: Uppsala Stadsteater may have moved to uppsala.se/stadsteatern or similar consolidated URL

---

### Source: grona-lund

| Field | Value |
|-------|-------|
| likelyCategory | Tickets page lacks events |
| failCategory | EXTRACTION_PATTERN_MISMATCH |
| failCategoryConfidence | 0.74 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /biljetter |

**humanLikeDiscoveryReasoning:**
Gronalund /biljetter (tickets) is a C0 candidate with event-heading signals. However, ticket pages often use event selection widgets rather than HTML event listings. Should try /program or event calendar paths for actual listings.

**candidateRuleForC0C3:**
- pathPattern: `/program|/schema|/evenemangskalender`
- appliesTo: Swedish attraction and theme park sites with event programs
- confidence: 0.68

**discoveredPaths:**
- /biljetter [derived] anchor="Biljetter" conf=0.72

**improvementSignals:**
- C0 found 10 candidates with winner /biljetter
- C2 score=8 with event-heading signals but extraction returned 0
- Ticket page structure may not contain event listing HTML

**suggestedRules:**
- Try /program or /events paths instead of /biljetter
- Gronalund may require dynamic calendar/schedule page for event extraction
- Consider that ticket pages often link to events rather than list them

---

### Source: goteborgs-domkyrka

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.98 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
goteborgsdomkyrka.se cannot be resolved. Likely domain configuration issue or migration. Human review needed to locate actual church website.

**discoveredPaths:**
(none)

**improvementSignals:**
- getaddrinfo ENOTFOUND for goteborgsdomkyrka.se
- Domain does not exist or is misconfigured

**suggestedRules:**
- Verify domain exists (may be goteborgs-domkyrka.se with hyphens)
- Gothenburg cathedral may use goteborgsdomkyrka.goteborgsstiftelse.se or similar

---

### Source: spanga-is

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.98 |
| nextQueue | manual-review |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
spanga.se domain cannot be resolved. Sports club website may have migrated or been discontinued. Human investigation needed.

**discoveredPaths:**
(none)

**improvementSignals:**
- getaddrinfo ENOTFOUND for spanga.se
- Domain unreachable

**suggestedRules:**
- Verify domain spanga.se exists and is properly registered
- Spånga IS sports club may have moved to club-specific domain or social media

---

### Source: nationalmuseum

| Field | Value |
|-------|-------|
| likelyCategory | Weak signals on calendar page |
| failCategory | LOW_VALUE_SOURCE |
| failCategoryConfidence | 0.68 |
| nextQueue | retry-pool |
| discoveryAttempted | true |
| discoveryPathsTried | /kalendarium |
| directRouting | D (conf=0.55) |

**humanLikeDiscoveryReasoning:**
Nationalmuseum /kalendarium is the sole C0 candidate with score=4 (barely below threshold). Swedish museums often use calendar views with events loaded dynamically. Consider D-routing for JS rendering check.

**candidateRuleForC0C3:**
- pathPattern: `/kalendarium|/utstallningar|/aktuellt`
- appliesTo: Swedish museum and cultural institution sites
- confidence: 0.62

**discoveredPaths:**
- /kalendarium [derived] anchor="Kalendarium" conf=0.58

**improvementSignals:**
- C0 found 1 candidate with winner /kalendarium (calendar)
- C2 score=4 below threshold of 6
- C1 verdict noise with 0 time tags
- Museum calendar may use dynamic loading or be low-density

**suggestedRules:**
- Try /utstallningar (exhibitions) as alternative to calendar
- Nationalmuseum may require JS rendering for event calendar
- Consider if calendar page is genuinely low-signal vs dynamic

---
