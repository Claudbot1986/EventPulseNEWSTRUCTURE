# Notiser (lista)

## Sub-features

- Fliken "Notiser" visar en lista över påminnelser, matchningar och svar.
- För en gäst utan notifier: tomt läge — "NOTISER / Dina påminnelser och svar / … / **Inga notiser än.** Spara ett event …".
- Listan kommer **enbart från agent-API:t** via `notificationsClient` (`GET /agent/notifications`) — **ingen lokal cache** finns. En session krävs (appen bootar en anonym Supabase-session); saknas session visas inloggningsprompten i stället för tomt läge. En **andra** datakälla är `GET /agent/attendance` → sektionen "betygsättning".

## How to get to it (user POV)

Klicka "Notiser" i bottenstaplen.

## Driving it with Playwright

Ingen spec ännu. Recept:

1. Öppna appen → klicka fliken "Notiser" (synlig `[role="tab"]` med `aria-label="Notiser"`).
2. Vänta på texten "NOTISER".
3. Asserta att antingen listrader eller tomt läge visas — **aldrig** en tom vit skärm.

## Gotchas

- Fliken har **noll `<button>`-element** i tomt läge (verifierat live 2026-10-28) — asserta på text, inte på knappar.
- Notiser kräver sparade events; en gäst kan inte nå "matchning"-läget utan konto.
- Push-token registrering är **native-only** (`expo-notifications`) — på web registreras ingen token, men listan ska ändå monteras utan krasch.
- `EXPO_PUBLIC_PUSH_ENABLED` används **ingenstans i koden** (verifierat repo-wide). FEATURE_MAP § 2:s "behind-flag" är stale — de verkliga grindarna är `isPushRuntimeAvailable()` + `eventpulse.din_helg_push_prompt_shown`. Se `push-din-helg.md`.
