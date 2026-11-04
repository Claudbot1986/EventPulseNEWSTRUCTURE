# verify-eventpulse-launch/features — index

Feature-map för **Apple-lanseringsgrinden**. Varje fil beskriver en yta som
en granskare kan nå, hur den drivs och vad som bevisar att den stämmer.

| # | Feature | Fil | Lager | Bevis 2026-11-04 |
|---|---|---|---|---|
| 1 | Juridisk text i appen | `privacy-policy-in-app.md` | app (live) | 2/2 PASS — ingen platshållare, ingen banner, rätt leverantör |
| 2 | Granskarens inloggning | `demo-account-access.md` | app (live) | 2/2 PASS + 1 skip (fallet "flaggan av") |
| 3 | Publicerad IPA | `ios-artifact.md` | artefakt | 26/26 kontroller gröna |
| 4 | Lanseringskonfiguration | `launch-config.md` | repo | 49/49 kontroller gröna |
| 5 | Live-webbens policy | `live-website-policy.md` | webb | **röd** — sidan är inte deployad (blockerat för ägaren) |

Varje feature-fil har fyra H2:er: `Sub-features`, `How to get to it (user POV)`,
`Driving it with <harness>` och `Gotchas`.

## Vad som INTE kan verifieras här

- **Skärmbilder** — kräver Xcode/simulator eller en riktig iPhone. Inga sådana
  bilder finns i repot; shot-listen ligger i
  `docs/APPLE-SUBMISSION-METADATA.md`.
- **Push-notiser** — kräver riktig enhet och APNs-miljö. Webbygget har ingen
  push-implementation (`verified-unreachable`).
- **Kartan på iOS** — MapKit renderas bara på native; webbygget använder en
  shim. Provider-värdet är statiskt verifierat, renderingen inte.
- **App Store Connect-state** — avtal, skatt/bank, app-post. Syns bara från
  dashboarden.
