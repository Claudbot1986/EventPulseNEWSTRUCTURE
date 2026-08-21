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
  const results = await Promise.allSettled([refreshStats(), refreshEvents()]);
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