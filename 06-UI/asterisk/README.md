# `*` — AI Event Posters test page

Separat Expo-entry för att testa AI-eventbilder med **Black Forest Labs FLUX.1 [schnell]**.

Huvudappen (`06-UI/App.js`) påverkas **INTE** av denna kod — det är en fristående route.

---

## Syfte (Del B — TESTKÖRNING)

Hämta samma events som hemknappen (första 10 från Supabase via `eventServiceClient.js`), generera 10 stilvarianter per event med Flux, och låta användaren godkänna/avvisa. Användaren utvärderar AI-kvaliteten INNAN vi bygger Del C (automatisk produktion).

---

## Köra

```bash
cd 06-UI
EXPO_PUBLIC_BFL_API_KEY=bfl_... npx expo start --entry-file ./asterisk/index.js
```

I Expo Go (port 19006):
1. Anslut till Metro
2. Välj `asterisk/index.js` som entry i dev-menyn
3. Appen startar med `*`-sidan och hämtar automatiskt 10 events från Supabase

För att återgå till huvudappen: `npx expo start` (utan `--entry-file`).

---

## Kostnad

~$0.003 per 1024×1024-bild. 10 bilder ≈ **$0.03** per körning.

---

## Säkerhet

- API-nyckel i klient = dev/test ONLY. Inte för App Store / Play Store.
- Innan produktion: flytta anrop till `08-Agent/server.ts` (BACKLOG NOW #3).
- API-nyckeln får aldrig loggas.

---

## Copyright-policy (7 lager)

Alla skydd är explicita i `services/prompts.js`:

| Lager | Skydd |
|-------|-------|
| 1 | Inga riktiga venue-/artist-/varumärkesnamn — anonymiseras |
| 2 | Inga riktiga människor/ansikten |
| 3 | Inga logotyper/varumärken |
| 4 | Inga igenkännbara byggnader |
| 5 | Ingen text/typografi (skyddar typsnitts-/ordmärken) |
| 6 | Aldrig "in the style of [artist]" — alla stilar är abstract |
| 7 | AI-märkning enligt EU AI Act (`aiGenerated: true` + metadata) |

---

## Flöde

```
[Supabase via fetchEvents] → 10 första events (samma som hemknappen)
   ↓
[EventPicker] → användaren väljer event
   ↓
[buildVariations(event)] → 10 prompts (samma bas + 10 stilar)
   ↓
[generateFluxSchnell × 10] → BFL submit → poll → base64
   ↓
[ImageCard grid] → godkänn/avvisa varje variant
   ↓
[saveApprovedImages] → documentDirectory/storage/savedImages.json
```

---

## Nästa steg (Del C — INTE byggt ännu)

Efter godkänd testsida:
1. Välj stil-template baserat på testsidans resultat
2. Sätt upp Supabase Storage-bucket `event-posters/`
3. Bygg `03-Queue/generateMissingImages.ts` — Node-script:
   - SELECT events WHERE image_url IS NULL
   - Generera EN Flux-bild per event (idempotent)
   - Upload till Supabase Storage
   - UPDATE events.image_url
4. Kör som post-import-hook
5. Verifiera i Expo att events har AI-bilder