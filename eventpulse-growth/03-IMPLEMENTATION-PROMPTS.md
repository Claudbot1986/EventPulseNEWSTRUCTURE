# EventPulse – Incremental Claude Code Prompts

Kör **en prompt i taget**. Verifiera resultatet innan nästa prompt.

Se [02-ARCHITECTURE.md](02-ARCHITECTURE.md) för målarkitekturen och [05-ROADMAP.md](05-ROADMAP.md) för helheten.

---

## Prompt 1 – Current-state audit

```text
Du arbetar i EventPulse-projektet.

GÖR INGA KODÄNDRINGAR ÄNNU.

Analysera först den befintliga kodbasen och dokumentera exakt hur följande fungerar idag:

- authentication
- user/session identification
- Supabase schema
- event schema
- search_events
- rank_events
- parse_intent
- record_feedback
- event details
- favorites/saved events
- analytics/event tracking
- Expo-appen
- Next.js
- backend/API
- Redis/BullMQ där relevant

Projektet har nu cirka 6 000 events i Stockholm. Utgå från faktisk kod och databasstruktur, inte gamla antaganden eller dokumentation.

Skapa:

docs/growth/00-current-state.md

Dokumentet ska innehålla:

1. Vad som redan finns
2. Vad som fungerar
3. Vad som är halvfärdigt
4. Vad som saknas
5. Vilka delar vi kan återanvända
6. Risker/teknisk skuld
7. Rekommenderad ordning för implementation

Ändra ingenting annat.

Avsluta med:
- filer du inspekterat
- viktigaste fynden
- eventuella frågor/blockers
```

---

## Prompt 2 – Anonymous identity

```text
Läs först docs/growth/00-current-state.md.

Implementera nu endast anonym användaridentitet.

MÅL:
En användare ska kunna använda EventPulse och bygga upp personalisering utan att skapa konto.

Krav:
- Skapa ett persistent anonymous_user_id första gången appen används.
- UUID ska användas.
- ID:t ska finnas kvar mellan appstarter.
- Skapa inte ett nytt ID varje session.
- Backend ska kunna identifiera användaren via anonymous_user_id.
- Befintlig authentication får inte förstöras.
- Arkitekturen ska förberedas för att anonymous_user_id senare kan kopplas till ett autentiserat user_id.

Spara inte nya typer av beteendedata ännu.

Lägg tester för:
- första start
- återstart
- befintligt ID
- nytt ID
- inloggad användare

Dokumentera implementationen i:
docs/growth/01-anonymous-identity.md

Kör relevanta tester och typecheck.

Stanna sedan.
```

---

## Prompt 3 – Behavioral event layer

```text
Läs:
docs/growth/00-current-state.md
docs/growth/01-anonymous-identity.md

Bygg ett minimalt behavioral event-system för EventPulse.

Återanvänd befintlig arkitektur där det är möjligt.

Varje relevant interaktion ska kunna kopplas till:
- anonymous_user_id ELLER user_id
- event_id där relevant
- timestamp
- session_id där lämpligt

Implementera:
event_impression
event_open
event_save
event_unsave
event_share
event_booking_click
recommendation_like
recommendation_dislike
search_performed

För recommendation_dislike ska vi senare kunna lagra reason, men bygg inte UI för detta ännu.

VIKTIGT:
- Undvik dubbla impressions.
- Tracking får inte blockera UI.
- Ett analytics-fel får aldrig krascha användarupplevelsen.
- Samla inte mer persondata än vad som behövs.
- Återanvänd befintliga tabeller/system om de redan löser problemet väl.

Skapa migrations vid behov.

Dokumentera:
docs/growth/02-behavior-events.md

Lägg tester.
Kör migration/typecheck/tests.

Stanna sedan.
```

---

## Prompt 4 – Taste Profile v1

```text
Läs tidigare docs/growth-dokument först.

Implementera EventPulse Taste Profile v1.

MÅL:
Härled en enkel användarprofil från användarens beteende.

Använd signalerna:
event_open
event_save
event_share
event_booking_click
recommendation_like
recommendation_dislike

Utgå från eventens BEFINTLIGA metadata.

Inspektera verkligt schema först. Hitta inte på metadata som inte finns.

Skapa en transparent scoringmodell där starkare beteende väger mer än svagare beteende.

Princip:
impression << open < save/share < booking_click/explicit like

Dislike ska ge negativ signal.

Vikterna ska ligga centralt i config och vara enkla att experimentera med.

Profilen ska fungera både för:
anonymous_user_id
och
user_id.

Bygg inte ML ännu.

Skapa tester med syntetiska användarbeteenden och verifiera att olika beteenden producerar olika profiler.

Dokumentera:
docs/growth/03-taste-profile-v1.md

Stanna efter verifiering.
```

