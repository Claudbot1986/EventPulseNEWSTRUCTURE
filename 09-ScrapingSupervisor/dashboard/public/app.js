/**
 * Tiny client for the supervisor dashboard — fetch /api/status, populate DOM.
 * No frameworks. Runs once per page load (page auto-refreshes via meta tag).
 */

(async () => {
  try {
    const res = await fetch('/api/status', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    document.getElementById('last-run').textContent =
      data.lastRunIso ? new Date(data.lastRunIso).toLocaleString() : 'never';
    document.getElementById('next-run').textContent =
      new Date(data.nextRunAt).toLocaleString();

    document.getElementById('working').textContent = data.sources.working;
    document.getElementById('dead').textContent = data.sources.dead;
    document.getElementById('untouched').textContent = data.sources.untouched;
    document.getElementById('total').textContent = data.sources.total;

    // KPI strip (Project-level — DB + Tool A summary)
    const k = data.kpis || {};
    const kpiCell = (id, value, suffix) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (value === null || value === undefined) {
        el.textContent = 'n/a';
        el.classList.add('muted');
      } else {
        el.textContent = suffix ? value.toLocaleString() + suffix : value.toLocaleString();
        el.classList.remove('muted');
      }
    };
    kpiCell('kpi-future', k.totalFutureEvents);
    kpiCell('kpi-next7', k.eventsNext7d);
    kpiCell('kpi-active-sources', k.activeSources7d);
    kpiCell('kpi-total-rows', k.totalEventRows);
    {
      const el = document.getElementById('kpi-last-toola');
      if (el) {
        if (k.lastToolASuccessIso) {
          const d = new Date(k.lastToolASuccessIso);
          el.textContent = d.toLocaleString();
          const ageH = (Date.now() - d.getTime()) / 3600000;
          el.classList.toggle('ok', ageH <= 24);
          el.classList.toggle('warn', ageH > 24 && ageH <= 168);
          el.classList.toggle('bad', ageH > 168);
        } else {
          el.textContent = 'n/a';
          el.classList.add('muted');
        }
      }
    }

    // Sources (DB-fed) — full list with adapter badge + search/filter
    renderDbSources(data.dbSources || []);

    document.getElementById('applied-today').textContent = data.appliedToday;
    const recent = document.getElementById('applied-recent');
    if (data.appliedRecent.length === 0) {
      recent.innerHTML = '<li class="empty">no recent entries</li>';
    } else {
      recent.innerHTML = data.appliedRecent
        .map((r) => `<li><code>${r.sourceId}</code> — ${(r.reason ?? '').slice(0, 60)}</li>`)
        .join('');
    }

    const driftBody = document.getElementById('drift-body');
    if (data.schemaDrift.length === 0) {
      driftBody.innerHTML = '<tr><td colspan="2" class="empty">no patterns detected</td></tr>';
    } else {
      driftBody.innerHTML = data.schemaDrift
        .map((d) => `<tr><td>${d.reason}</td><td>${d.count}</td></tr>`)
        .join('');
    }

    const deadBody = document.getElementById('dead-body');
    if (data.topDead.length === 0) {
      deadBody.innerHTML = '<tr><td colspan="3" class="empty">none</td></tr>';
    } else {
      deadBody.innerHTML = data.topDead
        .map((d) => `<tr><td><code>${d.sourceId}</code></td><td>${d.cf}</td><td>${d.reason}</td></tr>`)
        .join('');
    }

    const untouchedBody = document.getElementById('untouched-body');
    if (data.topUntouched.length === 0) {
      untouchedBody.innerHTML = '<tr><td colspan="3" class="empty">none</td></tr>';
    } else {
      untouchedBody.innerHTML = data.topUntouched
        .map((u) => `<tr><td><code>${u.sourceId}</code></td><td>${u.cf}</td><td>${u.reason}</td></tr>`)
        .join('');
    }

    const suggested = document.getElementById('suggested-list');
    if (data.suggestedActions.length === 0) {
      suggested.innerHTML = '<li class="empty">queue empty</li>';
    } else {
      suggested.innerHTML = data.suggestedActions
        .map((s) => `<li><span class="badge warn">${s.kind}</span> <code>${s.sourceId}</code> — ${(s.rationale ?? '').slice(0, 80)}</li>`)
        .join('');
    }

    if (data.vaultNotePath) {
      const link = document.getElementById('vault-link');
      link.href = 'file://' + data.vaultNotePath;
      link.textContent = data.vaultNotePath.split('/').pop();
    } else {
      document.getElementById('vault-link-li').style.display = 'none';
    }

    // Freshness
    const freshVal = document.getElementById('freshness-value');
    if (data.freshnessMedianHours === null || data.freshnessMedianHours === undefined) {
      freshVal.textContent = 'n/a';
      freshVal.classList.add('muted');
    } else {
      const h = data.freshnessMedianHours;
      freshVal.textContent = h < 24 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} d`;
      freshVal.classList.toggle('bad', h > 72);
      freshVal.classList.toggle('warn', h > 24 && h <= 72);
      freshVal.classList.toggle('ok', h <= 24);
    }

    // Field coverage bars
    const bars = document.getElementById('coverage-bars');
    if (data.fieldCoverage && data.metricsHistory) {
      const fc = data.fieldCoverage;
      bars.innerHTML = ['title', 'date', 'venue', 'description']
        .map((k) => {
          const pct = Math.round((fc[k] ?? 0) * 100);
          const tone = pct >= 80 ? 'ok' : pct >= 50 ? 'warn' : 'bad';
          return `<li><span class="bar-label">${k}</span>
            <div class="bar-track"><div class="bar-fill ${tone}" style="width:${pct}%"></div></div>
            <span class="bar-value">${pct}%</span></li>`;
        })
        .join('');
    }

    // Batch success
    document.getElementById('batches-attempts').textContent = data.batchMetrics.attempts;
    document.getElementById('batches-transport').textContent = data.batchMetrics.transportOk;
    document.getElementById('batches-data').textContent = data.batchMetrics.dataOk;
    document.getElementById('batches-decoy').textContent = data.batchMetrics.decoy;

    // Sparklines
    const hist = data.metricsHistory ?? [];
    if (hist.length > 0) {
      renderSparkline('spark-freshness', hist.map((s) => s.freshnessMedianHours), { invert: true, maxY: 168 });
      renderSparkline('spark-coverage-title', hist.map((s) => s.fieldCoverage.title), { minY: 0, maxY: 1 });
      renderSparkline('spark-coverage-date', hist.map((s) => s.fieldCoverage.date), { minY: 0, maxY: 1 });
      renderSparkline(
        'spark-batches',
        hist.map((s) => s.batches.attempts ? s.batches.success / s.batches.attempts : null),
        { minY: 0, maxY: 1 }
      );
    } else {
      ['spark-freshness', 'spark-coverage-title', 'spark-coverage-date', 'spark-batches'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '<span class="muted">no history yet (1 entry/day)</span>';
      });
    }

    document.getElementById('generated-at').textContent = new Date(data.generatedAt).toLocaleString();

    // ── Time-series charts (Phase 3) ───────────────────────────────────────
    window.__chartData = data;
    renderAllCharts(data);
    setupChartToggles();
    setupChartHovers();

    // ── Per-layer extraction tiles (Phase 4) ─────────────────────────────
    renderLayers(data.layers || {});

    // ── Live state tiles (Phase 5) — BullMQ + 08-Agent ───────────────────
    renderLiveTiles(data);

    // ── Extraction overview (Task 3a) ──────────────────────────────────
    renderExtractionOverview(data.extractionOverview || null);

    // ── Unsynced vs Supabase (Task 3b) ─────────────────────────────────
    renderUnsynced(data.unsynced || null);
  } catch (err) {
    document.querySelector('main').innerHTML =
      `<div class="card"><h2>Error</h2><p>Failed to fetch /api/status: ${String(err)}</p></div>`;
  }

  // ── Source Health (Phase 1 — independent fetch so /api/status failure
  //    doesn't take this card down). Fails silently to a muted empty state.
  try {
    const shRes = await fetch('/api/source-health', { cache: 'no-store' });
    if (!shRes.ok) throw new Error(`HTTP ${shRes.status}`);
    const shData = await shRes.json();
    initSourceHealth(shData);
  } catch (err) {
    const body = document.getElementById('sh-tbody');
    if (body) body.innerHTML = `<tr><td colspan="8" class="empty">unavailable: ${escapeHtml(String(err))}</td></tr>`;
    const ec = document.getElementById('sh-errorcats');
    if (ec) ec.innerHTML = '';
  }
})();

/** Minimal HTML escaper for DB-fed source names rendered into innerHTML. */
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// ─── DB-fed sources list (scrollable, filterable, adapter badge) ───────────

/** Module-level state for the DB-fed sources card. Held so that filter /
 *  search input changes can re-render without a full page refresh. */
const dbSourcesState = { rows: [], filter: 'all', search: '' };

/**
 * Render the full list of DB-fed sources with filter + search.
 *
 * Reads `dbSourcesState` and re-renders the rows that match. The toolbar
 * (search input + filter buttons) is wired once by `wireDbSourcesToolbar`;
 * subsequent renderings just re-paint the list rows and the count badges.
 *
 * Filter semantics:
 *   - all:    every row
 *   - adapter: rows whose hasAdapter === true (site-specific adapter exists)
 *   - generic: rows whose hasAdapter === false (generic C-layer path)
 * Search: case-insensitive substring match against the source id.
 */
function renderDbSourcesList() {
  const el = document.getElementById('db-sources-list');
  if (!el) return;
  const { rows, filter, search } = dbSourcesState;
  const needle = search.trim().toLowerCase();
  const filtered = rows.filter((r) => {
    if (filter === 'adapter' && !r.hasAdapter) return false;
    if (filter === 'generic' && r.hasAdapter) return false;
    if (needle && !r.source.toLowerCase().includes(needle)) return false;
    return true;
  });
  if (filtered.length === 0) {
    el.innerHTML = '<span class="empty muted">no sources match current filter</span>';
  } else {
    el.innerHTML = filtered.map((r) => {
      const freshClass = r.fresh7d > 0 ? 'fresh' : 'zero';
      const badge = r.hasAdapter
        ? '<span class="src-badge adapter" title="site-specific adapter at 02-Ingestion/F-eventExtraction/adapters/' + escapeHtml(r.source) + '.ts">adapter</span>'
        : '<span class="src-badge generic" title="generic C-layer / universal-extractor">generic</span>';
      return '<div class="db-source-row">' +
        badge +
        '<span class="src-name" title="' + escapeHtml(r.source) + '">' + escapeHtml(r.source) + '</span>' +
        '<span class="num ' + freshClass + '">' + r.fresh7d + '</span>' +
        '<span class="num">' + r.events + '</span>' +
      '</div>';
    }).join('');
  }
  // Update count badges (always reflect totals, not filtered count).
  const total = rows.length;
  const adapter = rows.filter((r) => r.hasAdapter).length;
  const generic = total - adapter;
  const setCount = (id, n) => {
    const c = document.getElementById(id);
    if (c) c.textContent = String(n);
  };
  setCount('db-sources-count-all', total);
  setCount('db-sources-count-adapter', adapter);
  setCount('db-sources-count-generic', generic);
}

/** One-time wiring of toolbar events. Called once per page load. */
function wireDbSourcesToolbar() {
  const search = document.getElementById('db-sources-search');
  if (search) {
    search.addEventListener('input', (e) => {
      dbSourcesState.search = (e.target.value || '');
      renderDbSourcesList();
    });
  }
  const filters = document.querySelectorAll('.db-sources-filters button');
  filters.forEach((btn) => {
    btn.addEventListener('click', () => {
      const f = btn.getAttribute('data-filter');
      if (!f) return;
      dbSourcesState.filter = f;
      filters.forEach((b) => b.classList.toggle('active', b === btn));
      renderDbSourcesList();
    });
  });
  // Full-page toggle: expands #db-sources to span the whole dashboard and
  // removes the inner scroll cap. Click again to collapse. The toggle is
  // wired once — state lives on the DOM via aria-pressed + a class so a
  // page meta-refresh resets it back to the default compact view.
  const expand = document.getElementById('db-sources-expand');
  if (expand && !expand.dataset.wired) {
    expand.dataset.wired = '1';
    expand.addEventListener('click', () => {
      const card = document.getElementById('db-sources');
      if (!card) return;
      const on = !card.classList.contains('db-sources-fullpage');
      card.classList.toggle('db-sources-fullpage', on);
      expand.setAttribute('aria-pressed', on ? 'true' : 'false');
      const labelEl = expand.querySelector('.db-sources-expand-label');
      const iconEl = expand.querySelector('.db-sources-expand-icon');
      if (labelEl) labelEl.textContent = on ? 'Collapse' : 'Full page';
      if (iconEl) iconEl.textContent = on ? '⤡' : '⤢';
      expand.title = on
        ? 'Collapse back to default layout'
        : 'Expand the sources list to full page width and remove the inner scroll cap';
    });
  }
}

/** Entry point called by the IIFE on each /api/status response. */
function renderDbSources(rows) {
  dbSourcesState.rows = rows;
  // First call also wires the toolbar (idempotent — guards not needed since
  // we replace innerHTML on the list, but button handlers survive).
  wireDbSourcesToolbar();
  renderDbSourcesList();
}

/**
 * Render an inline SVG sparkline. Nulls in `values` are skipped (gaps).
 * Options: invert (lower=better, line drawn red when high); minY/maxY clamp.
 */
function renderSparkline(elId, values, opts) {
  const el = document.getElementById(elId);
  if (!el) return;
  const W = 220, H = 36, P = 3;
  const o = opts || {};
  const minY = o.minY ?? Math.min(...values.filter((v) => v !== null));
  const maxY = o.maxY ?? Math.max(...values.filter((v) => v !== null));
  const range = maxY - minY || 1;
  const n = values.length;
  const stepX = n > 1 ? (W - 2 * P) / (n - 1) : 0;
  const points = [];
  let lastIdx = -1;
  values.forEach((v, i) => {
    if (v === null || v === undefined || Number.isNaN(v)) return;
    const x = P + i * stepX;
    const y = H - P - ((v - minY) / range) * (H - 2 * P);
    points.push({ x, y, v, i });
    lastIdx = i;
  });
  if (points.length === 0) {
    el.innerHTML = '<span class="muted">no data</span>';
    return;
  }
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  const color = o.invert
    ? (last.v > (maxY * 0.5) ? 'var(--bad)' : last.v > (maxY * 0.25) ? 'var(--warn)' : 'var(--ok)')
    : (last.v > (maxY * 0.66) ? 'var(--ok)' : last.v > (maxY * 0.33) ? 'var(--warn)' : 'var(--bad)');
  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none">
      <path d="${path}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="2" fill="${color}"/>
    </svg>`;
}

// ── Time-series charts (Phase 3) ───────────────────────────────────────────

function bucketize(rows, bucket) {
  if (bucket === 'day' || !bucket) return rows.map((r) => ({ ...r }));
  const groups = new Map();
  for (const r of rows) {
    let key;
    if (bucket === 'week') {
      const d = new Date(r.date + 'T00:00:00Z');
      const dow = d.getUTCDay();
      const offset = dow === 0 ? -6 : 1 - dow;
      d.setUTCDate(d.getUTCDate() + offset);
      key = d.toISOString().slice(0, 10);
    } else {
      key = r.date.slice(0, 7) + '-01';
    }
    if (!groups.has(key)) groups.set(key, { date: key, value: 0 });
    groups.get(key).value += r.value;
  }
  return [...groups.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function loadRes(chartId) {
  try { return localStorage.getItem(`chart.${chartId}`) || 'day'; }
  catch { return 'day'; }
}
function saveRes(chartId, res) {
  try { localStorage.setItem(`chart.${chartId}`, res); } catch { /* ignore */ }
}

function formatTick(v) {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1000000) return (v / 1000000).toFixed(1) + 'M';
  if (a >= 1000) return (v / 1000).toFixed(a >= 10000 ? 0 : 1) + 'k';
  if (v < 1 && v > 0) return v.toFixed(2);
  return Math.round(v).toString();
}

function renderTimeChart(chartId, series) {
  const body = document.getElementById(`${chartId}-body`);
  const hint = document.getElementById(`${chartId}-hint`);
  if (!body) return;
  const W = 520, H = 160, PL = 40, PR = 14, PT = 10, PB = 22;
  const innerW = W - PL - PR, innerH = H - PT - PB;
  const resolution = loadRes(chartId);

  const bucketed = series.map((s) => ({
    name: s.name, color: s.color,
    rows: bucketize(s.rows || [], resolution),
  }));
  const dates = bucketed.reduce((acc, s) => (s.rows.length > acc.length ? s.rows : acc), []);
  if (dates.length === 0) {
    body.innerHTML = '<span class="muted">no data</span>';
    if (hint) hint.textContent = '';
    return;
  }
  let maxV = 0, minV = Infinity;
  for (const s of bucketed) for (const r of s.rows) {
    if (r.value > maxV) maxV = r.value;
    if (r.value < minV) minV = r.value;
  }
  if (minV === Infinity) minV = 0;
  if (maxV === minV) maxV = minV + 1;
  const range = maxV - minV;
  const stepX = dates.length > 1 ? innerW / (dates.length - 1) : 0;
  const xOf = (i) => (dates.length > 1 ? PL + i * stepX : PL + innerW / 2);

  const parts = [`<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="time-chart">`];
  for (let g = 0; g <= 3; g++) {
    const y = PT + (g / 3) * innerH;
    parts.push(`<line x1="${PL}" y1="${y.toFixed(1)}" x2="${W - PR}" y2="${y.toFixed(1)}" stroke="#30363d" stroke-width="0.5" stroke-dasharray="2,3"/>`);
    const v = maxV - (g / 3) * range;
    parts.push(`<text x="${PL - 5}" y="${(y + 3).toFixed(1)}" text-anchor="end" fill="#8b949e" font-size="9">${formatTick(v)}</text>`);
  }
  const idxs = dates.length === 1 ? [0] : [0, Math.floor((dates.length - 1) / 2), dates.length - 1];
  for (const i of idxs) {
    const label = resolution === 'month' ? dates[i].date.slice(0, 7) : dates[i].date.slice(5);
    parts.push(`<text x="${xOf(i).toFixed(1)}" y="${H - 6}" text-anchor="middle" fill="#8b949e" font-size="9">${label}</text>`);
  }
  for (const s of bucketed) {
    const pts = s.rows.map((r, i) => ({
      x: xOf(i),
      y: PT + innerH - ((r.value - minV) / range) * innerH,
      v: r.value,
      date: r.date,
    }));
    const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    parts.push(`<path d="${path}" fill="none" stroke="${s.color}" stroke-width="1.5" stroke-linejoin="round"/>`);
    for (const p of pts) {
      parts.push(`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.5" fill="${s.color}"/>`);
      parts.push(`<rect x="${(p.x - 8).toFixed(1)}" y="${PT}" width="16" height="${innerH}" fill="transparent" data-chart="${chartId}" data-date="${p.date}" data-value="${p.v}" data-series="${s.name}" class="hover-zone"/>`);
    }
  }
  parts.push('</svg>');
  body.innerHTML = parts.join('');

  if (hint) {
    if (dates.length <= 3) hint.textContent = `Only ${dates.length} ${resolution}${dates.length === 1 ? '' : 's'} of data — daily resolution recommended.`;
    else hint.textContent = `${dates.length} ${resolution}s · toggle above to re-bucket`;
  }
}

function redrawChart(chartId, data) {
  if (!data) data = window.__chartData;
  if (!data) return;
  const ts = data.timeSeries || {};
  const ta = data.toolATimeSeries || {};
  switch (chartId) {
    case 'chart-events-ingested':
      renderTimeChart(chartId, [{ name: 'events', color: '#58a6ff', rows: ts.eventsIngested || [] }]);
      break;
    case 'chart-active-sources':
      renderTimeChart(chartId, [{ name: 'active sources', color: '#3fb950', rows: ts.activeSources || [] }]);
      break;
    case 'chart-toola-attempts':
      renderTimeChart(chartId, [
        { name: 'success', color: '#3fb950', rows: (ta.attemptsPerDay || []).map((r) => ({ date: r.date, value: r.success })) },
        { name: 'fail',    color: '#f85149', rows: (ta.attemptsPerDay || []).map((r) => ({ date: r.date, value: r.fail })) },
      ]);
      break;
    case 'chart-toola-working':
      renderTimeChart(chartId, [{ name: 'working sources', color: '#58a6ff', rows: ta.workingPerDay || [] }]);
      break;
    case 'chart-batch-rate':
      renderTimeChart(chartId, [{ name: 'batch success rate', color: '#f0883e', rows: (data.batchTimeSeries || []).map((r) => ({ date: r.date, value: r.rate })) }]);
      break;
  }
}

function renderAllCharts(data) {
  ['chart-events-ingested', 'chart-active-sources', 'chart-toola-attempts', 'chart-toola-working', 'chart-batch-rate']
    .forEach((id) => redrawChart(id, data));
}

let _tooltipEl = null;
function ensureTooltip() {
  if (_tooltipEl) return _tooltipEl;
  _tooltipEl = document.createElement('div');
  _tooltipEl.className = 'chart-tooltip';
  document.body.appendChild(_tooltipEl);
  return _tooltipEl;
}
function setupChartHovers() {
  const tip = ensureTooltip();
  document.body.addEventListener('mouseover', (ev) => {
    const z = ev.target.closest('.hover-zone');
    if (!z) return;
    tip.innerHTML = `<strong>${escapeHtml(z.dataset.series)}</strong><br>${z.dataset.date}<br>${Number(z.dataset.value).toLocaleString()}`;
    tip.style.display = 'block';
  });
  document.body.addEventListener('mousemove', (ev) => {
    if (tip.style.display === 'none' || !tip.style.display) return;
    tip.style.left = (ev.clientX + 12) + 'px';
    tip.style.top  = (ev.clientY + 12) + 'px';
  });
  document.body.addEventListener('mouseout', (ev) => {
    const z = ev.target.closest('.hover-zone');
    if (z) tip.style.display = 'none';
  });
}
function setupChartToggles() {
  document.body.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.resolution-toggle button');
    if (!btn) return;
    const tog = btn.parentElement;
    const chartId = tog.dataset.chart;
    saveRes(chartId, btn.dataset.res);
    tog.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
    redrawChart(chartId);
  });
}

// ── Per-layer extraction tiles (Phase 4) ──────────────────────────────────

function setText(id, val, suffix = '') {
  const el = document.getElementById(id);
  if (!el) return;
  if (val === null || val === undefined) {
    el.textContent = '—';
    el.classList.add('muted');
  } else {
    el.textContent = (typeof val === 'number' ? val.toLocaleString() : String(val)) + suffix;
    el.classList.remove('muted');
  }
}

function renderLayers(L) {
  // Tool A
  if (L.A) {
    setText('layer-A-working', L.A.working);
    setText('layer-A-dead', L.A.dead);
    setText('layer-A-total', L.A.total);
    document.getElementById('layer-A-dead').classList.toggle('bad', L.A.dead > 0);
    document.getElementById('layer-A-working').classList.toggle('ok', L.A.working > 0);
  }
  // Tool B
  if (L.B) {
    setText('layer-B-depth', L.B.queueDepth);
    setText('layer-B-note', L.B.note);
    document.getElementById('layer-B-depth').classList.toggle('muted', L.B.queueDepth === 0);
  }
  // Tool C
  if (L.C) {
    setText('layer-C-total', L.C.batchesTotal);
    const lastEl = document.getElementById('layer-C-last');
    if (lastEl) {
      lastEl.textContent = L.C.lastBatch ?? '—';
      lastEl.classList.toggle('muted', !L.C.lastBatch);
    }
    const noteEl = document.getElementById('layer-C-note');
    if (noteEl) {
      const parts = [];
      for (const [s, n] of Object.entries(L.C.byStatus)) parts.push(`${n} ${s}`);
      noteEl.textContent = parts.join(', ') || 'no batches';
    }
  }
  // Tool D
  if (L.D) {
    setText('layer-D-pending', L.D.pendingCount);
    setText('layer-D-note', L.D.note);
    document.getElementById('layer-D-pending').classList.toggle('warn', L.D.pendingCount > 0);
  }
  // Tool F
  if (L.F) {
    setText('layer-F-sources', L.F.sourceCount);
    setText('layer-F-events', L.F.eventsTotalApprox);
    document.getElementById('layer-F-sources').classList.toggle('ok', L.F.sourceCount > 0);
  }
  // Tool G
  if (L.G) {
    setText('layer-G-status', L.G.available ? 'yes' : 'no');
    setText('layer-G-note', L.G.note);
    document.getElementById('layer-G-status').classList.toggle('ok', L.G.available);
  }
  // Tool H
  if (L.H) {
    setText('layer-H-backlog', L.H.backlogSize);
    setText('layer-H-note', L.H.note);
    document.getElementById('layer-H-backlog').classList.toggle('warn', L.H.backlogSize > 0);
  }
  // Tool AI
  if (L.AI) {
    setText('layer-AI-logs', L.AI.logFilesTotal);
    setText('layer-AI-latest', L.AI.callsLatest);
    const noteEl = document.getElementById('layer-AI-note');
    if (noteEl && L.AI.latestIso) {
      const d = new Date(L.AI.latestIso);
      const ageH = (Date.now() - d.getTime()) / 3600000;
      noteEl.textContent = `latest: ${d.toLocaleDateString()} (${Math.round(ageH / 24)}d ago)`;
      noteEl.classList.toggle('bad', ageH > 168);
    } else if (noteEl) {
      noteEl.textContent = 'no AI calls logged';
    }
  }
  // Push
  if (L.Push) {
    setText('layer-Push-total', L.Push.totalJobs);
    setText('layer-Push-7d', L.Push.last7dJobs);
    const topEl = document.getElementById('layer-Push-top');
    if (topEl) {
      if (!L.Push.topSources || L.Push.topSources.length === 0) {
        topEl.textContent = 'no top sources';
      } else {
        const max = L.Push.topSources[0]?.count || 1;
        topEl.innerHTML = L.Push.topSources.map((s) => {
          const w = Math.max(8, Math.round((s.count / max) * 90));
          return `<div>${escapeHtml(s.sourceId)} <span style="color:var(--accent)">${s.count}</span></div>`;
        }).join('');
      }
    }
  }
}

// ── Live state tiles (Phase 5) — BullMQ + 08-Agent ────────────────────────

function renderLiveTiles(data) {
  // ── BullMQ queues (Redis-backed worker state) ──
  const bmq = data.bullmq || {};
  const statusEl = document.getElementById('bullmq-status');
  const rowsEl = document.getElementById('bullmq-rows');
  if (statusEl) {
    if (bmq.ok) {
      statusEl.textContent = 'ok';
      statusEl.classList.remove('muted', 'bad');
      statusEl.classList.add('ok');
    } else {
      statusEl.textContent = 'down';
      statusEl.classList.remove('muted', 'ok');
      statusEl.classList.add('bad');
    }
  }
  if (rowsEl) {
    const queues = ['raw_events', 'ingestion_smoke', 'search_sync'];
    const present = queues.filter((q) => bmq[q] !== undefined);
    if (!bmq.ok || present.length === 0) {
      rowsEl.innerHTML = `<div class="layer-note">${escapeHtml(bmq.error || 'no queue data')}</div>`;
    } else {
      rowsEl.innerHTML = present.map((q) => {
        const c = bmq[q] || {};
        const w = c.waiting ?? 0, a = c.active ?? 0, done = c.completed ?? 0, fail = c.failed ?? 0;
        // Highlight: big backlog in waiting is warn, lots of failed is bad.
        const waitingTone = w > 1000 ? 'warn' : w > 0 ? '' : 'muted';
        const failedTone = fail > 0 ? 'bad' : 'muted';
        return `<div style="display:grid;grid-template-columns:1fr auto auto auto auto;gap:6px;padding:3px 0;border-top:1px solid var(--border);font-size:11px;font-family:ui-monospace,monospace;">
          <span style="color:var(--accent)">${escapeHtml(q)}</span>
          <span class="${waitingTone}" title="waiting">w ${w.toLocaleString()}</span>
          <span title="active">a ${a.toLocaleString()}</span>
          <span title="completed" style="color:var(--ok)">✓ ${done.toLocaleString()}</span>
          <span class="${failedTone}" title="failed">✗ ${fail.toLocaleString()}</span>
        </div>`;
      }).join('');
    }
  }

  // ── 08-Agent metrics (proxied from :8787) ──
  const ag = data.agent || {};
  const aStatus = document.getElementById('agent-status');
  if (aStatus) {
    if (ag.ok) {
      aStatus.textContent = 'ok';
      aStatus.classList.remove('muted', 'bad');
      aStatus.classList.add('ok');
    } else {
      aStatus.textContent = 'down';
      aStatus.classList.remove('muted', 'ok');
      aStatus.classList.add('bad');
    }
  }
  setText('agent-impressions', ag.impressions);
  setText('agent-clicks', ag.clicks);
  setText('agent-outbounds', ag.outbounds);
  {
    const ctrEl = document.getElementById('agent-ctr');
    if (ctrEl) {
      if (ag.ctr === null || ag.ctr === undefined) {
        ctrEl.textContent = '—';
        ctrEl.classList.add('muted');
      } else {
        ctrEl.textContent = (ag.ctr * 100).toFixed(1) + '%';
        ctrEl.classList.remove('muted', 'warn', 'bad');
        ctrEl.classList.toggle('ok', ag.ctr >= 0.05);
        ctrEl.classList.toggle('warn', ag.ctr < 0.05 && ag.ctr >= 0.01);
        ctrEl.classList.toggle('bad', ag.ctr < 0.01);
      }
    }
  }
  const aNote = document.getElementById('agent-note');
  if (aNote) {
    if (ag.ok) {
      const parts = [];
      if (ag.saves !== undefined) parts.push(`saves ${ag.saves.toLocaleString()}`);
      if (ag.totalRows !== undefined) parts.push(`rows ${ag.totalRows.toLocaleString()}`);
      if (ag.fetchedAt) parts.push(`fetched ${new Date(ag.fetchedAt).toLocaleTimeString()}`);
      aNote.textContent = parts.join(' · ') || 'live';
    } else {
      aNote.textContent = ag.error || 'agent server unreachable';
    }
  }
}

// ── Hover-tooltip info popovers (Task 1) ───────────────────────────────────
//
// Lightweight, no-dependency popover system. Reads `data-info="..."` from any
// element and injects an ℹ️ button next to it. Clicking the button (or
// hovering on touch devices) toggles a single shared popover anchored near
// the button. Press Escape or click outside to dismiss. Pure DOM, no
// frameworks — runs once after DOMContentLoaded.

(function setupInfoPopovers() {
  const POPOVER_ID = 'info-popover';

  function getPopover() {
    return document.getElementById(POPOVER_ID);
  }

  function closePopover() {
    const p = getPopover();
    if (!p) return;
    p.hidden = true;
    p.innerHTML = '';
    document.querySelectorAll('.info-btn[aria-expanded="true"]').forEach((b) => {
      b.setAttribute('aria-expanded', 'false');
    });
  }

  function placePopover(btn, pop) {
    // Anchor below the button, clamped to viewport.
    const r = btn.getBoundingClientRect();
    pop.style.visibility = 'hidden';
    pop.hidden = false;
    // Measure after making visible (no transition yet since hidden was removed)
    const pr = pop.getBoundingClientRect();
    let left = r.left;
    let top = r.bottom + 8;
    // Clamp horizontally
    const margin = 8;
    if (left + pr.width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - pr.width - margin);
    }
    if (left < margin) left = margin;
    // If no room below, place above
    if (top + pr.height > window.innerHeight - margin && r.top - pr.height - 8 > margin) {
      top = r.top - pr.height - 8;
    }
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
    pop.style.visibility = 'visible';
  }

  function openPopover(btn, title, body, meta) {
    const pop = getPopover();
    if (!pop) return;
    // Toggle if same button re-clicked
    if (btn.getAttribute('aria-expanded') === 'true') {
      closePopover();
      return;
    }
    closePopover();
    pop.innerHTML = '';
    if (title) {
      const h = document.createElement('strong');
      h.textContent = title;
      pop.appendChild(h);
    }
    const p = document.createElement('div');
    p.textContent = body;
    pop.appendChild(p);
    if (meta) {
      const m = document.createElement('span');
      m.className = 'info-popover-meta';
      m.textContent = meta;
      pop.appendChild(m);
    }
    btn.setAttribute('aria-expanded', 'true');
    placePopover(btn, pop);
  }

  function titleFor(el) {
    // Prefer nearest preceding h2 text inside a card, or .layer-name text,
    // or the kpi-label text. Falls back to element id or 'info'.
    const card = el.closest('.card, .kpi-tile, .layer-tile');
    if (card) {
      const h = card.querySelector('h2, .kpi-label, .layer-name');
      if (h) {
        // Strip any existing info button text from the title
        return h.textContent.replace(/ℹ️|ⓘ/g, '').trim();
      }
    }
    return el.id || 'info';
  }

  function wireAnchor(el) {
    if (el.dataset.infoWired === '1') return;
    const text = el.getAttribute('data-info');
    if (!text) return;
    el.dataset.infoWired = '1';
    // If the element already contains an inline info button (added by hand),
    // wire that one instead of injecting a duplicate.
    let btn = el.querySelector(':scope > .info-btn, :scope .info-btn');
    if (btn) {
      // Make sure the existing button is properly classed and labeled.
      if (!btn.classList.contains('info-btn')) btn.classList.add('info-btn');
      if (!btn.getAttribute('aria-expanded')) btn.setAttribute('aria-expanded', 'false');
      if (!btn.getAttribute('aria-label')) btn.setAttribute('aria-label', 'Show explanation');
      btn.title = 'Click for explanation';
    } else {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'info-btn';
      btn.setAttribute('aria-label', 'Show explanation');
      btn.textContent = 'ℹ️';
      btn.setAttribute('aria-expanded', 'false');
      btn.title = 'Click for explanation';
      el.appendChild(btn);
    }
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      openPopover(btn, titleFor(el), text, el.dataset.infoMeta || '');
    });
    btn.addEventListener('mouseenter', () => {
      btn.title = text.length > 200 ? text.slice(0, 197) + '...' : text;
    });
  }

  function scan() {
    document.querySelectorAll('[data-info]').forEach(wireAnchor);
  }

  // Run after DOMContentLoaded so all cards exist. The main IIFE that
  // populates /api/status re-runs after every page load via meta-refresh, so
  // we also rescan whenever a fetch finishes — but since meta-refresh
  // actually replaces the whole document, we only need to scan once per
  // load here.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scan);
  } else {
    scan();
  }

  // Dismiss on outside click / Escape.
  document.addEventListener('click', (ev) => {
    if (ev.target.closest('.info-btn')) return;
    if (ev.target.closest('.info-popover')) return;
    closePopover();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') closePopover();
  });
  // Reposition on resize/scroll so popovers don't drift.
  window.addEventListener('resize', closePopover);
  window.addEventListener('scroll', closePopover, true);

  // Wire the header help button with a full-page overview.
  const helpBtn = document.getElementById('info-help');
  if (helpBtn) {
    helpBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const body =
        'Live view of every layer in the EventPulse ingestion stack: ' +
        'project-level KPIs (top strip), DB-fed sources list, time-series ' +
        'charts with day/week/month toggles, per-layer health tiles ' +
        '(A/B/C/D/F/G/H/AI/push), live state tiles (BullMQ, 08-Agent), ' +
        'batch success, freshness, schema drift, and operator suggestions. ' +
        'Click any ℹ️ for what a specific tile means and where the data ' +
        'comes from. Hover any chart point for the exact value.';
      openPopover(helpBtn, 'Scraping Supervisor Dashboard', body,
        'Read-only · auto-refresh 30s · driven by runtime/ files + Supabase');
    });
  }
})();

