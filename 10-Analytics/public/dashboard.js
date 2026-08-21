/**
 * dashboard.js — analytics admin dashboard client.
 *
 * Polls /api/stats (bearer) and /api/events (bearer) every 5s and
 * renders the overview + recent events log. GDPR export/erase use the
 * public endpoints.
 */

const TOKEN_KEY = 'analytics_token';

function getToken() {
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get('token');
  if (fromUrl) {
    try {
      localStorage.setItem(TOKEN_KEY, fromUrl);
    } catch {
      // localStorage might be blocked — proceed with in-memory token only.
    }
    return fromUrl;
  }
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

async function adminFetch(path) {
  const token = getToken();
  const r = await fetch(path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`${r.status} ${path}: ${body.slice(0, 120)}`);
  }
  return r.json();
}

function $(id) {
  return document.getElementById(id);
}

function fmtBytes(n) {
  if (typeof n !== 'number') return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function fmtRelative(iso) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'just now';
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return new Date(iso).toLocaleString();
}

function setConn(state, err) {
  const pill = $('conn');
  const label = $('conn-label');
  if (state === 'connected') {
    label.textContent = 'LIVE';
    pill.className = 'pill pill-connected';
    pill.title = 'polling /api/stats every 5s';
  } else if (state === 'connecting') {
    label.textContent = 'CONNECTING';
    pill.className = 'pill pill-disconnected';
    pill.title = 'connecting...';
  } else {
    label.textContent = 'NO CONNECTION';
    pill.className = 'pill pill-disconnected';
    pill.title = err || 'no connection';
  }
}

async function refreshStats() {
  const r = await adminFetch('/api/stats');
  const s = r.data || r;
  $('kpi-events').textContent = (s.events ?? 0).toLocaleString();
  $('kpi-bytes').textContent = fmtBytes(s.bytes ?? 0);
  $('kpi-retention').textContent = s.retention_days ?? '—';
  $('kpi-phase').textContent = s.phase ?? '—';
}

/**
 * T0097 — fetch and render top-strip KPIs.
 * Endpoint: GET /api/metrics/top-strip  (admin, bearer)
 * Returns: { dau, wau, mau, stickiness, save_rate, last_seen, window_events }
 */
async function refreshTopStrip() {
  const r = await adminFetch('/api/metrics/top-strip');
  const m = r.data || r;
  $('kpi-dau').textContent = (m.dau ?? 0).toLocaleString();
  $('kpi-wau').textContent = (m.wau ?? 0).toLocaleString();
  $('kpi-mau').textContent = (m.mau ?? 0).toLocaleString();
  $('kpi-stickiness').textContent = m.wau > 0
    ? `${((m.dau / m.wau) * 100).toFixed(0)}%`
    : '—';
  if (m.save_rate === null || m.save_rate === undefined) {
    $('kpi-save-rate').textContent = 'n/a';
  } else {
    $('kpi-save-rate').textContent = `${(m.save_rate * 100).toFixed(1)}%`;
  }
  $('kpi-last-seen').textContent = m.last_seen ? fmtRelative(m.last_seen) : '—';
}

/**
 * T0094 — fetch and render content affinity + quality guardrails.
 * Endpoint: GET /api/metrics/insights
 * Returns: { content_affinity: { top_categories: [{category, views, saves, save_rate}] },
 *            quality_guardrails: { ingestion_gap_minutes, dau_24h, dau_delta_pct, alerts: [{level, message}] } }
 */
