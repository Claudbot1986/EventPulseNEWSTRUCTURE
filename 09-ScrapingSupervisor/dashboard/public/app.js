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

    document.getElementById('generated-at').textContent = new Date(data.generatedAt).toLocaleString();
  } catch (err) {
    document.querySelector('main').innerHTML =
      `<div class="card"><h2>Error</h2><p>Failed to fetch /api/status: ${String(err)}</p></div>`;
  }
})();
