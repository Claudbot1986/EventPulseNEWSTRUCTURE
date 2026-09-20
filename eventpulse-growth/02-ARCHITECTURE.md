# EventPulse – Personalization Architecture

Se [01-STRATEGY.md](01-STRATEGY.md) för produktstrategi och [03-IMPLEMENTATION-PROMPTS.md](03-IMPLEMENTATION-PROMPTS.md) för implementation.

## 1. Identity

```text
anonymous_user_id
        ↓
 behavior + preferences
        ↓
 optional authentication
        ↓
      user_id
```

Första appstart skapar ett persistent UUID. Det ska överleva appstarter.

Vid senare registrering ska den anonyma identiteten kunna länkas till den autentiserade användaren utan att historiken försvinner.

## 2. Behavioral events

Minsta rekommenderade event vocabulary:

```text
event_impression
event_open
event_save
event_unsave
event_share
event_booking_click
recommendation_like
recommendation_dislike
search_performed
```

Varje relevant event bör kunna innehålla:
- `anonymous_user_id` eller `user_id`
- `event_id` där relevant
- timestamp
- session identifier där relevant
- event-specific metadata

Tracking får inte blockera UI eller krascha produkten.

## 3. Signal strength

Alla signaler är inte lika starka.

Konceptuellt:

```text
impression
   <
open
   <
save/share
   <
booking_click / explicit like
```

`recommendation_dislike` är en explicit negativ signal.

De faktiska vikterna ska ligga centralt och kunna ändras genom experiment.

## 4. Taste Profile v1

Taste Profile bör initialt vara transparent och deterministisk snarare än en komplex ML-modell.

Profilen härleds från faktisk eventmetadata som redan finns i databasen, exempelvis:
- categories
- tags
- venue
- geography
- price
- start time
- event type

Använd inte fält som inte faktiskt existerar.

## 5. Ranking pipeline

```text
natural language / filters
          ↓
      parse intent
          ↓
      hard filters
          ↓
  candidate retrieval
          ↓
     Taste Profile
          ↓
 personalized scoring
          ↓
 diversity / redundancy
          ↓
      final ranking
```

Möjliga scoringkomponenter:

```text
score_total
score_intent
score_taste
score_time
score_distance
score_quality
```

## 6. Viktig rankingregel

**Explicit intent slår historisk smak när de står i konflikt.**

Exempel:

Användaren brukar gå på konserter men söker:

> museum med barnen på söndag

Historiken får inte göra att konserter tar över resultatet.

## 7. Candidate strategy

Med cirka 6 000 Stockholm-events behöver inte en dyr modell resonera över samtliga events.

Princip:

```text
~6000 events
     ↓
filters/retrieval
     ↓
manageable candidate set
     ↓
ranking
     ↓
top recommendations
```

Den exakta candidate-set-storleken ska bestämmas genom mätning, inte antas i förväg.

## 8. Privacy

Designa enligt dataminimering:
- samla bara data som behövs för produktfunktionen
- separera identitet från onödig persondata
- bygg tydliga mekanismer för consent/preferences där juridiskt nödvändigt
- dokumentera retention/deletion
- granska GDPR/ePrivacy-krav innan produktion

Detta dokument är en produkt-/teknikarkitektur, inte juridisk rådgivning.
