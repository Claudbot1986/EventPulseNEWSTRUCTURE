/**
 * End-to-end dashboard verification.
 * Loads the real mobile-control dashboard in a headless browser, waits for
 * both SSE streams to populate, then asserts the rendered DOM against the
 * live /api/status payload. Also exercises disconnect -> reconnect and
 * checks that activity history survives the reconnect.
 */
import puppeteer from 'puppeteer';

const HOST = '100.64.107.37:8788';
const TOKEN = process.env.EP_TOKEN;
const URL = `http://${HOST}/?token=${TOKEN}`;

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 }); // iPhone-ish

const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
page.on('requestfailed', (req) => {
  consoleErrors.push(`requestfailed: ${req.url()} - ${req.failure()?.errorText}`);
});
page.on('response', (resp) => {
  if (resp.status() === 404) {
    consoleErrors.push(`404: ${resp.url()}`);
  }
});

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
// Give both EventSources time to connect and deliver history + first snapshot.
await new Promise((r) => setTimeout(r, 6000));

const snap = await (
  await fetch(`http://${HOST}/api/status`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  })
).json();

const dom = await page.evaluate(() => {
  const t = (id) => document.getElementById(id)?.textContent?.trim() ?? null;
  return {
    connection: t('connection-status'),
    lastEvent: t('last-event-time'),
    agentRows: [...document.querySelectorAll('#agent-list .agent-row')].map((r) => ({
      role: r.querySelector('.agent-role')?.textContent?.trim(),
      task: r.querySelector('.agent-task')?.textContent?.trim(),
    })),
    iterNum: t('iter-num'),
    iterTurns: t('iter-turns'),
    iterCost: t('iter-cost'),
    timelineCount: document.querySelectorAll('#activity-list .timeline-item').length,
    timelineTop: [...document.querySelectorAll('#activity-list .timeline-item')]
      .slice(0, 3)
      .map((li) => li.querySelector('.timeline-type')?.textContent?.trim()),
    activityCount: t('activity-count'),
    wrapperStatus: t('wrapper-status'),
    wrapperIteration: t('wrapper-iteration'),
    tmuxStatus: t('tmux-status'),
    terminalLen: document.getElementById('terminal-pane')?.textContent?.length ?? 0,
    terminalHead: document.getElementById('terminal-pane')?.textContent?.slice(0, 120),
    taskCount: document.querySelectorAll('#task-list .task-item').length,
    commitCount: document.querySelectorAll('#commit-list .commit-item').length,
  };
});

console.log('\n--- rendered DOM ---');
console.log(JSON.stringify(dom, null, 1));
console.log('--- live snapshot ---');
console.log(
  JSON.stringify(
    {
      wrapper_status: snap.wrapper?.status,
      wrapper_iteration: snap.wrapper?.iteration,
      agents: snap.agents,
      last_iter_summary: snap.last_iter_summary,
      last_event_at: snap.last_event_at,
      commits: snap.recent_commits?.length,
    },
    null,
    1
  )
);
console.log('\n--- checks ---');

check('1. connection pill shows LIVE', /LIVE/i.test(dom.connection || ''), dom.connection);
check('2. last-event timestamp rendered', /ago|just now/.test(dom.lastEvent || ''), dom.lastEvent);
check(
  '3. NOW shows lead/work/vault-sync rows',
  dom.agentRows.map((r) => r.role).join(',') === 'lead,work,vault-sync',
  dom.agentRows.map((r) => `${r.role}=${r.task}`).join(' | ')
);
check(
  '4. iter meta matches live snapshot',
  String(snap.last_iter_summary?.iter ?? '—') === dom.iterNum,
  `dom=${dom.iterNum} api=${snap.last_iter_summary?.iter}`
);
check('5. activity timeline populated', dom.timelineCount > 0, `${dom.timelineCount} items`);
check(
  '6. timeline shows real event types',
  dom.timelineTop.every((t) => t && t.length > 0),
  dom.timelineTop.join(', ')
);
check(
  '7. wrapper status matches API',
  dom.wrapperStatus === snap.wrapper?.status,
  `dom=${dom.wrapperStatus} api=${snap.wrapper?.status}`
);
check(
  '8. wrapper iteration matches API',
  dom.wrapperIteration === String(snap.wrapper?.iteration),
  `dom=${dom.wrapperIteration} api=${snap.wrapper?.iteration}`
);
check('9. Terminal Live has tmux content', dom.terminalLen > 40, `${dom.terminalLen} chars: ${JSON.stringify(dom.terminalHead)}`);
check('10. tmux pill shows running', /running/i.test(dom.tmuxStatus || ''), dom.tmuxStatus);
check('11. commits rendered', dom.commitCount > 0, `${dom.commitCount} commits`);

