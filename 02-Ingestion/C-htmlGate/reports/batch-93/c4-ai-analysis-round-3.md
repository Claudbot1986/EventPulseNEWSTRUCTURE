## C4-AI Analysis Round 3 (batch-93)

**Timestamp:** 2026-04-16T18:46:53.833Z
**Sources analyzed:** 4

### Overall Pattern
Top failure categories: 2× DNS resolution failure, 1× SSL TLS handshake error, 1× SSL certificate hostname mismatch

---

### Source: gavle-if

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | retry-pool |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Cannot attempt human-like discovery because the entry page is unreachable due to DNS resolution failure. No HTTP response was received to analyze navigation structure.

**discoveredPaths:**
(none)

**improvementSignals:**
- Domain may have expired, moved, or DNS not propagated
- Check if gavleif.se is the correct domain for Gävle municipality tourism

**suggestedRules:**
- For ENOTFOUND errors: add domain to retry-pool with 24h delay before manual-review
- Cross-reference sourceId 'gavle-if' against known Swedish .se domains for cultural offices

---

### Source: globen

| Field | Value |
|-------|-------|
| likelyCategory | SSL TLS handshake error |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.88 |
| nextQueue | retry-pool |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Cannot analyze page content due to SSL handshake failure. The site is unreachable at the TLS layer, preventing any HTML analysis or navigation discovery.

**discoveredPaths:**
(none)

**improvementSignals:**
- TLSv1 unrecognized name suggests SSL misconfiguration or client certificate required
- globe.se may have moved to a different domain (possibly globenarena.se oravia.se)

**suggestedRules:**
- For TLS alert 112 (certificate_required): attempt retry with different SSL options or HTTP fallback
- Check if globen.se redirects to ticket vendor sites

---

### Source: goteborgs-arkitekturgalleri

| Field | Value |
|-------|-------|
| likelyCategory | SSL certificate hostname mismatch |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.92 |
| nextQueue | retry-pool |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Cannot perform human-like discovery because SSL certificate validation fails. The hosting provider (sajthotellet.com) has misconfigured SSL for this domain, preventing any HTTP content retrieval.

**discoveredPaths:**
(none)

**improvementSignals:**
- Certificate is issued for 'da201.sajthotellet.com' not arkitekturgalleriet.se
- Site is likely hosted on shared infrastructure with misconfigured SSL

**suggestedRules:**
- For hostname/cert mismatch: add to retry-pool with strict SSL verification disabled
- Verify if arkitekturgalleriet.se has proper SSL certificate or uses HTTP

---

### Source: goteborgs-domkyrka

| Field | Value |
|-------|-------|
| likelyCategory | DNS resolution failure |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.95 |
| nextQueue | retry-pool |
| discoveryAttempted | false |

**humanLikeDiscoveryReasoning:**
Cannot attempt human-like discovery because DNS resolution failed. The domain goteborgsdomkyrka.se does not exist or is not accessible from the current network.

**discoveredPaths:**
(none)

**improvementSignals:**
- Domain does not resolve - may have expired or be inactive
- Verify correct domain: goteborgsdomskyrka.se or svenskakyrkan.se subdomain

**suggestedRules:**
- For ENOTFOUND errors with low consecutiveFailures (1): add to retry-pool with 48h delay
- Cross-reference 'goteborgs-domkyrka' against Church of Sweden official domains

---
