# Live-webbens policy

## Sub-features

- `https://eventpulse.nu/privacy/` — den URL som ska skrivas in som
  Privacy Policy URL i App Store Connect.
- `https://eventpulse.nu/en/privacy/` — den engelska varianten.
- Innehåll: vem vi är, vad vi samlar, rättslig grund, gallring,
  underleverantörer (Supabase eu-north-1, Fly.io, Expo/APNs, MiniMax), vad
  som skickas till MiniMax, överföringsmekanism, rättigheter, AI, 18 år, IMY.

## How to get to it (user POV)

Öppna `https://eventpulse.nu/privacy/` i webbläsaren — eller följ länken i
appen: Profil → Integritetspolicy → "Läs den fullständiga versionen …".

## Driving it with <harness>

```bash
node .cursor/skills/verify-eventpulse-launch/scripts/check-live-site.mjs
```

Hämtar båda språkversionerna live och kontrollerar innehållet. Exit non-zero
om sajten inte är uppdaterad. `--allow-stale` rapporterar bara utan att
faila.

## Gotchas

- **Deployen sker inte från den här miljön.** Båda Cloudflare-token i `.env`
  ger "Authentication error" (403). Webbplatsen ligger på Cloudflare Pages;
  ägaren måste deploya `site/` (git-push till rätt branch eller manuell
  uppladdning i dashboarden).
- **Status 2026-11-04: röd.** Texten är skriven och pushad till `bfl`, men
  live-sidan svarade fortfarande med den gamla 859-teckensversionen efter
  12 pollningar under ~4 minuter. Det är ett blockerat steg, inte ett fel i
  appen.
- **Gamla versionen var för kort för §5.1.1(i)** — ingen tredje part, ingen
  gallring, inget AI, ingen rättslig grund. En granskare som jämför
  app-texten med webbtexten ser skillnaden.
- **Kontrollera båda språken.** Den engelska sidan är separat HTML och
  uppdateras inte automatiskt med den svenska.
