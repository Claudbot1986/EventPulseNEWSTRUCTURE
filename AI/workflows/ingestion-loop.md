# Ingestion Loop

## Purpose

This workflow defines how to run systematic C-htmlGate batch loops for iterative model improvement.

## Core Loop

```
Analyze → Select ONE problem → Fix → Verify → Evaluate → Report
```

## C-Batch-Loop Workflow

C-batch-loop är en **modellutvärderingsprocess**, inte vanlig source-testing.

### Steg 1: Förbered Batch

1. Hämta nästa 10 C-kandidater från C-kandidatkön
2. Verifiera att ingen är:
   - Redan verifierad A/B källa
   - D-pending (render-misstanke)

### Steg 2: Kör Baseline

Kör C-htmlGate en gång på alla 10.
Logga: events före förbättring per source.

### Steg 3: AI-Analys

För varje källa i batchen:
- Varför lyckades C?
- Varför misslyckades C?
- Vilka HTML-mönster verkar generella?
- Vilka förbättringar föreslås?

### Steg 4: Applicera Förbättringar

- Implementera generella förbättringar (ej site-specifika)
- Dokumentera exakt vad som ändrades

### Steg 5: Kör Efter-förbättring

Kör C igen på samma 10.
Logga: events efter förbättring per source.

### Steg 6: Jämför och Rapportera

1. Jämför före/efter per source
2. Spara rapport i `02-Ingestion/C-htmlGate/reports/batch-{N}-{datum}.md`
3. Uppdatera ackumulerad kunskapsbank

## Rapportstruktur

```markdown
# Batch {N} — {datum}

## Batch Info
- sources: 10
- batch_id: {N}

## Resultat per Source

| Source | Före | Efter | Delta | Anledning |

## Generella Mönster

- ...

## Förbättringsförslag

- ...

## Cross-Site Verification

- [ ] Förslag X: verifierat på Y oberoende domäner
- [ ] Förslag Z: behöver verifiering
```

## Kompakthetskrav

- Max 1-2 sidor per rapport
- Inga fullständiga HTML-dumpar
- Endast summarisk data per source
- Samla långsiktiga mönster i separat kunskapsbank-fil

## Batch-Loops Begränsningar

- Fokusera på BREDD, inte djup
- INGEN site-specifik kod i C-modellen
- Site-specifika problem -> source adapter
- Varje batch = steg i riktning mot generell modell

## Exit Criteria

Loop är klar när:
- 10+ batchar körda
- Generella mönster dokumenterade
- Modellförbättringar verifierade över 3+ domäner
- Kunskapsbank växer stabilt
