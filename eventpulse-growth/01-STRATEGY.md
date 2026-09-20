# EventPulse – Growth Strategy

Se även [README.md](README.md), [02-ARCHITECTURE.md](02-ARCHITECTURE.md) och [04-METRICS-EXPERIMENTS.md](04-METRICS-EXPERIMENTS.md).

## Utgångsläge

EventPulse har nu cirka **6 000 events i Stockholm**. Fokus bör därför flyttas från enbart ingestion/coverage till discovery, ranking, personalisering, retention och organisk distribution.

## Produktpositionering

EventPulse bör inte primärt svara på:

> Vilka events finns?

Den bör svara på:

> Vad ska jag göra?

Exempel:

> Jag och min tjej vill göra något kul i Stockholm ikväll. Inte klubb. Något lite annorlunda och max 500 kr.

Målet är inte att visa 100 resultat. Målet är att hitta några få mycket relevanta alternativ.

## Growth loop

```text
Google / social / vän / direkt
             ↓
         EventPulse
             ↓
      relevant discovery
             ↓
       3–5 bra events
             ↓
      open/save/share/book
             ↓
     beteendedata skapas
             ↓
      Taste Profile förbättras
             ↓
 bättre rekommendationer
             ↓
       "Din helg"
             ↓
         användaren återkommer
             ↓
   event delas med andra
             ↓
        nya användare
```

## Konto ska komma efter värde

Obligatorisk login vid första användningen rekommenderas inte.

I stället:

**Nivå 1 – anonym**
- persistent `anonymous_user_id`
- sökningar och relevanta beteendesignaler kan kopplas till identiteten

**Nivå 2 – personalisering**
- EventPulse bygger successivt en Taste Profile
- rekommendationerna förbättras

**Nivå 3 – konto**
- konto erbjuds när användaren har något värt att bevara
- sparade events, smakprofil och historik kan följa med mellan enheter
- anonym historik länkas/migreras till `user_id`

Se teknisk modell i [02-ARCHITECTURE.md](02-ARCHITECTURE.md).

## Centrala produktfunktioner

Prioriterad utveckling:
1. anonym identitet
2. behavioral tracking
3. Taste Profile v1
4. personalized ranking
5. like/dislike feedback
6. onboarding
7. For You
8. natural-language discovery
9. explainability
10. sharing
11. "Hjälp oss välja" **(PARKERAD 2026-09-20 — byggs inte i detta repo)**
12. account conversion
13. "Din helg"
14. experiment framework

Detaljerad ordning finns i [05-ROADMAP.md](05-ROADMAP.md).

## Social loop

Varje event bör vara enkelt att dela.

En starkare funktion är:

### Hjälp oss välja

> **PARKERAD 2026-09-20.** Byggs inte i detta repo. Återupptas endast om post-launch share→open-mätningar (plain `/s/:hash`) visar verkligt delningsbeteende. Se `docs/BACKLOG.md` "DO NOT BUILD YET".

Användaren väljer exempelvis tre events och skapar en delbar sida. Vänner kan öppna länken och rösta utan att först skapa konto.

Det skapar:

```text
EventPulse user
   ↓
3 eventförslag
   ↓
delbar omröstning
   ↓
vän öppnar
   ↓
röstar
   ↓
exponeras för EventPulse
   ↓
potentiell ny användare
```

## Retention

EventPulse ska även skapa värde utan aktiv sökning.

Exempel:

### Din helg

En återkommande personaliserad samling med ett litet antal events som användaren sannolikt gillar.

Det skapar en återkommande anledning att öppna EventPulse.

## Princip

Optimera inte primärt för:
- antal events
- downloads
- registrerade konton

Optimera för om EventPulse faktiskt hjälper människor att hitta något de vill göra.

Se [04-METRICS-EXPERIMENTS.md](04-METRICS-EXPERIMENTS.md).
