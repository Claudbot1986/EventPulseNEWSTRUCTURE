# Kvalitet — beskrivningen är prosa, inte faktmall

**Kommando:** `node --env-file=.env --import tsx scripts/verify-description-rights.ts`
(rapporterar `info_level`-fördelningen i rapporten) +
`node --env-file=.env --import tsx scripts/measure-editorial-rejections.ts 30 LOW`
(diagnos av varför prose underkänns — skriver INTE till DB).

## Sub-features

- **Q1 — rimlig andel prosa.** `editorial_description` ska vara läsbar
  prosa för de flesta events, inte en faktmall.
- **Q2 — faktmallen är acceptabel som utväg.** Ett tunnt event utan
  profilerad artist får en faktmall — det är medvetet (bättre en tråkig
  faktalista än ingenting).

## How to get to it (user POV)

Användaren läser beskrivningen. "Typ: sport. Lokal: arena / plan. För: vuxna.
Datum: 19 december 2026. Tid: 12:00." är information, inte en beskrivning.
Den typen av text är rätt för ett tunt event — men inte för ett event där
modellen faktiskt kan skriva.

## Driving it with

`info_level`-fördelningen i databasen är måttet:

| info_level | Betyder | Förväntat |
|---|---|---|
| `RICH` | full profil | prosa |
| `MEDIUM` | normal profil | prosa |
| `LOW` | tunn profil | **faktmall** — men 2026-11-02: 5 441 av 5 453 var faktmall trots rimlig prosa |
| `VERY_LOW` | mycket tunn | kort prosa |

**2026-11-02 — fyndet:** 30 LOW-level events kördes om genom pipelinen.
24 föll tillbaka till faktmall, 6 klarade grinden. 145 claims underkändes,
och varje enda av de 40 vanligaste var connective glöd — "riktar", "erbjuder",
"stödja", "bygger", "bjuder", "kombinerar", "följa", "vänder" — inte
hallucinationer. Gaten behandlade normal redaktionell glöd som ett påstående
som måste spåras i profilen.

**Isolerad effektmätning (samma 30 drafts, bara vokabulärlistan ändrad —
LLM-variansen ute ur ekvationen):**

| Vokabulär | PASS | FAIL | underkända claims |
|---|---:|---:|---:|
| Före fixen (`HEAD`) | 8 | 22 | 151 |
| Efter första omgången | 12 | 18 | 93 |
| Efter första + andra omgången | 12 | 18 | **82** |

Passandel 27 % → 40 %, underkända claims −46 %.

**VARNING — mät inte bara genom pipelinen.** En körning av hela pipelinen
givit 6/30, 18/30 och 14/30 PASS för samma kod, eftersom LLM-texten varierar
mellan körningar. Siffrorna ovan är från **cachade drafts** — samma text,
bara olika grind. Utan den isoleringen mäter man LLM-varians, inte fixen.

**Trappan i kod:** `FallbackLevel = 'FACT' | 'MINIMAL' | null`
(`fallbackHierarchy.ts`). "GOOD" är **inte** en nivå i koden — det är
pipeline-svaret när LLM-texten klarar grindarna. Trappan är alltså:
LLM-text (klarar grinden) → FACT → MINIMAL → null.

**Fixen:** `NON_FACTUAL_VOCABULARY` i `04-Normalizer/editorial/factualityCheck.ts`
— ord som inte kan verifieras eller falsifieras mot profilen får inte bilda
claims.

## Gotchas

- **Listan måste förbli snäv.** Ord som påstår något om evenemanget får
  INTE vara i den: "scen", "lokal", "kväll", "gemensam", "community",
  "format", "genre" är fakta. FARVEBLIND-fallet i
  `factualityCheck.test.ts` (ett event som påstår "community" utan att
  profilen bär det **ska** underkännas) skyddar detta.
- **Att underkänna mindre gör inte beskrivningen mindre riktig.** Grinden
  fångar hallucinationer; den ska inte fånga glöd.
- **`fallbackHierarchy.ts` trappan är FACT → MINIMAL → null.** En FACT-mall
  är en avsiktlig utväg, inte ett fel — men den ska vara sällsynt.
- **Kör editorial-testerna efter varje ändring i vokabulärlistan:**
  `npx vitest run 04-Normalizer/editorial/` (443 tester).
- **Att ändra vokabulärlistan påverkar inte upphovsrättsgrinden.** B (inga
  källtext till writer) och C (utdata liknar inte källtexten) är orörda av
  den här ändringen — men kör gaten igen för att bevisa det.