async function refreshInsights() {
  const r = await adminFetch('/api/metrics/insights');
  const data = r.data || r;
  // Content affinity table
  const cats = data.content_affinity?.top_categories ?? [];
  const empty = $('content-affinity-empty');
  const table = $('affinity-table');
  const tbody = table.querySelector('tbody');
  tbody.innerHTML = '';
  if (cats.length === 0) {
    empty.style.display = '';
    table.style.display = 'none';
  } else {
    empty.style.display = 'none';
    table.style.display = '';
    for (const c of cats) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><code>${c.category}</code></td>
        <td class="num">${c.views.toLocaleString()}</td>
        <td class="num">${c.saves.toLocaleString()}</td>
        <td class="num">${c.save_rate === null ? 'n/a' : (c.save_rate * 100).toFixed(1) + '%'}</td>
      `;
      tbody.appendChild(tr);
    }
  }
  // Quality guardrails
  const gr = data.quality_guardrails ?? {};
  $('gr-gap').textContent = gr.ingestion_gap_minutes === null ? '—' : `${gr.ingestion_gap_minutes}m`;
  $('gr-dau').textContent = (gr.dau_24h ?? 0).toLocaleString();
  const delta = gr.dau_delta_pct;
  if (delta === null || delta === undefined) {
    $('gr-dau-delta').textContent = 'vs 7d avg —';
  } else {
    const sign = delta >= 0 ? '+' : '';
    $('gr-dau-delta').textContent = `vs 7d avg ${sign}${delta}%`;
  }
  $('gr-events').textContent = (gr.events_last_24h ?? 0).toLocaleString();
  const alertsEl = $('gr-alerts');
  alertsEl.innerHTML = '';
  for (const a of (gr.alerts ?? [])) {
    const div = document.createElement('div');
    div.className = `alert alert-${a.level}`;
    div.textContent = `[${a.level.toUpperCase()}] ${a.message}`;
    alertsEl.appendChild(div);
  }
}

async function refreshEvents() {
  const r = await adminFetch('/api/events?limit=50');
  const events = r.data || r.events || [];
  const tbody = $('events-table').querySelector('tbody');
  tbody.innerHTML = '';
  for (const ev of events.slice().reverse().slice(0, 25)) {
    const tr = document.createElement('tr');
    const payload = JSON.stringify(ev.payload || {});
    const truncated = payload.length > 80 ? payload.slice(0, 80) + '…' : payload;
    tr.innerHTML = `
      <td><code>${ev.event_type}</code></td>
      <td>${ev.page || '—'}</td>
      <td class="payload"><code>${truncated}</code></td>
      <td>${fmtRelative(ev.received_at || ev.ts)}</td>
    `;
    tbody.appendChild(tr);
  }
  if (events.length > 0) {
    const lastTs = events[events.length - 1].received_at || events[events.length - 1].ts;
    $('last-event').textContent = `last event ${fmtRelative(lastTs)}`;
  } else {
    $('last-event').textContent = 'no events yet';
  }
}

async function refreshAll() {
  const results = await Promise.allSettled([refreshStats(), refreshEvents(), refreshTopStrip(), refreshInsights()]);
  const first = results.find((r) => r.status === 'rejected');
  if (first) {
    const msg = first.reason?.message || String(first.reason);
    setConn('disconnected', msg);
    const errEl = $('last-error');
    if (errEl) errEl.textContent = msg;
    console.error('refresh failed', first.reason);
  } else {
    setConn('connected');
    const errEl = $('last-error');
    if (errEl) errEl.textContent = '';
  }
}

async function gdprExport() {
  const hash = $('gdpr-hash').value.trim();
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    $('gdpr-output').textContent = 'invalid device_id_hash';
    return;
  }
  try {
    const r = await fetch(`/api/gdpr/export?device_id_hash=${hash}`);
    const j = await r.json();
    $('gdpr-output').textContent = JSON.stringify(j, null, 2);
  } catch (err) {
    $('gdpr-output').textContent = String(err);
  }
}

async function gdprErase() {
  const hash = $('gdpr-hash').value.trim();
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    $('gdpr-output').textContent = 'invalid device_id_hash';
    return;
  }
  if (!confirm(`Erase all events for device ${hash.slice(0, 12)}…? This is irreversible.`)) {
    return;
  }
  try {
    const r = await fetch('/api/gdpr/erase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id_hash: hash }),
    });
    const j = await r.json();
    $('gdpr-output').textContent = JSON.stringify(j, null, 2);
    await refreshAll();
  } catch (err) {
    $('gdpr-output').textContent = String(err);
  }
}

async function gdprOptOut() {
  const hash = $('gdpr-hash').value.trim();
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    $('gdpr-output').textContent = 'invalid device_id_hash';
    return;
  }
  try {
    const r = await fetch('/api/gdpr/opt-out', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id_hash: hash }),
    });
    const j = await r.json();
    $('gdpr-output').textContent = JSON.stringify(j, null, 2);
  } catch (err) {
    $('gdpr-output').textContent = String(err);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const token = getToken();
  if (!token) {
    document.body.innerHTML = '<div style="padding:40px;font-family:system-ui">Missing token. Open this dashboard with <code>?token=&lt;bearer&gt;</code> in the URL.</div>';
    return;
  }
  setConn('connecting');
  $('gdpr-export').addEventListener('click', gdprExport);
  $('gdpr-erase').addEventListener('click', gdprErase);
  $('gdpr-opt-out').addEventListener('click', gdprOptOut);
  $('gdpr-hash').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') gdprExport();
  });
  refreshAll();
  setInterval(refreshAll, 5000);
});