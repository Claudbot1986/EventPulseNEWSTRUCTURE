# Utforska shows one card per event

Utforska must not render two cards for the same event. The category lists
(Komedi, Musik, Drama, …) are the surface where the user reported the
problem: "MAFFIA COMEDY SUPERWEEKEND" appeared twice under Comedy.

## Sub-features

- `one-card-per-event` no two rendered cards share title + date + time.
- `all-pages-checked` the check covers the whole paginated list, not only
  the first page.
- `no-console-errors` the drive produces no console or page errors.
- `proof-written` every card that was read is written to the evidence file.
- `pairs-visible` every pair of cards that share a title and a date is
  listed for review, even when the times differ.

## How to get to it (user POV)

- Open the app, choose Utforska, choose a category, and scroll the list.
- Search for an event in Utforska and read the result list.
- The Home carousels show the same events from the same feed.

## Driving it with Playwright

Preconditions:

- The Expo web build is running at `http://localhost:9090` and the local
  agent API answers on `http://localhost:8787` (see `../SKILL.md`).
- The database has no duplicate groups (`npx tsx scripts/audit-duplicates.ts --gate`).

- **Open Utforska.** From the `06-UI` directory run
  `BASE_URL=http://localhost:9090 npx playwright test e2e/dedup-no-duplicate-cards.test.mjs`.
  The path `e2e/…` only resolves there — the only Playwright config in the
  repo is `06-UI/playwright.config.js`.
  The spec drives the real build: it taps the Utforska tab, opens each
  category in `DEDUP_CATEGORIES`, scrolls the list to the end, and reads
  the card labels out of the DOM.
- **Read the verdict.** The spec prints
  `[dedup] <kategori>: N kort efter M scrollrundor` per category and a
  summary line `[dedup] N kort i K kategorier — X dubblettgrupper
  (hårdfel), Y mjuka observationer, Z par med samma titel+datum
  (granskning), W av dem med identisk tid`.
  The test fails when X > 0, when a category cannot be opened, when a
  category renders no cards, or when the drive produced console errors.
- **Inspect the evidence.** Read
  `06-UI/runtime/verification-reports/dedup-verify-<ts>/dedup-cards.json`.
  It contains every card that was read (`cards`), plus the findings and the
  review list. `kind: "exact"` is a hard failure (same title + date +
  time); `kind: "soft"` is reported but not failed (same title + date +
  venue with the times within 180 minutes — usually one show listed by
  several aggregators). The `review` array lists every pair that shares a
  title and a date regardless of time or venue — it is a review list, not a
  failure, because a matiné and an evening show legitimately share both.

## Gotchas

- **The first page is not enough.** The category list paginates 15 at a
  time. Without scrolling, the check reads ~13 cards per category and
  misses everything later — the MAFFIA case (20 nov) was invisible that
  way, and the gate passed green on a database that still had the
  duplicate. Scroll the list.
- **Wait for the category tile.** After "Tillbaka" the category chips are
  re-fetched; tapping during the loading skeleton makes the gate report
  "kategorin kunde inte öppnas" — a false red, not a duplicate. The spec
  waits for the tile text and for the first batch of cards.
- The scroll container may be the `utforska-section-screen` element itself,
  not a descendant. Search both.
- React Native Web's `Pressable` does not answer `.click()`. Use the
  pointer-event helpers in `06-UI/e2e/helpers/ui.mjs`.
- The card label format is `"<titel> — <datum · tid · venue · area>"`. The
  date part is Swedish ("FRE 6 nov"), so compare it as an opaque string —
  do not parse it.
- `aria-selected` is not in the DOM. Select the tab by `[role="tab"]` and
  visibility.
- The app de-duplicates by id across pages when it appends, so two cards
  with a byte-identical label are no longer explained by a pagination bug:
  they are two distinct database rows. Check the database.
