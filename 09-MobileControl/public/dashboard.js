/**
 * dashboard.js — minimal vanilla JS for mobile control.
 *
 * Connects to:
 *   /api/stream         — full StateSnapshot every 2s (existing)
 *   /api/stream/activity — incremental activity events + history replay
 *
 * Token is read from URL ?token=... or localStorage.
 */

(() => {
  const TOKEN_KEY = 'ep_mobile_token';

  function getToken() {
    const url = new URL(location.href);
    const fromUrl = url.searchParams.get('token');
    if (fromUrl) {
      localStorage.setItem(TOKEN_KEY, fromUrl);
      return fromUrl;
    }
    return localStorage.getItem(TOKEN_KEY) || '';
  }

  const TOKEN = getToken();
  const HEADERS = TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {};

  const $ = (id) => document.getElementById(id);

  // Local cache of activity events. Pushed onto by SSE deltas. Trimmed to 100.
  const activityCache = [];
  const ACTIVITY_CACHE_MAX = 100;
  let lastEventAt = null;
  let snapshotTimer = null;

  function fmtRuntime(hours) {
    if (hours === null || hours === undefined || hours <= 0) return '0m';
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  function fmtTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function fmtRelative(iso) {
    if (!iso) return '—';
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 0) return 'just now';
    if (ms < 60000) return `${Math.floor(ms / 1000)}s ago`;
    const m = Math.floor(ms / 60000);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function setConnection(state, detail) {
    const el = $('connection-status');
    if (!el) return;
    if (state === 'live') {
      el.textContent = '● LIVE';
      el.className = 'status-pill status-running connection-live';
    } else if (state === 'disconnected') {
      el.textContent = '○ DISCONNECTED';
      el.className = 'status-pill status-failed connection-disconnected';
    } else {
      el.textContent = 'connecting…';
      el.className = 'status-pill status-unknown';
    }
    if (detail) el.title = detail;
  }

  function updateLastEventTime(iso) {
    if (!iso) return;
    lastEventAt = iso;
    const el = $('last-event-time');
    if (el) el.textContent = `last event: ${fmtRelative(iso)}`;
  }

  // --- Snapshot rendering -------------------------------------------------

  function renderStatus(snap) {
    const w = snap.wrapper;
    const statusEl = $('wrapper-status');
    if (!statusEl) return;
    statusEl.textContent = w.status;
    statusEl.className = 'value status-pill status-' + w.status;
    $('wrapper-runtime').textContent = fmtRuntime(w.elapsed_hours);
    $('wrapper-iteration').textContent = String(w.iteration);
    $('wrapper-last').textContent = `${w.last_status}${w.last_exit_code !== null ? ' (rc=' + w.last_exit_code + ')' : ''}`;

    const tmuxEl = $('tmux-status');
    if (window.__epTmuxState !== undefined) {
      tmuxEl.textContent = window.__epTmuxState ? 'running' : 'stopped';
      tmuxEl.className = 'status-pill status-' + (window.__epTmuxState ? 'running' : 'stopped');
    }
  }

  function renderNow(snap) {
    const list = $('agent-list');
    if (!list) return;
    const agents = snap.agents || [];
    const summary = snap.last_iter_summary;

    // Always show lead + work + vault-sync rows; fill with Idle when absent.
    const roles = ['lead', 'work', 'vault-sync'];
    const byRole = new Map(agents.map((a) => [a.role, a]));
    const rows = roles.map((role) => {
      const a = byRole.get(role);
      const elapsed = a ? fmtRelative(a.started_at) : '—';
      const task = a ? a.task : (role === 'lead' && summary ? `iter ${summary.iter}` : 'Idle');
      const completed = a?.status === 'completed' ? ' agent-completed' : '';
      return `
        <li class="agent-row${completed}" data-role="${role}">
          <span class="agent-role">${role}</span>
          <span class="agent-task">${escapeHtml(task)}</span>
          <span class="agent-elapsed">${elapsed}</span>
        </li>`;
    });
    list.innerHTML = rows.join('');

    if (summary) {
      $('iter-num').textContent = String(summary.iter ?? '—');
      $('iter-turns').textContent = String(summary.num_turns ?? '—');
      $('iter-cost').textContent = summary.total_cost_usd != null ? `$${summary.total_cost_usd.toFixed(2)}` : '—';
      $('iter-stop').textContent = summary.stop_reason || (summary.is_error ? 'error' : '—');
    } else {
      $('iter-num').textContent = '—';
      $('iter-turns').textContent = '—';
      $('iter-cost').textContent = '—';
      $('iter-stop').textContent = '—';
    }
  }

  // Group ordering: in_progress → pending → blocked → done → cancelled.
// Anything not in this list falls to the end (defensive — keeps the
// dashboard rendering if a new status is added server-side).
  const STATUS_ORDER = ['in_progress', 'pending', 'blocked', 'done', 'cancelled'];
  const STATUS_META = {
    in_progress: { icon: '🟢', label: 'In Progress' },
    pending:     { icon: '⏳', label: 'Pending' },
    blocked:     { icon: '🔒', label: 'Blocked' },
    done:        { icon: '✓',  label: 'Completed' },
    cancelled:   { icon: '✗',  label: 'Cancelled' },
  };

  function renderTasks(snap) {
    const list = $('task-list');
    const countEl = $('tasks-count');
    const allTasks = snap.tasks || [];
    const activeId = snap.currently_active_task || null;

    if (countEl) countEl.textContent = `${allTasks.length} total`;

    if (allTasks.length === 0) {
      list.innerHTML = '<li class="task-item"><span class="task-title">— no tasks —</span></li>';
      return;
    }

    // Bucket by status. Preserve original order within each bucket — the
    // server already returns tasks sorted by priority/age.
    const buckets = new Map();
    for (const t of allTasks) {
      const k = t.status || 'pending';
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(t);
    }

    const html = [];
    // Render known statuses first in STATUS_ORDER, then any unknown bucket last.
    const ordered = [...STATUS_ORDER, ...[...buckets.keys()].filter((k) => !STATUS_ORDER.includes(k))];
    for (const status of ordered) {
      const bucket = buckets.get(status);
      if (!bucket || bucket.length === 0) continue;
      const meta = STATUS_META[status] || { icon: '•', label: status };
      html.push(`<li class="task-group-header" data-status="${escapeHtml(status)}">
        <span class="task-group-icon">${meta.icon}</span>
        <span class="task-group-label">${escapeHtml(meta.label)}</span>
        <span class="task-group-count">${bucket.length}</span>
      </li>`);
      for (const t of bucket) {
        const indicatorClass =
          t.status === 'done' ? 'done' :
          (activeId && t.id === activeId) ? 'active' :
          'idle';
        html.push(`
        <li class="task-item">
          <span class="indicator ${indicatorClass}"></span>
          <div class="task-body">
            <span class="task-prio ${t.priority}">${t.priority}</span>
            <span class="task-id">${t.id}</span>
            <div class="task-title">${escapeHtml(t.title)}</div>
          </div>
        </li>`);
      }
    }
    list.innerHTML = html.join('');
  }

  function renderCommits(snap) {
    const list = $('commit-list');
    const cs = snap.recent_commits || [];
    if (cs.length === 0) {
      list.innerHTML = '<li class="commit-item"><span class="commit-subject">— no commits —</span></li>';
      return;
    }
    list.innerHTML = cs
      .slice(0, 8)
      .map(
        (c) => `
        <li class="commit-item">
          <span class="commit-hash">${c.short_hash}</span>
          <span class="commit-subject">${escapeHtml(c.subject)}</span>
          <div class="commit-meta">${fmtRelative(c.date)} · ${escapeHtml(c.author)}</div>
        </li>`
      )
      .join('');
  }

  // --- Claude's Last Answer (latest iter + scrollable past iters) ------

  // Cache of fetched iters. Refreshed every few seconds; clicking a past iter
  // swaps the displayed `result` without a refetch.
  let itersCache = [];
  let selectedIterN = null; // number of currently displayed iter, null = latest

  async function refreshIters() {
    try {
      const r = await fetch('/api/iters?limit=20', { headers: HEADERS });
      if (!r.ok) return;
      const j = await r.json();
      itersCache = Array.isArray(j.iters) ? j.iters : [];
      renderIterList();
      // Show the latest iter in the main pane unless the user has explicitly
      // picked another one. If their selection no longer exists, fall back.
      if (itersCache.length === 0) {
        renderClaudeAnswer(null);
        return;
      }
      const sel = itersCache.find((it) => it.iter === selectedIterN);
      if (!sel) {
        selectedIterN = null;
        renderClaudeAnswer(itersCache[0]);
      } else {
        renderClaudeAnswer(sel);
      }
    } catch (err) {
      // Silent: card stays at last known state
    }
  }

  function renderClaudeAnswer(iter) {
    const pane = $('claude-answer-pane');
    const meta = $('claude-answer-meta');
    if (!pane || !meta) return;
    if (!iter) {
      pane.textContent = '(no iters yet)';
      meta.textContent = '—';
      return;
    }
    pane.textContent = iter.result || '(empty result)';
    const cost = typeof iter.total_cost_usd === 'number' ? `$${iter.total_cost_usd.toFixed(2)}` : '—';
    const turns = iter.num_turns ?? '—';
    const reason = iter.stop_reason || '—';
    meta.textContent = `iter ${iter.iter} · ${turns} turns · ${cost} · ${reason}`;
    // Update active highlight in the list
    const items = document.querySelectorAll('.iter-list-item');
    items.forEach((el) => {
      const n = Number(el.dataset.iter);
      el.classList.toggle('active', n === iter.iter);
    });
  }

  function renderIterList() {
    const list = $('iter-list');
    if (!list) return;
    if (itersCache.length === 0) {
      list.innerHTML = '<li class="iter-list-item" style="cursor:default;color:#666;">— no iters yet —</li>';
      return;
    }
    list.innerHTML = itersCache
      .map((it) => {
        const cls = it.is_error ? 'iter-list-item iter-error' : 'iter-list-item';
        const cost = typeof it.total_cost_usd === 'number' ? `$${it.total_cost_usd.toFixed(2)}` : '—';
        return `
        <li class="${cls}" data-iter="${it.iter}">
          <span class="iter-num">iter ${it.iter}</span>
          <span class="iter-cost">${cost} · ${it.num_turns ?? '—'} turns</span>
        </li>`;
      })
      .join('');
    // Wire click handlers
    list.querySelectorAll('.iter-list-item[data-iter]').forEach((el) => {
      el.addEventListener('click', () => {
        const n = Number(el.dataset.iter);
        const found = itersCache.find((it) => it.iter === n);
        if (!found) return;
        selectedIterN = n;
        renderClaudeAnswer(found);
        // Scroll the main pane to the top so the user sees the start of the response
        const pane = $('claude-answer-pane');
        if (pane) pane.scrollTop = 0;
      });
    });
  }

  // --- Live Activity (timeline) ------------------------------------------

  function prependActivity(ev) {
    if (!ev || !ev.type) return;
    activityCache.unshift(ev);
    if (activityCache.length > ACTIVITY_CACHE_MAX) {
      activityCache.length = ACTIVITY_CACHE_MAX;
    }
    renderTimeline();
    updateLastEventTime(ev.ts);
  }

  function seedActivity(events) {
    if (!Array.isArray(events)) return;
    // events arrive in chronological order from server; reverse so newest first
    activityCache.length = 0;
    for (const ev of events.slice(-ACTIVITY_CACHE_MAX).reverse()) {
      activityCache.push(ev);
    }
    if (activityCache[0]) updateLastEventTime(activityCache[0].ts);
    renderTimeline();
  }

  function renderTimeline() {
    const list = $('activity-list');
    if (!list) return;
    const countEl = $('activity-count');
    if (countEl) countEl.textContent = `${activityCache.length} events`;
    if (activityCache.length === 0) {
      list.innerHTML = '<li class="timeline-item"><span class="timeline-detail">— no activity yet —</span></li>';
      return;
    }
    list.innerHTML = activityCache
      .map(
        (a) => `
        <li class="timeline-item">
          <span class="timeline-time">${fmtTime(a.ts)}</span>
          <span class="timeline-type t-${a.type}">${a.type.replace(/_/g, ' ')}</span>
          <span class="timeline-detail">${escapeHtml(a.detail || '')}</span>
        </li>`
      )
      .join('');
  }

  // --- Terminal ----------------------------------------------------------

  async function refreshTerminal() {
    try {
      const r = await fetch('/api/terminal', { headers: HEADERS });
      if (!r.ok) {
        $('terminal-pane').textContent = `(terminal unavailable: ${r.status})`;
        return;
      }
      const j = await r.json();
      const tmuxEl = $('tmux-status');
      window.__epTmuxState = j.tmux_running;
      if (j.tmux_running) {
        tmuxEl.textContent = 'running';
        tmuxEl.className = 'status-pill status-running';
      } else {
        tmuxEl.textContent = 'stopped';
        tmuxEl.className = 'status-pill status-stopped';
      }
      $('terminal-pane').textContent = j.pane || '(empty pane)';
    } catch (err) {
      $('terminal-pane').textContent = `(error: ${err.message})`;
    }
  }

  async function fetchStatus() {
    try {
      const r = await fetch('/api/status', { headers: HEADERS });
      if (!r.ok) {
        setConnection('disconnected', `HTTP ${r.status}`);
        return null;
      }
      return await r.json();
    } catch (err) {
      setConnection('disconnected', err.message);
      return null;
    }
  }

  // --- SSE ---------------------------------------------------------------

  function startSnapshotSSE() {
    const url = '/api/stream?token=' + encodeURIComponent(TOKEN);
    let es = new EventSource(url);

    const onMessage = (e) => {
      try {
        const snap = JSON.parse(e.data);
        renderStatus(snap);
        renderNow(snap);
        renderTasks(snap);
        renderCommits(snap);
        if (snap.last_event_at) updateLastEventTime(snap.last_event_at);
      } catch (err) {
        console.error('sse parse', err);
      }
    };
    es.onmessage = onMessage;
    es.onerror = () => {
      setConnection('disconnected', 'snapshot stream lost — reconnecting…');
      // EventSource auto-reconnects; UI reflects state until then
    };
    es.onopen = () => {
      setConnection('live');
    };

    // Heartbeat ticker: re-poll status on activity-tick so cards stay fresh
    // even when the wrapper isn't producing snapshot diffs. A successful poll
    // also restores the LIVE pill — without this, an EventSource that was
    // briefly disconnected (browser retried) keeps the pill on DISCONNECTED
    // forever even though the wire has recovered.
    snapshotTimer = setInterval(async () => {
      const s = await fetchStatus();
      if (s) {
        renderStatus(s);
        renderNow(s);
        renderTasks(s);
        renderCommits(s);
        if (s.last_event_at) updateLastEventTime(s.last_event_at);
        setConnection('live');
      }
    }, 2000);
  }

  function startActivitySSE() {
    const url = '/api/stream/activity?token=' + encodeURIComponent(TOKEN);
    const es = new EventSource(url);

    es.addEventListener('history', (e) => {
      try {
        const j = JSON.parse(e.data);
        if (Array.isArray(j.events)) seedActivity(j.events);
      } catch (err) {
        console.error('history parse', err);
      }
    });
    es.addEventListener('activity', (e) => {
      try {
        const ev = JSON.parse(e.data);
        prependActivity(ev);
      } catch (err) {
        console.error('activity parse', err);
      }
    });
    es.onerror = () => {
      // Activity stream auto-reconnects; don't poison the connection pill
      // because the snapshot stream is authoritative for reachability.
    };
  }

  // --- modal: send instructions / add task / interactive terminal -------

  const modal = $('modal-backdrop');
  const modalTitle = $('modal-title');
  const modalInput = $('modal-input');
  const modalAttachmentsEl = $('modal-attachments');
  const modalAttachmentsListEl = $('modal-attachments-list');
  const modalAttachHint = $('modal-attach-hint');
  const modalFileInput = $('modal-file-input');
  let modalAction = null;
  // Per-modal attachments. Reset on openModal(). Each item: {filename, mimeType, data, dataUrl}
  // `data` is the raw base64 string (no data: prefix) sent to the server.
  let modalAttachments = [];

  function openModal(title, action, placeholder) {
    modalTitle.textContent = title;
    modalInput.placeholder = placeholder || '';
    modalInput.value = '';
    modalAttachments = [];
    renderAttachments();
    modalAction = action;
    modal.hidden = false;
    modalInput.focus();
  }
  function closeModal() {
    modal.hidden = true;
    modalAction = null;
    modalAttachments = [];
    if (modalFileInput) modalFileInput.value = '';
  }

  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        const result = String(r.result || '');
        // result is "data:<mime>;base64,<data>" — strip the prefix.
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      r.onerror = () => reject(r.error || new Error('read failed'));
      r.readAsDataURL(file);
    });
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ''));
      r.onerror = () => reject(r.error || new Error('read failed'));
      r.readAsDataURL(file);
    });
  }

  async function addAttachment(file) {
    if (!file || !file.type || !file.type.startsWith('image/')) return;
    // Hard cap to keep total request under the server's 10mb JSON limit.
    if (modalAttachments.length >= 5) {
      alert('Max 5 attachments per message.');
      return;
    }
    try {
      const data = await readFileAsBase64(file);
      const dataUrl = await readFileAsDataUrl(file);
      const filename = file.name || `pasted-${Date.now()}.${(file.type.split('/')[1] || 'png')}`;
      modalAttachments.push({ filename, mimeType: file.type, data, dataUrl });
      renderAttachments();
    } catch (err) {
      alert('Could not read image: ' + err.message);
    }
  }

  function removeAttachment(idx) {
    modalAttachments.splice(idx, 1);
    renderAttachments();
  }

  function renderAttachments() {
    if (!modalAttachmentsEl || !modalAttachmentsListEl) return;
    if (modalAttachments.length === 0) {
      modalAttachmentsEl.hidden = true;
      modalAttachmentsListEl.innerHTML = '';
      if (modalAttachHint) modalAttachHint.textContent = 'or paste an image';
      return;
    }
    modalAttachmentsEl.hidden = false;
    if (modalAttachHint) modalAttachHint.textContent = `${modalAttachments.length} attached`;
    modalAttachmentsListEl.innerHTML = modalAttachments
      .map(
        (a, i) => `
        <div class="attachment-thumb">
          <img src="${escapeHtml(a.dataUrl)}" alt="">
          <button class="attachment-remove" data-idx="${i}" type="button">×</button>
          <div class="attachment-name">${escapeHtml(a.filename)}</div>
        </div>`
      )
      .join('');
    modalAttachmentsListEl.querySelectorAll('.attachment-remove').forEach((btn) => {
      btn.addEventListener('click', () => removeAttachment(Number(btn.dataset.idx)));
    });
  }

  // Paste an image directly into the textarea — iOS Safari exposes the
  // image as a file via clipboardData.items[i].getAsFile().
  modalInput.addEventListener('paste', async (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items || items.length === 0) return;
    const files = [];
    for (const it of items) {
      if (it.kind === 'file' && it.type && it.type.startsWith('image/')) {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length === 0) return;
    e.preventDefault();
    for (const f of files) {
      await addAttachment(f);
    }
  });

  // File-picker fallback (paperclip "+ image" button)
  if (modalFileInput) {
    modalFileInput.addEventListener('change', async (e) => {
      const files = Array.from((e.target).files || []);
      for (const f of files) {
        await addAttachment(f);
      }
      // Reset so picking the same file again still triggers change.
      e.target.value = '';
    });
  }

  $('modal-cancel').addEventListener('click', closeModal);
  $('modal-submit').addEventListener('click', async () => {
    if (!modalAction) return;
    const value = modalInput.value.trim();
    if (!value && modalAttachments.length === 0) { closeModal(); return; }
    try {
      await modalAction(value, modalAttachments.slice());
    } catch (err) {
      alert('Error: ' + err.message);
    }
    closeModal();
  });

  // Interactive terminal modal
  const termModal = $('terminal-modal');
  const termModalInput = $('terminal-input');
  const termModalPane = $('terminal-modal-pane');
  let termModalTimer = null;

  async function refreshTermModal() {
    try {
      const r = await fetch('/api/terminal', { headers: HEADERS });
      if (!r.ok) {
        termModalPane.textContent = `(terminal unavailable: ${r.status})`;
        return;
      }
      const j = await r.json();
      termModalPane.textContent = j.pane || '(empty pane)';
      termModalPane.scrollTop = termModalPane.scrollHeight;
    } catch (err) {
      termModalPane.textContent = `(error: ${err.message})`;
    }
  }
  function openTermModal() {
    termModal.hidden = false;
    refreshTermModal();
    termModalTimer = setInterval(refreshTermModal, 3000);
    termModalInput.focus();
  }
  function closeTermModal() {
    termModal.hidden = true;
    if (termModalTimer) { clearInterval(termModalTimer); termModalTimer = null; }
  }
  $('open-interactive').addEventListener('click', openTermModal);
  $('terminal-modal-close').addEventListener('click', closeTermModal);
  $('terminal-modal-send').addEventListener('click', async () => {
    const keys = termModalInput.value;
    if (!keys) return;
    try {
      await postJson('/api/terminal/send', { keys });
      termModalInput.value = '';
      setTimeout(refreshTermModal, 500);
    } catch (err) {
      alert('Send failed: ' + err.message);
    }
  });

  async function postJson(path, body) {
    const r = await fetch(path, {
      method: 'POST',
      headers: { ...HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`${r.status}: ${t}`);
    }
    return r.json();
  }

  // --- action bar wiring --------------------------------------------------

  document.querySelectorAll('.action-bar .action').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const a = btn.dataset.action;
      if (a === 'instruct') {
        openModal(
          'Send Instruction',
          async (msg, attachments) =>
            postJson('/api/instruct', {
              message: msg,
              attachments: attachments && attachments.length ? attachments : undefined,
            }),
          'Type your instruction for the lead agent… (paste images too)'
        );
      } else if (a === 'add-task') {
        openModal(
          'Add Task',
          async (text) => {
            const parts = text.split('|').map((s) => s.trim());
            const priority = ['P0', 'P1', 'P2', 'P3'].includes(parts[0]) ? parts[0] : 'P3';
            const title = parts[1] || parts[0] || 'untitled';
            const verify = parts[2] || 'manual verification';
            await postJson('/api/tasks', { priority, title, verify });
          },
          'P3 | Title of task | How to verify'
        );
      } else if (a === 'pause') {
        if (!confirm('Pause autonomous execution?')) return;
        await postJson('/api/pause', {});
      } else if (a === 'resume') {
        await postJson('/api/resume', {});
      } else if (a === 'refresh') {
        await refreshTerminal();
        const s = await fetchStatus();
        if (s) {
          renderStatus(s);
          renderNow(s);
          renderTasks(s);
          renderCommits(s);
        }
      }
    });
  });

  // --- boot ---------------------------------------------------------------

  (async () => {
    renderTimeline();
    const s = await fetchStatus();
    if (s) {
      renderStatus(s);
      renderNow(s);
      renderTasks(s);
      renderCommits(s);
      if (s.last_event_at) updateLastEventTime(s.last_event_at);
    }
    await refreshTerminal();
    await refreshIters();
    startSnapshotSSE();
    startActivitySSE();
    setInterval(refreshTerminal, 5000);
    setInterval(refreshIters, 5000);
    setInterval(() => {
      const el = $('last-event-time');
      if (el && lastEventAt) el.textContent = `last event: ${fmtRelative(lastEventAt)}`;
    }, 5000);
  })();
})();