// ── Task 3a: per-layer extraction overview (historical totals + latest) ─────

/**
 * Render the per-layer extraction overview table.
 *
 * Reads `data.extractionOverview` (collected by `collectExtractionOverview`
 * in db.ts). Each row shows the layer's historical total on the left and
 * the timestamp of the layer's most recent activity on the right.
 *
 * The F (extractor) layer gets a `<details>` expandable breakdown listing
 * every per-source file with its event count and mtime, so the operator
 * can spot stale per-source caches at a glance.
 */
function renderExtractionOverview(O) {
  const body = document.getElementById('extraction-overview-body');
  if (!body) return;

  const fmtIso = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  };

  const ageDays = (iso) => {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return Math.floor((Date.now() - d.getTime()) / 86400000);
  };

  const cell = (v) => v === null || v === undefined ? '—' : (typeof v === 'number' ? v.toLocaleString() : escapeHtml(String(v)));

  const rows = [];

  // A: source-status jsonl
  if (O.A) {
    const ad = ageDays(O.A.latestSuccessIso);
    const tone = ad === null ? 'muted' : ad <= 1 ? 'ok' : ad <= 7 ? 'warn' : 'bad';
    rows.push(`<tr>
      <td><code>A</code> direct network</td>
      <td>${cell(O.A.totalSuccesses)} / ${cell(O.A.totalAttempts)} success/attempts</td>
      <td class="${tone}">${fmtIso(O.A.latestSuccessIso)}</td>
      <td>${ad === null ? '—' : ad + 'd ago'}</td>
    </tr>`);
  }

  // B: postB queue
  if (O.B) {
    const bd = ageDays(O.B.latestIso);
    const tone = O.B.queueDepth === 0 ? 'ok' : 'warn';
    rows.push(`<tr>
      <td><code>B</code> JSON feed gate</td>
      <td>${cell(O.B.queueDepth)} in queue</td>
      <td>${fmtIso(O.B.latestIso)}</td>
      <td>${bd === null ? '—' : bd + 'd ago'}</td>
    </tr>`);
  }

  // C: batches meta
  if (O.C) {
    const cd = ageDays(O.C.latestIso);
    rows.push(`<tr>
      <td><code>C</code> HTML 123-loop</td>
      <td>${cell(O.C.batchesTotal)} batches</td>
      <td>${fmtIso(O.C.latestIso)}</td>
      <td>${cd === null ? '—' : cd + 'd ago'}</td>
    </tr>`);
  }

  // D: render queue
  if (O.D) {
    const dd = ageDays(O.D.latestIso);
    const tone = O.D.pendingCount === 0 ? 'ok' : 'warn';
    rows.push(`<tr>
      <td><code>D</code> render gate</td>
      <td>${cell(O.D.pendingCount)} pending</td>
      <td>${fmtIso(O.D.latestIso)}</td>
      <td>${dd === null ? '—' : dd + 'd ago'}</td>
    </tr>`);
  }

  // F: extracted events (with details)
  if (O.F) {
    const fd = ageDays(O.F.latestIso);
    rows.push(`<tr>
      <td><code>F</code> event extractor</td>
      <td>${cell(O.F.eventsTotal)} events · ${cell(O.F.sources)} sources</td>
      <td>${fmtIso(O.F.latestIso)}</td>
      <td>${fd === null ? '—' : fd + 'd ago'}</td>
    </tr>`);
  }

  // G: scout
  if (O.G) {
    const gd = ageDays(O.G.latestIso);
    rows.push(`<tr>
      <td><code>G</code> universal scout</td>
      <td>${O.G.available ? 'results present' : 'no results yet'}</td>
      <td>${fmtIso(O.G.latestIso)}</td>
      <td>${gd === null ? '—' : gd + 'd ago'}</td>
    </tr>`);
  }

  // H: manual review
  if (O.H) {
    const hd = ageDays(O.H.latestIso);
    rows.push(`<tr>
      <td><code>H</code> manual review</td>
      <td>${cell(O.H.backlogSize)} backlog</td>
      <td>${fmtIso(O.H.latestIso)}</td>
      <td>${hd === null ? '—' : hd + 'd ago'}</td>
    </tr>`);
  }

  // AI: deeptrace
  if (O.AI) {
    const ad2 = ageDays(O.AI.latestIso);
    rows.push(`<tr>
      <td><code>AI</code> AI-assisted</td>
      <td>${cell(O.AI.logFiles)} log files</td>
      <td>${fmtIso(O.AI.latestIso)}</td>
      <td>${ad2 === null ? '—' : ad2 + 'd ago'}</td>
    </tr>`);
  }

  // Push
  if (O.Push) {
    const pd = ageDays(O.Push.lastJobIso);
    rows.push(`<tr>
      <td><code>↦</code> push scripts</td>
      <td>${cell(O.Push.totalJobs)} jobs · ${cell(O.Push.last7d)} last 7d</td>
      <td>${fmtIso(O.Push.lastJobIso)}</td>
      <td>${pd === null ? '—' : pd + 'd ago'}</td>
    </tr>`);
  }

  if (rows.length === 0) {
    body.innerHTML = '<tr><td colspan="4" class="empty">no layer data yet</td></tr>';
  } else {
    body.innerHTML = rows.join('');
  }

  // F per-source detail
  const fList = document.getElementById('extraction-overview-f-list');
  if (fList) {
    const perSource = (O.F && O.F.perSourceLatest) || [];
    if (perSource.length === 0) {
      fList.innerHTML = '<span class="empty muted">no extracted-events files</span>';
    } else {
      const max = perSource[0]?.events || 1;
      fList.innerHTML = perSource.slice(0, 50).map((s) => {
        const w = Math.max(6, Math.round((s.events / max) * 80));
        const ago = s.latestIso ? Math.floor((Date.now() - new Date(s.latestIso).getTime()) / 86400000) + 'd' : '?';
        return `<div class="db-source-row" style="grid-template-columns: 1fr 50px 50px;">
          <span class="src-name" title="${escapeHtml(s.source)}">${escapeHtml(s.source)}</span>
          <span class="num" style="background:rgba(88,166,255,${Math.min(0.8, 0.15 + (s.events / max) * 0.5)});height:${Math.max(8, w * 0.4)}px;border-radius:2px;">${s.events}</span>
          <span class="num muted">${ago}</span>
        </div>`;
      }).join('');
    }
  }
}

