# EventPulse – Metrics & Experiments

Se [01-STRATEGY.md](01-STRATEGY.md) för growth loop och [03-IMPLEMENTATION-PROMPTS.md](03-IMPLEMENTATION-PROMPTS.md) för implementation.

## North Star-princip

Mät inte framgång främst genom downloads eller konton.

EventPulse måste mäta om rekommendationerna leder till faktisk intention/handling.

## Core funnel

```text
event_impression
      ↓
event_open
      ↓
event_save / event_share
      ↓
event_booking_click
```

Exempel:

```text
1 000 impressions
280 opens
80 saves/shares
35 booking clicks
```

Efter rankingförändring:

```text
1 000 impressions
340 opens
105 saves/shares
52 booking clicks
```

Detta är betydligt mer användbart än en subjektiv bedömning att rankingen "känns bättre".

## Primära metrics

- recommendation → open rate
- open → save rate
- open → share rate
- open → external booking click
- return rate
- For You engagement
- explicit like/dislike ratio

## Personalization lift

Jämför personaliserad ranking mot relevant baseline.

Fråga:

> Ökar personalisering sannolikheten att användaren öppnar, sparar, delar eller går vidare till bokning?

## Guardrails

En metric får inte förbättras genom att andra viktiga delar förstörs.

Följ bland annat:
- latency
- errors
- empty result rate
- duplicate/repetitive recommendations
- dislike rate
- coverage
- tracking failures

## Experimentprinciper

1. Ändra helst en viktig hypotes åt gången.
2. Definiera primary metric före experimentet.
3. Definiera guardrails före experimentet.
4. Stable assignment för användaren.
5. Logga exposure korrekt.
6. Avsluta inte experiment bara för att tidiga siffror ser bra ut.
7. Dokumentera beslut och resultat.

## Hypoteser att testa

### Ranking
Personaliserad ranking ger högre meaningful-action rate än opersonaliserad ranking.

### Antal rekommendationer
Ett litet kuraterat urval kan ge högre handling än en lång lista.

### Login timing
Login efter upplevt värde kan ge bättre total funnel än login före discovery.

### Sharing
"Hjälp oss välja" kan skapa fler nya användarsessioner än vanlig eventdelning.

### Retention
"Din helg" kan öka återkommande användning jämfört med enbart on-demand search.
