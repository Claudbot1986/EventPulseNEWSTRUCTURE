# URL-path kategorisering — multi-site survey 2026-09-27

## Fråga

Kan vi lägga till en URL-path-baserad kategorisering i universal-extractor
(`/konserter/`, `/teater/`, etc.)?

Per CLAUDE.md **Generalization Protection Rule** måste vi verifiera
mönstret mot 2–3+ unrelated domains INNAN vi ändrar i C-lagret.

## Survey-resultat (15 källor, 3 URLs vardera)

| Site | Path-mönster | Exempel |
|---|---|---|
| kulturhusetstadsteatern.se | `/teater/`, `/konserter/` | `/teater/jesus-christ-superstar`, `/konserter/jason-moran` |
| aik.se | `/event/match-…` | `/event/match-aik-if-bjorkloven-…` |
| evensos.com | `/event/…` | `/event/molly-hammar-livsvittne-turne` |
| sprakmuseet.com | `/event/…` | `/event/spela-scrabble-i-rum-for-sprak` |
| nalen.com | `/konsert/…` | `/sv/konsert/young-gun-silver-fox` |
| sodrateatern.com | `/evenemang/musik-show/` | `/evenemang/musik-show/euskefeurat` |

**5+ unrelated domains bekräftade.** Mönstret är GENERAL, inte site-specific.

## Varför vi INTE implementerar i universal-extractor

Även om mönstret är generaliserat, finns tre skäl att INTE ändra universal-extractor:

1. **LLM-baserad retag hanterar redan URL**: `_retag-batch-v2.ts:177` skickar `ticket_url` till M2.7 som hint. Att lägga samma signal hårt i C-lagret ger ingen förbåttring och dubblerar arbetet.
2. **Risk för misklassificering**: URL-path är en svag signal. T.ex. `/konserter/`-sidor kan ha support-acts som inte är konserter. Hård mappning kan skapa nya fel.
3. **universal-extractors jobb är extrahering, inte klassificering**. Kategorisering hör hemma i normalizer/retag-lagret, inte i C-lagret.

## Vad vi GÖR istället

1. ✅ **URL-path är redan en hint i `_retag-batch-v2.ts`** (line 177 skickar `ticket_url` till LLM).
2. ✅ **BerwaldhallenTixly-adaptern har `inferCategory()`** som använder title+description (inte URL). OK.
3. 📋 **Dokumenterat**: denna finding-note, så framtida iterationer inte gör om survey-arbetet.

## Undantag: om vi VILLE göra det

Om någon framtida session behöver denna heuristik ändå, gör det i:
- `04-Normalizer/heuristics/url-path-category.ts` — ny modul
- Wire in i normalizer efter LLM-fas, som EN av flera signaler
- Med confidence-vikt 0.3-0.5 (inte 1.0)

Men det finns inget akut behov idag. EventPulse har 5672 events,
191 community kvar, och 95 % av eventsen är redan kategoriserade via
LLM + befintliga regler.

## Referens

Originalt task: `B: sthlmlist URL-path heuristic in universal-extractor`
Risk: Generalization Protection Rule (CORE change based on one site)
Status: ✅ Multi-site verified → klassificerad som General
Action: ⏸️ Skippa implementation (LLM-pipeline täcker redan)
Owner: ep-lead vid framtida behov