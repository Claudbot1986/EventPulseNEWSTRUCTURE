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

    // Sources (DB-fed) — top 5 by future-event count
    const dbSrcList = document.getElementById('db-sources-list');
    if (dbSrcList) {
      const rows = (data.dbSources || []).slice(0, 5);
      if (rows.length === 0) {
        dbSrcList.innerHTML = '<span class="empty muted">no DB-fed sources</span>';
      } else {
        dbSrcList.innerHTML = rows.map((r) => {
          const freshClass = r.fresh7d > 0 ? 'fresh' : 'zero';
          return `<div class="db-source-row">
            <span class="src-name" title="${escapeHtml(r.source)}">${escapeHtml(r.source)}</span>
            <span class="num ${freshClass}">${r.fresh7d}</span>
            <span class="num">${r.events}</span>
          </div>`;
        }).join('') +
        '<div class="db-source-row" style="border-bottom:0; color: var(--muted); font-size: 11px;">' +
          '<span>fresh(7d) / total</span><span></span><span></span>' +
        '</div>';
      }
    }

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
  } catch (err) {
    document.querySelector('main').innerHTML =
      `<div class="card"><h2>Error</h2><p>Failed to fetch /api/status: ${String(err)}</p></div>`;
  }
})();

/** Minimal HTML escaper for DB-fed source names rendered into innerHTML. */
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
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