// --- live push: trigger a real event, assert it appears without reload -----
const beforeCount = dom.timelineCount;
const beforeDetail = await page.evaluate(() =>
  [...document.querySelectorAll('#activity-list .timeline-item .timeline-detail')].map((d) => d.textContent.trim())
);
// Unique probe so we can never collide with prior runs that left the same
// phrase in the append-only activity.jsonl.
const probeToken = `live-push-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
await fetch(`http://${HOST}/api/instruct`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: `headless dashboard ${probeToken}` }),
});
await new Promise((r) => setTimeout(r, 5000));
const afterPush = await page.evaluate(() => ({
  count: document.querySelectorAll('#activity-list .timeline-item').length,
  details: [...document.querySelectorAll('#activity-list .timeline-item .timeline-detail')].map((d) => d.textContent.trim()),
  reloads: performance.getEntriesByType('navigation').length,
}));
// Server emits `user_instruction_received` (detail = message preview) then
// `instruction_queued` (detail = file path). Either, when present anywhere in
// the rendered timeline, proves the live push worked. The cache is capped at
// ACTIVITY_CACHE_MAX=100, so a `count > beforeCount` check is unreliable
// once history is already full — assert presence of the unique probe instead.
const probeVisible = afterPush.details.some((d) => d && d.includes(probeToken));
const probeInHistory = beforeDetail.some((d) => d && d.includes(probeToken));
check(
  '12. new event pushed without page reload',
  probeVisible && !probeInHistory,
  `before=${beforeCount} after=${afterPush.count} probeVisible=${probeVisible} token=${probeToken}`
);
check('13. no page reload occurred', afterPush.reloads === 1, `${afterPush.reloads} navigation(s)`);

// --- disconnect / reconnect ------------------------------------------------
await page.setOfflineMode(true);
await new Promise((r) => setTimeout(r, 6000));
const offline = await page.evaluate(() => document.getElementById('connection-status')?.textContent?.trim());
check('14. offline flips pill to DISCONNECTED', /DISCONNECTED/i.test(offline || ''), offline);

await page.setOfflineMode(false);
// Generous wait — EventSource has to detect the network is back, re-establish
// the TCP connection, re-do the HTTP handshake, and emit onopen before the
// pill flips to LIVE. On a flaky LAN this can take a few seconds.
await new Promise((r) => setTimeout(r, 15000));
const online = await page.evaluate(() => ({
  pill: document.getElementById('connection-status')?.textContent?.trim(),
  count: document.querySelectorAll('#activity-list .timeline-item').length,
}));
check('15. reconnect restores LIVE', /LIVE/i.test(online.pill || ''), online.pill);
check(
  '16. history survives reconnect',
  online.count >= afterPush.count,
  `${afterPush.count} -> ${online.count} items`
);

// Count only real console errors. Browser noise that we explicitly allow:
//   - favicon.ico 404s (no favicon is configured)
//   - ERR_INTERNET_DISCONNECTED, triggered deliberately by setOfflineMode(true)
//   - requestfailed entries for /api/* during the offline phase
//   - the browser's bare "Failed to load resource: ... 404" message that pairs
//     with the favicon (the URL is captured separately via the response handler,
//     so we know it's just favicon)
//   - setOfflineMode(true) abruptly terminates in-flight chunked SSE responses,
//     which Chromium flags as ERR_INCOMPLETE_CHUNKED_ENCODING. The SSE auto-
//     reconnects when the network comes back; this is expected browser noise.
const seenFavicon = consoleErrors.some((e) => /favicon\.ico/.test(e));
const realConsoleErrors = consoleErrors.filter((e) => {
  if (/favicon/i.test(e)) return false;
  if (/ERR_INTERNET_DISCONNECTED/.test(e)) return false;
  if (/requestfailed:.*ERR_INTERNET_DISCONNECTED/.test(e)) return false;
  if (seenFavicon && /Failed to load resource.*404/.test(e)) return false;
  if (/ERR_INCOMPLETE_CHUNKED_ENCODING/.test(e)) return false;
  return true;
});
check(
  '17. no unexpected console errors (favicon/offline filtered)',
  realConsoleErrors.length === 0,
  realConsoleErrors.slice(0, 3).join(' ; ')
);
check(
  '17b. unexpected console errors only',
  realConsoleErrors.length === 0,
  realConsoleErrors.slice(0, 3).join(' ; ')
);

await page.screenshot({ path: '/tmp/ep-dashboard.png', fullPage: true });
await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===`);
if (failed.length) {
  console.log('FAILED: ' + failed.map((f) => f.name).join(', '));
  process.exit(1);
}
