# Plan — Hem-sektion (hybrid)

Plan för att bygga EventPulse Hem-sektion i `06-UI-sandbox/`.
Strategisk översikt är fast. Detaljer per fas bestäms och godkänns
i varje fas. Stop efter varje naturligt slutförd fas.

## Bakgrund

- **Sandbox:** isolerad, plain `StyleSheet`, `useState` bara, ingen
  Supabase / providers / services.
- **06-UI/:** produktion, off-limits från sandbox.
- **Tidigare Jev-slutsats (2026-09-23):** "Smak i gästläge = första
  fokus; Din helg prioriteras." Hem-sektionen ska därför ha "Din helg"
  primärt och "Smak" prominent.
- **Jev + Karpathy-rådet (2026-09-24):** eniga om hybrid planstruktur
  och ordningen Card → Carousel → HemScreen. Confidence 0.98 för
  ordningen, 0.99 för planstrukturen.

## Strategisk översikt (fast)

**Mål (2 veckor):**
Hem-sektion som visar flera karuseller, där "Din helg" är primärt
innehåll och "Smak" (smakprofil) är prominent.

**Ordning:**
1. **EventPulseCard** — liten komponent (bild + text + placeholder).
2. **EventPulseCarousel** — komplex komponent (använder
   `EventPulseCard` × N + header + scroll).
3. **HemScreen** — sektion (använder `EventPulseCarousel` × 3+ inkl
   "Din helg" + "Smak").

**Varför denna ordning:**
Card är atomärt och testbart ensamt. Carousel kan inte testas utan
Card. HemScreen kan inte testas utan Carousel. Varje fas ger ett
komplett, synligt resultat innan nästa byggs.

**Scope-gränser:**
- Allt byggs i `06-UI-sandbox/components/` + `06-UI-sandbox/App.js`.
- `06-UI/` rörs inte.
- Inga nya npm-paket.
- Plain `StyleSheet`, tokens från
  `06-UI-sandbox/.claude/eventpulse/ui/DESIGN_SYSTEM.md`.
- Sandbox-konventioner: `useState` bara, inga providers, inga
  services.

---

## Fas 1 — EventPulseCard

**Mål:** En återanvändbar kort-komponent. Bild (eller placeholder),
titel, subtitle.

**Detaljer (bestäms i fasen, inte nu):**
- Press-feedback: opacity 0.7 eller scale 0.98 (välj en).
- Title: `numberOfLines={2}`, `ellipsizeMode="tail"`, 13 pt / 700,
  letter-spacing -0.3, line-height 18.
- Subtitle: `numberOfLines={1}`, 13 pt / 600, muted.
- Placeholder när bild saknas: samma stil som befintlig
  `HorizontalCardCarousel.js`.
- `accessibilityRole="button"` + `accessibilityLabel="${subtitle} —
  ${title}"`.
- Image source normalization (sträng-URL → `{ uri }`, require →
  nummer).
- Varianter: `sm` / `md` / `lg` — eller bara `md` för enkelhetens
  skull.

**Stop-kriterier (måste vara uppfyllda innan vi går vidare):**
- [ ] `EventPulseCard.js` finns i `06-UI-sandbox/components/`.
- [ ] `npx tsc --noEmit` exit 0.
- [ ] Importerad och renderad i `App.js` (minst en synlig instans).
- [ ] Screenshot tagen (eller `expo start` logg).
- [ ] Visual review enligt `UI_REVIEW.md` — hierarchy, spacing,
      typography OK.
- [ ] Accessibility labels verifierade.

**Verifieringskommando:**
```bash
cd 06-UI-sandbox && npx tsc --noEmit
```

---

## Fas 2 — EventPulseCarousel

**Mål:** Horisontell karusell som tar en array av data och renderar N
`EventPulseCard`. Plus header (kategorinamn) och skeleton-stöd.

**Detaljer (bestäms i fasen):**
- Använder fas 1:s `EventPulseCard`.
- Wrapper med `marginHorizontal: -20` + `paddingHorizontal: 20` för
  edge-bleed (samma som `06-UI/components/EventPulseCarousel.js`).
- Loading: `skeletonCount` (default 4) skeleton-Cards i samma
  storlek.
- Header-text: 11 pt / 800 / uppercase / `color.accent` (eyebrow-stil).
- Scroll: native `ScrollView horizontal`.
- Tom array: visa inte karusellen (return null).
- a11y: hela karusellen `accessibilityRole="list"`, varje Card ett
  `"button"`.