// ── Task 3b: Unsynced rows detector ───────────────────────────────────────

/**
 * Render the unsynced rows summary + per-source breakdown + sample rows.
 *
 * Reads `data.unsynced` (collected by `collectUnsynced` in db.ts).
 *
 * - ok=false: show a muted "unavailable" state with the error message.
 * - ok=true: show matched/missing counts + per-source breakdown + sample
 *   rows. Both `<details>` blocks are open by default so the operator can
 *   scan the gaps immediately.
 */
function renderUnsynced(U) {
  const summary = document.getElementById('unsynced-summary');
  const perSource = document.getElementById('unsynced-per-source');
  const rows = document.getElementById('unsynced-rows');

  if (summary) {
    if (!U.ok) {
      summary.innerHTML = `<span class="muted">unavailable: ${escapeHtml(U.error || 'unknown')}</span>`;
    } else {
      const total = U.matched + U.missing;
      const pct = total ? Math.round((U.missing / total) * 100) : 0;
      const tone = pct === 0 ? 'ok' : pct <= 5 ? 'warn' : 'bad';
      const dbRows = (U.totalInSupabaseRows || 0).toLocaleString();
      const dbDistinct = (U.totalInSupabaseDistinctUrls || 0).toLocaleString();
      const crossNote = U.crossSourceMatched
        ? ` · ${U.crossSourceMatched.toLocaleString()} matched cross-source (aggregator)`
        : '';
      const nullNote = U.nullSourceMatched
        ? ` · ${U.nullSourceMatched.toLocaleString()} matched via dropped source (null)`
        : '';
      summary.innerHTML = `
        <div class="unsynced-summary-stats">
          <span class="big ${tone}">${U.missing.toLocaleString()}</span>
          <span class="muted">missing of ${total.toLocaleString()} local rows · ${U.matched.toLocaleString()} matched · ${dbRows} rows / ${dbDistinct} distinct urls in DB${crossNote}${nullNote}</span>
        </div>
        <p class="caption">${pct}% unsynced · identity = ticket_url (cross-source) · checked ${new Date(U.fetchedAt).toLocaleTimeString()}</p>
      `;
    }
  }

  if (perSource) {
    if (!U.ok || !U.perSource || U.perSource.length === 0) {
      perSource.innerHTML = '<span class="empty muted">no data</span>';
    } else {
      const max = Math.max(1, U.perSource[0]?.missing || 0);
      perSource.innerHTML = U.perSource.slice(0, 30).map((r) => {
        const pct = r.local ? Math.round((r.missing / r.local) * 100) : 0;
        const cross = r.crossSourceMatched ? ` · ${r.crossSourceMatched} cross` : '';
        const nullNote = r.nullSourceMatched ? ` · ${r.nullSourceMatched} ∅` : '';
        return `<div class="db-source-row" style="grid-template-columns: 1fr 60px 60px 50px 50px 50px;">
          <span class="src-name" title="${escapeHtml(r.source)}">${escapeHtml(r.source)}</span>
          <span class="num muted">local ${r.local}</span>
          <span class="num bad">missing ${r.missing}</span>
          <span class="num">${pct}%</span>
          <span class="num muted">${r.crossSourceMatched || 0}↔</span>
          <span class="num muted">${r.nullSourceMatched || 0}∅</span>
        </div>`;
      }).join('');
    }
  }

  if (rows) {
    if (!U.ok || !U.missingRows || U.missingRows.length === 0) {
      rows.innerHTML = '<li class="empty muted">no missing rows</li>';
    } else {
      rows.innerHTML = U.missingRows.map((r) => `<li>
        <code>${escapeHtml(r.source)}</code>
        <span class="muted">${escapeHtml(r.date)}</span>
        — ${escapeHtml(r.title || '(no title)')}
        <a href="${escapeHtml(r.url)}" target="_blank" rel="noopener" class="muted">↗</a>
      </li>`).join('');
    }
  }
}

