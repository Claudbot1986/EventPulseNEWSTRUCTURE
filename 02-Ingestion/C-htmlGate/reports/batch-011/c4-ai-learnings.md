## C4-AI-lärrapport batch-011

### Runda 1

| Fält | Värde |
|------|-------|
| batchId | batch-011 |
| roundNumber | 1 |
| observedPattern | 10/10 fail. 7 st C0-discovery-fail (0 candidates), 3 st C2/C3-glapp-fail (C2=promising men C3=0). Root URL fallback i C0 hjälpte inte — problemet är inte C0 utan C3 eller nätverksfel. |
| hypothesis | C0 hittar för få candidates. Root URL fallback borde hjälpa sajter där root har events men inga interna links hittas. |
| proposedGeneralChange | Root URL fallback i C0 när candidates.length === 0 och rootDensityScore > 0 |
| changeApplied | Root URL fallback i C0 |
| whyGeneral | Samma mönster påverkar 7+ sajter. Ändringen är generell, ingen site-specifik logik. |
| beforeSummary | 0 extract_success, 0 route_success, 10 fail, 0 events |
| afterSummary | 0 extract_success, 0 route_success, 10 fail, 0 events |
| sourcesImproved | [] |
| sourcesUnchanged | ["varmland", "svenska-hockeyligan-shl", "nykoping", "liseberg-n-je", "medeltidsmuseet", "ik-sirius", "kth", "helsingborg-arena", "g-teborgs-posten", "brommapojkarna"] |
| sourcesWorsened | [] |
| decision | revert |
| learnedRule | Root URL fallback i C0 hjälper inte när grundproblemet är C3 (extraktion) eller nätverksfel. Sajter som varmland och liseberg har redan candidates men C3-extraction returnerar ändå 0 events. |
| confidence | medium |
| shouldBeReusedLater | nej |

---

### Mönsteranalys

#### C0-discovery-fail grupp (7 st)
- brommapojkarna: DNS failure
- nykoping: Root URL hittad som fallback (nykoping.se/) men C2 score=7 för låg
- medeltidsmuseet: Certificate error
- ik-sirius: Timeout
- kth: HTTP 404
- helsingborg-arena: Timeout
- g-teborgs-posten: HTTP 404

**Observation:** Root URL fallback hjälpte ENDAST nykoping (som faktiskt fick winnerUrl=nykoping.se/ via fallback). Men C2 score=7 är för lågt. Övriga 6 har nätverksfel som ingen C0-ändring kan fixa.

#### C2/C3-glapp-fail grupp (3 st)
- varmland: C2=promising (score=34) men C3=0 events
- liseberg-n-je: C2=promising (score=187) men C3=0 events
- svenska-hockeyligan-shl: C2=unclear (score=1) — redan candidate hittades men låg score

**Observation:** Dessa sajter HAR redan candidates (varmland, liseberg). Root URL fallback hjälpper dem inte alls. Problemet är C3-extraction-logiken.

#### Slutsats
- Root URL fallback var fel hypotes för denna failmängd
- Verkliga problemet är C3-extraction (varmland, liseberg) eller nätverksfel (timeout, 404, DNS, cert)
- Nästa förbättringsrunda bör fokusera på C3 för varmland/liseberg, inte C0
