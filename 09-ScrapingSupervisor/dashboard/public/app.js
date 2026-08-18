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
  } catch (err) {
    document.querySelector('main').innerHTML =
      `<div class="card"><h2>Error</h2><p>Failed to fetch /api/status: ${String(err)}</p></div>`;
  }
})();

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
