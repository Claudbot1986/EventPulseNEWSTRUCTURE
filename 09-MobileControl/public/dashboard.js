/**
 * dashboard.js — minimal vanilla JS for mobile control.
 *
 * Fetches /api/status on load + every 5s. Listens to /api/stream (SSE) for
 * real-time updates. Token is read from URL ?token=... or localStorage.
 *
 * No frameworks. Single ~10KB file. Designed to work offline-on-load: shows
 * last cached snapshot, then live-replaces.
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

  function fmtRuntime(hours) {
    if (!hours || hours <= 0) return '0m';
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
    if (ms < 60000) return 'just now';
    const m = Math.floor(ms / 60000);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  function renderStatus(snap) {
    const w = snap.wrapper;
    const statusEl = $('wrapper-status');
    statusEl.textContent = w.status;
    statusEl.className = 'value status-pill status-' + w.status;
    $('wrapper-runtime').textContent = fmtRuntime(w.elapsed_hours);
    $('wrapper-iteration').textContent = String(w.iteration);
    $('wrapper-last').textContent = `${w.last_status}${w.last_exit_code !== null ? ' (rc=' + w.last_exit_code + ')' : ''}`;

    const connEl = $('connection-status');
    connEl.textContent = 'live';
    connEl.className = 'status-pill status-running';
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

  function renderActivity(snap) {
    const list = $('activity-list');
    const acts = snap.recent_activity || [];
    if (acts.length === 0) {
      list.innerHTML = '<li class="activity-item"><span class="activity-detail">— no activity yet —</span></li>';
      return;
    }
    list.innerHTML = acts
      .slice(0, 25)
      .map(
        (a) => `
        <li class="activity-item">
          <span class="activity-time">${fmtTime(a.ts)}</span>
          <span class="activity-type">${a.type.replace(/_/g, ' ')}</span>
          <span class="activity-detail">${escapeHtml(a.detail || '')}</span>
        </li>`
      )
      .join('');
  }

  async function refreshTerminal() {
    try {
      const r = await fetch('/api/terminal', { headers: HEADERS });
      if (!r.ok) {
        $('terminal-pane').textContent = `(terminal unavailable: ${r.status})`;
        return;
      }
      const j = await r.json();
      const tmuxEl = $('tmux-status');
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

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function fetchStatus() {
    try {
      const r = await fetch('/api/status', { headers: HEADERS });
      if (!r.ok) {
        const conn = $('connection-status');
        conn.textContent = r.status === 401 ? 'auth required' : 'error ' + r.status;
        conn.className = 'status-pill status-failed';
        return null;
      }
      return await r.json();
    } catch (err) {
      console.error('fetch status', err);
      return null;
    }
  }

  function startSSE() {
    const url = '/api/stream?token=' + encodeURIComponent(TOKEN);
    const es = new EventSource(url);
    es.onmessage = (e) => {
      try {
        const snap = JSON.parse(e.data);
        renderStatus(snap);
        renderTasks(snap);
        renderCommits(snap);
        renderActivity(snap);
      } catch (err) {
        console.error('sse parse', err);
      }
    };
    es.onerror = () => {
      const conn = $('connection-status');
      conn.textContent = 'reconnecting…';
      conn.className = 'status-pill status-unknown';
    };
  }

  // (tab buttons removed — Tasks card now shows a single unified list)

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
          renderTasks(s);
          renderCommits(s);
          renderActivity(s);
        }
      }
    });
  });

  (async () => {
    const s = await fetchStatus();
    if (s) {
      renderStatus(s);
      renderTasks(s);
      renderCommits(s);
      renderActivity(s);
    }
    await refreshTerminal();
    startSSE();
    setInterval(refreshTerminal, 10000);
  })();
})();