// ── Source Health (Phase 1 — per-source diagnostics) ────────────────────────
//
// Driven by GET /api/source-health. Renders:
//   - 4 KPI tiles (total / healthy / irregular / failed)
//   - Horizontal bar of error category counts (acts as a simple "pie chart")
//   - Sortable, filterable table of every source row
//   - Click a row → toggle a drill-down with the last error message
//
// All state (sort key, sort dir, search, category filter, status filter,
// expanded rows) lives in `shState`. Re-rendering just re-paints the table
// from state.

const shState = {
  rows: [],
  summary: null,
  search: '',
  catFilter: 'all',
  statusFilter: 'all',
  sortKey: 'status',   // 'status'|'id'|'lastSuccess'|'successRate'|'attempts'|'cf'|'lastErrorCategory'
  sortDir: 'asc',
  expanded: new Set(), // sourceIds whose drill-down is open
};

function initSourceHealth(data) {
  shState.rows = data.sources || [];
  shState.summary = data.summary || null;
  renderShKpis();
  renderShErrorCats(data.errorCategories || {});
  renderShTable();
  wireShToolbar();
  wireShSorting();
}

function renderShKpis() {
  const s = shState.summary;
  if (!s) return;
  setText('sh-total', s.total);
  setText('sh-healthy', s.healthy);
  setText('sh-irregular', s.irregular);
  setText('sh-failed', s.failed);
}

