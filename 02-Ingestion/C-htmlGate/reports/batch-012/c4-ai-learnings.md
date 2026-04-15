## C4-AI-lärrapport batch-012

|| Fält | Värde |
|------|-------|
| batchId | batch-012 |
| roundNumber | 1 |

### Runda 1 - Baseline

|| Fält | Värde |
|------|-------|
| observedPattern | 10/10 sources fail. 2 sources (varmland, liseberg) har C2=promising men C3=0. 7 sources har nätverksfel. 1 har screening failure. |
| hypothesis | C3 (extractFromHtml) är JSON-LD only och misslyckas när JSON-LD saknar Event-data men HTML har datum-signaler. |
| proposedGeneralChange | Lägg till HTML-struktur fallback i extractFromHtml för när JSON-LD inte hittar events men HTML har dateCount > 0. |
| changeApplied | null (baseline) |
| whyGeneral | Mönstret påverkar minst 2+ sajter (varmland, liseberg, potentiellt fler) |
| beforeSummary | Baseline: 0/10 extract_success, 0 events |
| afterSummary | Samma |
| sourcesImproved | [] |
| sourcesUnchanged | Alla 10 |
| sourcesWorsened | [] |
| decision | N/A |
| learnedRule | C3 är JSON-LD-only. För sajter utan JSON-LD Event-data behövs HTML-struktur-extraction. |
| confidence | medium |
| shouldBeReusedLater | ja |

### networkErrorClassification
```json
{
  "totalNetworkErrors": 7,
  "byNetworkFailureSubType": {
    "url_problem": 2,
    "dns_problem": 1,
    "timeout_problem": 2,
    "tls_certificate_problem": 1,
    "http_404_problem": 2,
    "http_403_problem": 0,
    "http_5xx_problem": 0,
    "blocked_or_fetch_environment_problem": 0,
    "likely_requires_D": 0,
    "likely_requires_A_or_B": 0,
    "unclear_network_failure": 0
  },
  "confirmedRoutingSignals": [],
  "confirmedFetchEnvironmentProblems": ["ik-sirius", "helsingborg-arena", "medeltidsmuseet"],
  "confirmedUrlProblems": ["kth", "g-teborgs-posten"],
  "unclearNetworkFailures": [],
  "conclusion": "7 nätverksfel. 2 kth och g-teborgs-posten har HTTP 404 vilket tyder på fel canonical URL. 2 timeout (ik-sirius, helsingborg-arena). 1 cert-fel (medeltidsmuseet). 1 DNS (brommapojkarna). Dessa är miljö- eller source-config-problem, inte C-verktygsproblem."
}
```
