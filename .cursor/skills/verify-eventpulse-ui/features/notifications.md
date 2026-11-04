# Notiser (lista)

## Sub-features

- Fliken "Notiser" visar en lista över **påminnelser** och (i teorin) matchningar och svar.
- **I praktiken kan bara `reminder` visas.** Servern skapar bara `reminder` (`08-Agent/tools/notification_center.ts:258`), `attendance_prompt` (`:578`) och `follow_drop` (`08-Agent/tools/follow_drops.ts:153`). Klientens `sanitize()` (`notificationsClient.js:77`) släpper igenom bara `reminder|match|response` ⇒ **`attendance_prompt` och `follow_drop` kastas bort**, och `match`/`response` finns bara i testfixtures. Resultat: en Notiser-lista kan i praktiken bara visa "PÅMINNELSER".
- För en gäst utan notifier: tomt läge — "NOTISER / Dina påminnelser och svar / … / **Inga notiser än.** Spara ett event …".
- Listan kommer **enbart från agent-API:t** via `notificationsClient` (`GET /agent/notifications`) — **ingen lokal cache** finns. En session krävs (appen bootar en anonym Supabase-session); saknas session visas inloggningsprompten i stället för tomt läge. En **andra** datakälla är `GET /agent/attendance` → sektionen "DELTAGIT" (renderad eyebrow; i18n-nyckeln heter "betygsättning").
- `requireUser` på servern accepterar **anonyma JWT:er** (`08-Agent/middleware/requireUser.ts:94-107`) — det finns ingen `is_anonymous`-spärr, och appen har ingen klientsida konto-spärr.

## How to get to it (user POV)

Klicka "Notiser" i bottenstaplen.

## Driving it with Playwright

Ingen spec ännu. Recept:

1. Öppna appen → klicka fliken "Notiser" (synlig `[role="tab"]` med `aria-label="Notiser"`).
2. Vänta på texten "NOTISER".
3. Assera att antingen listrader eller tomt läge visas — **aldrig** en tom vit skärm.
4. Om inloggningsprompten visas ("Logga in för att se dina notiser…"): `[aria-label="Logga in"]` ska finnas. Klicka den → i granskningsbygget kan man logga in med demologin → ladda om → assertera punkt 3 igen. Expect **"PÅMINNELSER"** eller tomtexten, **aldrig** "NYA MATCHNINGAR"/"SVAR".
5. Om "DELTAGIT" syns: `[aria-label="1 stjärna"]` … `[aria-label="5 stjärnor"]` ska finnas, och `[aria-label="Skicka betyg"]` ska vara inaktiverad tills en stjärna valts.

## Gotchas

- Fliken har **noll `<button>`-element** i tomt läge (verifierat live 2026-10-28) — asserta på text, inte på knappar.
- **Produktlucka (hittad 2026-11-04):** `attendance_prompt` och `follow_drop` filtreras bort av klientens `sanitize()` ⇒ de två servertyperna kan aldrig visas. Serverns "du varit på"-påminnelser når aldrig användaren.
- **Produktlucka (hittad 2026-11-04):** `isPushRuntimeAvailable()` returnerar **true på webb** (`appOwnership` är `null` i webbversionen av expo-constants) ⇒ "Din helg"-prompten visas i webbbygget och **förbrukar** engångsflaggan utan att någonsin registrera en token.
- **Inte en blockerare (2026-11-04):** "Notiser kräver sparade events; en gäst kan inte nå matchning-läget" — serverns `requireUser` tar emot anonyma sessioner, så gästen kan nå listan. Det som saknas är *matchningsrader*, inte behörighet.
- Push-token registrering är **native-only** (`expo-notifications`) — på web registreras ingen token, men listan ska ändå monteras utan krasch.
- `EXPO_PUBLIC_PUSH_ENABLED` används **ingenstans i koden** (verifierat repo-wide). FEATURE_MAP § 2:s "behind-flag" är stale — de verkliga grindarna är `isPushRuntimeAvailable()` + `eventpulse.din_helg_push_prompt_shown`. Se `push-din-helg.md`.