**Stop-kriterier:**
- [ ] `EventPulseCarousel.js` finns.
- [ ] Använder fas 1:s `EventPulseCard` (inte duplicerad).
- [ ] `tsc --noEmit` exit 0.
- [ ] 3 dataset testat: 1 kort, 5 kort, 0 kort (tom karusell döljs).
- [ ] Loading-skeleton fungerar.
- [ ] Screenshot + visual review.

---

## Fas 3 — HemScreen

**Mål:** En sektion som komponerar flera karuseller enligt Jevs
slutsats om Hem-prioritering.

**Detaljer (bestäms i fasen):**
- Använder fas 2:s `EventPulseCarousel`.
- 3 karuseller enligt Jev-prioritering:
  1. **"Din helg"** — primärt innehåll, överst.
  2. **"Smak"** (smakprofil) — prominent, för gästläge.
  3. **"Ikväll"** eller annan — sekundärt.
- Header på sektionen: "Hem" (stor titel, samma stil som `App.js`
  `title`).
- Eyebrow ovanför: "Välkommen tillbaka" eller liknande.
- States: default (3 karuseller), loading (alla 3 skeletons), error
  (banner), empty (1 banner).
- Hardkodad data i sandbox (kopplas inte till Supabase här).

**Stop-kriterier:**
- [ ] `HemScreen.js` finns (antingen som separat fil eller inuti
      `App.js`).
- [ ] Använder fas 2:s `EventPulseCarousel`.
- [ ] `tsc --noEmit` exit 0.
- [ ] Alla states renderade.
- [ ] Screenshot + visual review enligt Hem-sektionens prioritering.

---

## Öppna frågor innan fas 1 startas

1. **Namn:** `EventPulseCard` OK? Eller bara `Card`?
2. **Varianter:** Ska Card ha `sm` / `md` / `lg` eller bara en storlek?
3. **Befintlig `HorizontalCardCarousel.js`:** Tas bort när
   `EventPulseCarousel` finns, eller behålls som "in-progress" tills
   vidare?
4. **Press-feedback:** opacity 0.7 eller scale 0.98? Välj en och håll.
5. **Hem data i sandbox:** Hardkodade 3 karuseller med svenska titlar?
   Ska vi låta dig specificera titlarna nu eller i fas 3?

Besvara de du vill, resten bestämmer jag i fasen och visar dig innan
jag går vidare.

---

## Referenser

- `.claude/skills/frontend-design/SKILL.md` — repo-level skill.
- `.claude/eventpulse/ui/DESIGN_SYSTEM.md` — tokens.
- `.claude/eventpulse/ui/COMPONENT_RULES.md` — file layout, anatomy.
- `.claude/eventpulse/ui/UI_REVIEW.md` — self-critique checklist.
- `.claude/eventpulse/ui/UI_WORKFLOW.md` — 18-stegs process.
- `06-UI-sandbox/components/HorizontalCardCarousel.js` — befintlig
  sandbox-referens.
- `06-UI/components/EventPulseCarousel.js` — produktions-referens.

## Historik

- 2026-09-24: skapad efter Karpathy-råd + Jev-konsultation. Hybrid
  planstruktur vald av användaren. Confidence 0.98 för ordningen.
- 2026-09-25: Fas 1 (`EventPulseCard`) och Fas 2 (`EventPulseCarousel`)
  levererade i sandboxen. Följande designbeslut förankrade i
  UI-hjärnan under iterationen:
  - **`description`-roll** (fontWeight 200, gray text under header)
    tillagd i `TYPOGRAPHY.md` + `DESIGN_SYSTEM.md`. Endast tillåten
    vikt under 400; undantag från "Don't use weight 100–300"-regeln.
  - **Asymmetriskt kort-spacing** (`imageToTitle: 6`,
    `titleToSubtitle: 4`) — enskilda `marginTop` per barn istället
    för ett enhetligt `gap`. Dokumenterat i `SPACING.md § Asymmetric
    card spacing`. `6` är utanför standard-spacing-skalan och finns
    nu i `SPACING.md § Approved off-scale exceptions`.
  - **Header edge-bleed** i karuseller — headern får samma
    `marginHorizontal: -SCREEN_PADDING` som `clipWrapper` så dess
    vänsterkant ligger i lodrät linje med första kortets bild.
    Dokumenterat i `COMPONENT_RULES.md` + `SPACING.md § Header
    edge-bleed`. Prod (`06-UI/components/EventPulseCarousel.js`)
    saknar mönstret — drift att åtgärda vid sandbox→prod-handoff.
  - **App.js `itemDescription`** (preview-ramverket):
    `fontWeight: 500 → 400 → 200`, `marginTop: 12 → 6`. Sandbox-only.
