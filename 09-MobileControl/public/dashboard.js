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

  function renderTasks(snap) {
    const list = $('task-list');
    const countEl = $('tasks-count');
    let tasks = (snap.tasks || []).slice(0, 20);
    const activeId = snap.currently_active_task || null;

    if (countEl) countEl.textContent = `${tasks.length} of ${(snap.tasks || []).length}`;

    if (tasks.length === 0) {
      list.innerHTML = '<li class="task-item"><span class="task-title">— no tasks —</span></li>';
      return;
    }

    list.innerHTML = tasks
      .map((t) => {
        const indicatorClass =
          t.status === 'done' ? 'done' :
          (activeId && t.id === activeId) ? 'active' :
          'idle';
        return `
        <li class="task-item">
          <span class="indicator ${indicatorClass}"></span>
          <div class="task-body">
            <span class="task-prio ${t.priority}">${t.priority}</span>
            <span class="task-id">${t.id}</span>
            <div class="task-title">${escapeHtml(t.title)}</div>
          </div>
        </li>`;
      })
      .join('');
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
    // even when the wrapper isn't producing snapshot diffs.
    snapshotTimer = setInterval(async () => {
      const s = await fetchStatus();
      if (s) {
        renderStatus(s);
        renderNow(s);
        renderTasks(s);
        renderCommits(s);
        if (s.last_event_at) updateLastEventTime(s.last_event_at);
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
      // EventSource auto-reconnects; connection pill reflects this
      setConnection('disconnected', 'activity stream lost — reconnecting…');
    };
  }

  // --- modal: send instructions / add task / interactive terminal -------

  const modal = $('modal-backdrop');
  const modalTitle = $('modal-title');
  const modalInput = $('modal-input');
  let modalAction = null;

  function openModal(title, action, placeholder) {
    modalTitle.textContent = title;
    modalInput.placeholder = placeholder || '';
    modalInput.value = '';
    modalAction = action;
    modal.hidden = false;
    modalInput.focus();
  }
  function closeModal() {
    modal.hidden = true;
    modalAction = null;
  }
  $('modal-cancel').addEventListener('click', closeModal);
  $('modal-submit').addEventListener('click', async () => {
    if (!modalAction) return;
    const value = modalInput.value.trim();
    if (!value) { closeModal(); return; }
    try {
      await modalAction(value);
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
          async (msg) => postJson('/api/instruct', { message: msg }),
          'Type your instruction for the lead agent…'
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
    startSnapshotSSE();
    startActivitySSE();
    setInterval(refreshTerminal, 5000);
    setInterval(() => {
      const el = $('last-event-time');
      if (el && lastEventAt) el.textContent = `last event: ${fmtRelative(lastEventAt)}`;
    }, 5000);
  })();
})();