const CAT_LABELS = {
  timeout: 'timeout',
  '404': '404 / network',
  '500': '500 / server',
  redirect: 'redirect',
  antibot: 'antibot / 403',
  parse: 'parse / no-jsonld',
  other: 'other',
  null: 'no error',
};
const CAT_COLORS = {
  timeout: '#f0883e',
  '404': '#d29922',
  '500': '#f85149',
  redirect: '#a371f7',
  antibot: '#ff7b72',
  parse: '#58a6ff',
  other: '#8b949e',
  null: '#3fb950',
};
const CAT_ORDER = ['timeout', '500', '404', 'antibot', 'redirect', 'parse', 'other', 'null'];

function renderShErrorCats(cats) {
  const el = document.getElementById('sh-errorcats');
  if (!el) return;
  const entries = CAT_ORDER
    .map((k) => [k, cats[k] || 0])
    .filter(([, n]) => n > 0);
  const total = entries.reduce((a, [, n]) => a + n, 0);
  if (total === 0) {
    el.innerHTML = '<span class="muted">no error categories recorded</span>';
    return;
  }
  el.innerHTML = '<div class="sh-bars">' + entries.map(([k, n]) => {
    const pct = total ? (n / total) * 100 : 0;
    return `<div class="sh-bar-row" title="${escapeHtml(CAT_LABELS[k])}: ${n} (${pct.toFixed(1)}%)">
      <span class="sh-bar-label">${escapeHtml(CAT_LABELS[k])}</span>
      <div class="sh-bar-track"><div class="sh-bar-fill" style="width:${pct.toFixed(1)}%;background:${CAT_COLORS[k]}"></div></div>
      <span class="sh-bar-count">${n}</span>
    </div>`;
  }).join('') + '</div>';
}