---

## Prompt 5 – Personalized ranking v1

```text
Läs samtliga tidigare docs/growth-dokument.

Implementera personalized ranking v1.

ÄNDRA INTE ingestion.

Vi har cirka 6 000 Stockholm-events.

Pipeline:

USER INTENT
↓
hard filters
↓
candidate retrieval
↓
Taste Profile
↓
personalized scoring
↓
diversity/redundancy handling
↓
ranked results

Rankingen ska kombinera, där data finns:
1. explicit user intent
2. time/date match
3. geographic relevance
4. category/tag relevance
5. Taste Profile
6. price preference
7. quality/confidence på event-data
8. diversity

En stark explicit query ska väga tyngre än historisk profil.

Exempel:
En användare brukar gilla konserter men skriver:
"museum med barnen på söndag"

EventPulse får INTE trycka upp konserter bara på grund av historiken.

Returnera internt en explainability-struktur, exempelvis:
score_total
score_intent
score_taste
score_time
score_distance
score_quality

Visa inte detta för slutanvändaren ännu.

Lägg regressionstester.

Dokumentera:
docs/growth/04-personalized-ranking.md

Stanna.
```

---

## Prompt 6 – Explicit feedback UI

Implementera 👍/👎 och dislike reasons såsom `för dyrt`, `för långt bort`, `inte min grej`, `fel tid`, `redan sett`. Koppla till behavioral layer och dokumentera som `05-feedback-ui.md`.

## Prompt 7 – Preference onboarding

Bygg en snabb onboarding som ger Taste Profile en initial signal innan tillräckligt beteende finns. Använd verkliga kategorier/tags från databasen. Konto får inte krävas. Dokumentera som `06-onboarding.md`.

## Prompt 8 – For You

Bygg en personaliserad feed som fungerar utan explicit sökning. Använd rankingmotorn och undvik att skapa en separat rankinglogik. Dokumentera som `07-for-you.md`.

## Prompt 9 – Natural-language discovery

Koppla natural-language intent till samma retrieval/ranking-pipeline. Testa komplexa queries med datum, budget, sällskap, vibe och negativa krav. Dokumentera som `08-natural-language.md`.

## Prompt 10 – Explainability

Exponera användarvänliga förklaringar baserade på rankingens befintliga explainability-data. Undvik falska förklaringar. Dokumentera som `09-explainability.md`.

## Prompt 11 – Sharing

Implementera stabila deep links och delbara eventkort. Mät `event_share` och inkommande trafik där möjligt. Dokumentera som `10-sharing.md`.

## Prompt 12 – Hjälp oss välja

> **PARKERAD 2026-09-20 — kör inte denna prompt.** Se `docs/BACKLOG.md` "DO NOT BUILD YET". Återupptas endast efter användarbeslut baserat på share→open-metrics.

Låt användaren välja flera events, skapa en delbar sida och låta mottagare rösta utan obligatoriskt konto. Mät funnel från share till öppning/röst/fortsatt EventPulse-användning. Dokumentera som `11-group-voting.md`.

## Prompt 13 – Account conversion

Erbjud konto först när det finns ett konkret värde att spara. Implementera säker länkning/migrering:

```text
anonymous_user_id → user_id
```

Bevara relevanta saves/preferences/history utan dubbletter. Dokumentera som `12-account-conversion.md`.

## Prompt 14 – Din helg

Bygg en återkommande personaliserad weekend-selection ovanpå samma rankingmotor. Lägg inte notification-spam i första versionen. Dokumentera som `13-your-weekend.md`.

## Prompt 15 – Experiment framework

Bygg ett enkelt experimentlager för ranking/onboarding/UI. Assignment ska vara stabilt för samma användare. Definiera exposure events och experiment metrics. Dokumentera som `14-experiment-framework.md`.

Se [04-METRICS-EXPERIMENTS.md](04-METRICS-EXPERIMENTS.md) innan implementation.
