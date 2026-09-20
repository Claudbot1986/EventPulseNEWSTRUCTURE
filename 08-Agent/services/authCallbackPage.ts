/**
 * renderAuthCallbackPage — the real web page an email confirmation link
 * lands on (GET /auth/callback on the agent server).
 *
 * Why this page exists (2026-09-20 incident): Supabase email links used to
 * dead-end on site_url=localhost:3000 — a broken "localhost-hemsida" for
 * anyone opening the mail on a computer, and a lost confirmation for the
 * app. GoTrue's /verify does the actual token verification BEFORE the
 * redirect, so this page's only jobs are:
 *
 *   1. Forward into the installed app: the implicit flow appends
 *      `#access_token=…&refresh_token=…` to the redirect URL. Fragments
 *      never reach the server, so a tiny inline script bounces the browser
 *      to `eventpulse://auth/callback#…` — the app's existing deep-link
 *      handler takes over exactly as if the email had pointed straight at
 *      the custom scheme.
 *   2. Be a sane landing when there is no app (mail opened on desktop,
 *      app not installed yet): show a clear Swedish "Bekräftat" page.
 *
 * Security notes:
 *   - Everything dynamic is written via textContent (no HTML injection from
 *     error_description et al).
 *   - Tokens live only in the fragment; the page sets Referrer-Policy
 *     no-referrer and has zero third-party resources. CSP locks it to
 *     inline-only (the route sets the matching headers too).
 */

export const AUTH_CALLBACK_PATH = '/auth/callback';
/** Where GoTrue redirects after /verify; also the page's own bounce target
 *  base. Keep in sync with deepLinkRouter's AUTH_URL_PREFIX. */
export const APP_DEEP_LINK = 'eventpulse://auth/callback';

export function renderAuthCallbackPage(): string {
  return `<!doctype html>
<html lang="sv">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>EventPulse — bekräftat</title>
<style>
  body { margin: 0; background: #000; color: #F7F2EA;
         font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         display: flex; min-height: 100vh; align-items: center; justify-content: center; }
  main { max-width: 420px; padding: 32px 24px; text-align: center; }
  h1 { font-size: 28px; font-weight: 800; margin: 0 0 16px; }
  p { color: #CFC9BC; font-size: 15px; line-height: 1.5; margin: 0 0 20px; }
  a.btn { display: inline-block; background: #F7F2EA; color: #1A1A1A;
          text-decoration: none; font-weight: 700; font-size: 15px;
          padding: 14px 28px; border-radius: 10px; }
  .fine { color: #8A8478; font-size: 12px; margin-top: 28px; }
</style>
</head>
<body>
<main>
  <h1 id="title">Klart!</h1>
  <p id="body">Din e-post är bekräftad — allt du sparat finns kvar i appen.</p>
  <p id="open-app"><a class="btn" id="open-btn" href="${APP_DEEP_LINK}">Öppna EventPulse-appen</a></p>
  <p class="fine" id="fine">Läser du det här på en dator? Öppna länken på telefonen där EventPulse är installerat.</p>
</main>
<script>
(function () {
  var DEEP_LINK_BASE = ${JSON.stringify(APP_DEEP_LINK)};
  var hash = window.location.hash || '';
  var query = window.location.search || '';
  var title = document.getElementById('title');
  var body = document.getElementById('body');
  var openApp = document.getElementById('open-app');
  var openBtn = document.getElementById('open-btn');
  var fine = document.getElementById('fine');

  var params = new URLSearchParams(query.slice(1));
  var errorDesc = params.get('error_description') || params.get('error');

  if (errorDesc) {
    // GoTrue bounced us back with an error (expired/consumed link etc).
    title.textContent = 'Länken fungerade inte';
    body.textContent = 'Den här länken är ogiltig eller har redan använts (' + errorDesc + '). Be om en ny länk i appen.';
    openApp.style.display = 'none';
    fine.textContent = '';
    return;
  }

  var hasTokens = hash.indexOf('access_token=') !== -1;
  if (!hasTokens) {
    // No tokens in the fragment: someone opened the bare page by hand.
    openApp.style.display = 'none';
    fine.textContent = '';
    return;
  }

  // Normal path: hand the tokens to the app, then leave the friendly page
  // behind for the case where no app claims the scheme (desktop mail etc).
  var deep = DEEP_LINK_BASE + hash;
  openBtn.setAttribute('href', deep);
  setTimeout(function () { window.location.replace(deep); }, 400);
})();
</script>
</body>
</html>`;
}