function statusRank(s) {
  // failed < irregular < healthy — "asc" sort shows worst first
  return s === 'failed' ? 0 : s === 'irregular' ? 1 : 2;
}

function sortShRows(rows) {
  const k = shState.sortKey;
  const dir = shState.sortDir === 'asc' ? 1 : -1;
  const sorted = rows.slice().sort((a, b) => {
    let av, bv;
    if (k === 'status') { av = statusRank(a.status); bv = statusRank(b.status); }
    else if (k === 'id') { av = a.id; bv = b.id; }
    else if (k === 'lastSuccess') { av = a.lastSuccess || ''; bv = b.lastSuccess || ''; }
    else if (k === 'successRate') { av = a.successRate; bv = b.successRate; }
    else if (k === 'attempts') { av = a.attempts; bv = b.attempts; }
    else if (k === 'cf') { av = a.consecutiveFailures; bv = b.consecutiveFailures; }
    else if (k === 'lastErrorCategory') {
      av = a.lastErrorCategory || 'zzz'; // null sorts last on asc
      bv = b.lastErrorCategory || 'zzz';
    }
    else { return 0; }
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });
  return sorted;
}

function renderShTable() {
  const body = document.getElementById('sh-tbody');
  const counter = document.getElementById('sh-count');
  if (!body) return;
  const needle = shState.search.trim().toLowerCase();
  const filtered = shState.rows.filter((r) => {
    if (shState.statusFilter !== 'all' && r.status !== shState.statusFilter) return false;
    if (shState.catFilter !== 'all') {
      if (shState.catFilter === 'null') {
        if (r.lastErrorCategory !== null) return false;
      } else if (r.lastErrorCategory !== shState.catFilter) return false;
    }
    if (needle && !r.id.toLowerCase().includes(needle)) return false;
    return true;
  });
  const sorted = sortShRows(filtered);
  if (sorted.length === 0) {
    body.innerHTML = '<tr><td colspan="8" class="empty">no sources match current filter</td></tr>';
  } else {
    body.innerHTML = sorted.map((r) => {
      const statusBadge = `<span class="badge ${r.status === 'healthy' ? 'ok' : r.status === 'irregular' ? 'warn' : 'bad'}">${escapeHtml(r.status)}</span>`;
      const cat = r.lastErrorCategory === null ? '<span class="muted">none</span>' : `<span class="sh-cat sh-cat-${escapeHtml(r.lastErrorCategory || 'null')}">${escapeHtml(CAT_LABELS[r.lastErrorCategory] || r.lastErrorCategory)}</span>`;
      const lastOk = r.lastSuccess ? new Date(r.lastSuccess).toLocaleDateString() : '<span class="muted">never</span>';
      const rate = r.successRate === 0 ? '0%' : Math.round(r.successRate * 100) + '%';
      const isExp = shState.expanded.has(r.id);
      const errShort = r.lastError
        ? escapeHtml(r.lastError.slice(0, 80)) + (r.lastError.length > 80 ? '…' : '')
        : '<span class="muted">—</span>';
      const row = `<tr class="sh-row${isExp ? ' sh-expanded' : ''}" data-sid="${escapeHtml(r.id)}">
        <td>${statusBadge}</td>
        <td><code>${escapeHtml(r.id)}</code></td>
        <td class="muted">${lastOk}</td>
        <td>${rate}</td>
        <td class="muted">${r.attempts}</td>
        <td class="muted">${r.consecutiveFailures}</td>
        <td>${cat}</td>
        <td>${errShort}</td>
      </tr>`;
      const detail = isExp ? `<tr class="sh-detail"><td colspan="8"><div class="sh-detail-body">
        <strong>Last error:</strong> <code>${escapeHtml(r.lastError || '(none)')}</code><br>
        <strong>Last run:</strong> ${r.lastFail ? new Date(r.lastFail).toLocaleString() : '<span class="muted">never</span>'}
        &middot; <strong>Preferred path:</strong> ${escapeHtml(r.preferredPath || '—')}
        &middot; <strong>Last path:</strong> ${escapeHtml(r.lastPathUsed || '—')}
      </div></td></tr>` : '';
      return row + detail;
    }).join('');
  }
  if (counter) {
    counter.textContent = `${sorted.length.toLocaleString()} of ${shState.rows.length.toLocaleString()} sources`;
  }
  // Reflect current sort on headers (arrow indicator)
  document.querySelectorAll('#sh-table th[data-sort]').forEach((th) => {
    th.classList.toggle('sh-sort-active', th.dataset.sort === shState.sortKey);
    th.classList.toggle('sh-sort-desc', th.dataset.sort === shState.sortKey && shState.sortDir === 'desc');
  });
}

