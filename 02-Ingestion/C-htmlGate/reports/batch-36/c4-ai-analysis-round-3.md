## C4-AI Analysis Round 3 (batch-36)

**Timestamp:** 2026-04-14T19:07:48.727Z
**Sources analyzed:** 1

### Overall Pattern
Top failure categories: 1× redirect_blocked_entry_fetch

---

### Source: centuri

| Field | Value |
|-------|-------|
| likelyCategory | redirect_blocked_entry_fetch |
| failCategory | no_viable_path_found |
| failCategoryConfidence | 0.45 |
| nextQueue | manual-review |
| discoveryAttempted | false |
| discoveryPathsTried | /events, /kalender, /program |

**humanLikeDiscoveryReasoning:**
c0LinksFound is empty (no links captured at all), c2Reason confirms fetchHtml failed due to cross-domain redirect centuri.se → centuri.cloud. Since no anchor text signals exist in the captured data, cannot derive event-indicating paths. Swedish common paths /events, /kalender, /program not attempted via direct URL because no signals suggested them - c2Reason indicates the root cause is redirect infrastructure, not missing event paths.

**candidateRuleForC0C3:**
- pathPattern: `/events|/evenemang|/kalender|/program`
- appliesTo: Swedish event sites where initial fetch fails due to redirect
- confidence: 0.20

**discoveredPaths:**
(none)

**improvementSignals:**
- c2Reason: Cross-domain redirect blocked centuri.se → centuri.cloud indicates infrastructure change
- c0LinksFound empty - no anchor text signals to derive event paths from
- c1Verdict: unfetchable across 2 consecutive attempts
- lastPathUsed: network already tried without success

**suggestedRules:**
- Add redirect-following capability to handle centuri.se → centuri.cloud cross-domain redirects
- Pre-check robots.txt and domain ownership before attempting fetch
- Investigate centuri.cloud subdomain for event content if main domain redirects

---
