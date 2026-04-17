## C4-AI Analysis Round 2 (batch-86)

**Timestamp:** 2026-04-17T04:56:19.586Z
**Sources analyzed:** 10

### Overall Pattern
Top failure categories: 6× DNS unreachable, 3× URL 404 not found, 1× SSL/TLS error

---

### Source: kalmar-museum

| Field | Value |
|-------|-------|
| likelyCategory | DNS unreachable |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
Entry page fetch failed with DNS ENOTFOUND - domain kalmar-museum.se cannot be resolved. No HTML was received, thus no links available for navigation analysis. Human-like discovery cannot proceed without accessible entry page. Cannot determine if events exist at alternate paths without domain resolution.

**discoveredPaths:**
(none)

**improvementSignals:**
- Domain may have moved or been retired
- Verify kalmar-museum.se exists

**suggestedRules:**
- For ENOTFOUND errors: DNS resolution failed - domain may be expired, moved, or never existed

---

### Source: h-gskolan-i-sk-vde

| Field | Value |
|-------|-------|
| likelyCategory | URL 404 not found |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.92 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
Entry page fetch failed with HTTP 404 on https://his.se/evenemang. The specific events URL does not exist at the configured path. Without successful page load, no internal links can be discovered. Human-like discovery requires accessible entry page to analyze navigation structure.

**discoveredPaths:**
(none)

**improvementSignals:**
- URL his.se/evenemang returns 404
- Event page may have moved to different path

**suggestedRules:**
- For 404 on event-specific URLs: page may have been removed or restructured

---

### Source: karlstad-stadsteatern

| Field | Value |
|-------|-------|
| likelyCategory | URL 404 not found |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.92 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
Entry page fetch failed with HTTP 404 on https://karlstad.se/stadsteatern. The stadsteatern subsection URL does not exist. Without successful page load, no internal navigation links can be analyzed. The main karlstad.se domain may be accessible but this specific path has been removed or renamed.

**discoveredPaths:**
(none)

**improvementSignals:**
- URL karlstad.se/stadsteatern returns 404
- Stadsteater section may have been restructured

**suggestedRules:**
- For 404 on subsection URLs: parent domain accessible but path incorrect

---

### Source: melodifestivalen-svt

| Field | Value |
|-------|-------|
| likelyCategory | URL 404 not found |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.90 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
Entry page fetch failed with HTTP 404 on https://svt.se/melodifestivalen. The SVT melodifestivalen landing page does not exist at this URL. SVT is a major broadcaster - this event may be seasonal/archived or moved. Without page access, cannot analyze navigation structure for event discovery.

**discoveredPaths:**
(none)

**improvementSignals:**
- URL svt.se/melodifestivalen returns 404
- Melodifestivalen page may have moved

**suggestedRules:**
- For 404 on media sites: content may have been archived or moved to different domain

---

### Source: sticky-fingers

| Field | Value |
|-------|-------|
| likelyCategory | DNS unreachable |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
Entry page fetch failed with DNS ENOTFOUND for stickyfingers.se. No HTML received, thus no navigation analysis possible. Domain may have expired, moved to .com, or venue may have closed.

**discoveredPaths:**
(none)

**improvementSignals:**
- Domain stickyfingers.se cannot be resolved
- Verify current domain/URL

**suggestedRules:**
- For ENOTFOUND: domain may have expired or changed to different TLD

---

### Source: uppsala-stadsteatern

| Field | Value |
|-------|-------|
| likelyCategory | DNS unreachable |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
Entry page fetch failed with DNS ENOTFOUND for uppsala-stadsteatern.se. Cultural institutions in Sweden often merge with municipal sites. The uppsala.se municipality site should be checked for event listings instead. Without domain resolution, cannot proceed with discovery.

**discoveredPaths:**
(none)

**improvementSignals:**
- Domain uppsala-stadsteatern.se cannot be resolved
- Verify if institution has merged or moved

**suggestedRules:**
- For ENOTFOUND on institutional domains: may have merged with municipal site

---

### Source: globen

| Field | Value |
|-------|-------|
| likelyCategory | SSL/TLS error |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.88 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
Entry page fetch failed with SSL/TLS protocol error on globen.se. The TLS alert 112 indicates unrecognized name - possible certificate mismatch or HTTPS enforcement issue. Without successful HTTPS connection, no HTML available for navigation analysis.

**discoveredPaths:**
(none)

**improvementSignals:**
- SSL protocol error on globen.se
- TLS handshake failed with unrecognized name

**suggestedRules:**
- For SSL errors: certificate may be misconfigured or domain redirect issue

---

### Source: falun-fk

| Field | Value |
|-------|-------|
| likelyCategory | DNS unreachable |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
Entry page fetch failed with DNS ENOTFOUND for falunfk.se. No HTML received, thus no link discovery possible. FK suffix suggests idrottförening (sports club) - may have dissolved or moved online.

**discoveredPaths:**
(none)

**improvementSignals:**
- Domain falunfk.se cannot be resolved
- Verify if organization still exists

**suggestedRules:**
- For ENOTFOUND: verify organization is still active

---

### Source: gamla-uppsala

| Field | Value |
|-------|-------|
| likelyCategory | DNS unreachable |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
Entry page fetch failed with DNS ENOTFOUND for gamlauppsala.se. No HTML received. Gamla Uppsala is a historical/museum site - likely should be on uppsala.se municipality domain. Cannot analyze navigation without accessible page.

**discoveredPaths:**
(none)

**improvementSignals:**
- Domain gamlauppsala.se cannot be resolved
- Historical site may have moved

**suggestedRules:**
- For ENOTFOUND on historical/cultural sites: may have migrated to municipality site

---

### Source: rockfest-vasteras

| Field | Value |
|-------|-------|
| likelyCategory | DNS unreachable |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | manual-review |
| discoveryAttempted | true |

**humanLikeDiscoveryReasoning:**
Entry page fetch failed with DNS ENOTFOUND for rockfestvasteras.se. Rock festivals often are one-time or short-run events. Domain may have expired or festival discontinued. No HTML available for link analysis.

**discoveredPaths:**
(none)

**improvementSignals:**
- Domain rockfestvasteras.se cannot be resolved
- Festival may be defunct or URL changed

**suggestedRules:**
- For ENOTFOUND on festival sites: event may be discontinued or moved to different domain

---