function wireShToolbar() {
  const search = document.getElementById('sh-search');
  if (search && !search.dataset.wired) {
    search.dataset.wired = '1';
    search.addEventListener('input', (e) => {
      shState.search = e.target.value || '';
      renderShTable();
    });
  }
  const cat = document.getElementById('sh-cat-filter');
  if (cat && !cat.dataset.wired) {
    cat.dataset.wired = '1';
    cat.addEventListener('change', (e) => {
      shState.catFilter = e.target.value;
      renderShTable();
    });
  }
  const status = document.getElementById('sh-status-filter');
  if (status && !status.dataset.wired) {
    status.dataset.wired = '1';
    status.addEventListener('change', (e) => {
      shState.statusFilter = e.target.value;
      renderShTable();
    });
  }
  // Row click → toggle drill-down
  const body = document.getElementById('sh-tbody');
  if (body && !body.dataset.wired) {
    body.dataset.wired = '1';
    body.addEventListener('click', (ev) => {
      const tr = ev.target.closest('tr.sh-row');
      if (!tr) return;
      const sid = tr.dataset.sid;
      if (!sid) return;
      if (shState.expanded.has(sid)) shState.expanded.delete(sid);
      else shState.expanded.add(sid);
      renderShTable();
    });
  }
}

function wireShSorting() {
  document.querySelectorAll('#sh-table th[data-sort]').forEach((th) => {
    if (th.dataset.sortWired) return;
    th.dataset.sortWired = '1';
    th.style.cursor = 'pointer';
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (shState.sortKey === key) {
        shState.sortDir = shState.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        shState.sortKey = key;
        shState.sortDir = (key === 'id' || key === 'lastErrorCategory') ? 'asc' : 'desc';
      }
      renderShTable();
    });
  });
}
