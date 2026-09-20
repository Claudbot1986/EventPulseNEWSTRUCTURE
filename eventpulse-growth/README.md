# EventPulse Growth System

Detta dokumentpaket beskriver en inkrementell plan för att utveckla EventPulse från en eventaggregator med cirka 6 000 events i Stockholm till en personlig eventagent med en inbyggd growth loop.

## Grundidé

**Aggregation → discovery → personalisering → delning → retention → konto**

Användaren ska inte behöva skapa konto innan EventPulse har visat värde.

Rekommenderat flöde:

```text
Anonym användare
    ↓
anonymous_user_id
    ↓
sökning + beteendesignaler
    ↓
Taste Profile
    ↓
personligare ranking
    ↓
save/share/booking
    ↓
återkommande rekommendationer
    ↓
konto när det finns något värt att spara
    ↓
anonymous history → user_id
```

## Dokument

1. [01-STRATEGY.md](01-STRATEGY.md) – produkt- och growthstrategin.
2. [02-ARCHITECTURE.md](02-ARCHITECTURE.md) – identitet, beteendedata, taste profile och ranking.
3. [03-IMPLEMENTATION-PROMPTS.md](03-IMPLEMENTATION-PROMPTS.md) – prompts som körs en i taget i Claude Code.
4. [04-METRICS-EXPERIMENTS.md](04-METRICS-EXPERIMENTS.md) – funnel, North Star och experiment.
5. [05-ROADMAP.md](05-ROADMAP.md) – rekommenderad byggordning och checkpoints.

## Viktig regel

Kör inte hela planen som en enda stor implementation. Varje steg ska:
1. inspektera befintlig implementation,
2. göra en begränsad förändring,
3. testas,
4. dokumenteras,
5. verifieras innan nästa steg.

Börja med [03-IMPLEMENTATION-PROMPTS.md](03-IMPLEMENTATION-PROMPTS.md), Prompt 1.
