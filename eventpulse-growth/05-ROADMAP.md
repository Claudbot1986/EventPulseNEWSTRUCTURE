# EventPulse – Growth Roadmap

Se [README.md](README.md) för översikt och [03-IMPLEMENTATION-PROMPTS.md](03-IMPLEMENTATION-PROMPTS.md) för exakta prompts.

## Phase 0 – Verify reality

**Prompt 1**
- audit current code
- audit database
- audit existing auth/tracking/ranking
- skapa `docs/growth/00-current-state.md`

### Gate
Ingen implementation förrän verkligt nuläge är dokumenterat.

---

## Phase 1 – Identity & measurement

**Prompt 2–3**
- anonymous identity
- behavioral event layer

### Gate
Verifiera att samma anonyma användare känns igen efter omstart och att tracking fungerar utan att påverka UX.

---

## Phase 2 – Personalization core

**Prompt 4–5**
- Taste Profile v1
- personalized ranking v1

### Gate
Tester ska visa att:
- olika beteenden skapar olika profiler
- explicit intent kan slå historisk profil
- rankingkomponenterna går att inspektera

---

## Phase 3 – User feedback & cold start

**Prompt 6–7**
- like/dislike
- reasons
- onboarding

### Gate
En ny anonym användare ska kunna ge tillräckliga signaler för att få en första personalisering utan konto.

---

## Phase 4 – Event agent

**Prompt 8–10**
- For You
- natural language
- explainability

### Gate
Samma rankingmotor ska användas genom hela produkten. Undvik separata system som divergerar.

---

## Phase 5 – Growth loop

**Prompt 11–12**
- sharing
- Hjälp oss välja
- deep links
- attribution

### Gate
Det ska gå att mäta:

```text
share → recipient open → interaction → continued use
```

---

## Phase 6 – Conversion & retention

**Prompt 13–14**
- account conversion
- anonymous → authenticated migration
- Din helg

### Gate
Registrering får inte förstöra tidigare personalisering eller skapa dubbletter.

---

## Phase 7 – Optimization

**Prompt 15**
- experiment framework
- ranking experiments
- onboarding experiments
- growth experiments

Se [04-METRICS-EXPERIMENTS.md](04-METRICS-EXPERIMENTS.md).

---

# Prioriteringsregel

När det uppstår nya idéer, fråga:

1. Förbättrar detta discovery?
2. Förbättrar detta recommendation quality?
3. Ger det en starkare beteendesignal?
4. Ökar det sharing/acquisition?
5. Ökar det retention?
6. Kan effekten mätas?

Om svaret är nej på nästan allt bör funktionen sannolikt inte avbryta roadmapen.
