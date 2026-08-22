const STATES = ['running', 'waiting_human', 'discovered', 'pr_open', 'failed', 'skipped'];
const LABELS = {
  running: 'Working',
  claimed: 'Claimed',
  waiting_human: 'Waiting on you',
  discovered: 'Queued',
  pr_open: 'PR open',
  failed: 'Failed',
  skipped: 'Skipped',
};

const filters = { states: new Set(['running', 'waiting_human', 'discovered', 'failed']), repo: '', q: '' };
let openTaskId = null;

const $ = (id) => document.getElementById(id);
const api = (path) => fetch(path).then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))));

function ago(iso) {
  if (!iso) return '–';
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function pill(state) {
  return `<span class="pill ${state}">${LABELS[state] ?? state}</span>`;
}

function renderFilters() {
  $('state-filters').innerHTML = STATES.map(
    (state) => `<button class="chip" data-state="${state}" aria-pressed="${filters.states.has(state)}">${LABELS[state]}</button>`,
  ).join('');
  for (const chip of document.querySelectorAll('.chip')) {
    chip.addEventListener('click', () => {
      const state = chip.dataset.state;
      filters.states.has(state) ? filters.states.delete(state) : filters.states.add(state);
      chip.setAttribute('aria-pressed', String(filters.states.has(state)));
      refresh();
    });
  }
}

async function refreshOverview() {
  const data = await api('/api/overview');
  const stale = data.last_tick_at && Date.now() - new Date(data.last_tick_at).getTime() > 15 * 60_000;
  const state = stale ? 'stale' : data.status === 'paused' ? 'stale' : data.status;
  $('status-dot').className = `dot ${state}`;
  $('status-text').textContent = stale ? 'no tick in 15m' : data.status;
  $('capacity').textContent = `${data.busy}/${data.capacity} slot${data.capacity > 1 ? 's' : ''} busy`;
  $('tick').textContent = `last tick ${ago(data.last_tick_at)} ago`;

  const cards = [
    { k: 'Working', n: data.counts.running + data.counts.claimed },
    { k: 'Waiting on you', n: data.counts.waiting_human, alert: data.counts.waiting_human > 0 },
    { k: 'Queued', n: data.counts.discovered },
    { k: 'PRs open', n: data.counts.pr_open },
    { k: 'Failed', n: data.counts.failed },
    { k: 'Repositories', n: data.repos.filter((r) => r.enabled).length },
  ];
  $('stats').innerHTML = cards
    .map((c) => `<div class="stat ${c.alert ? 'alert' : ''}"><div class="n">${c.n}</div><div class="k">${c.k}</div></div>`)
    .join('');

  const select = $('repo-filter');
  const wanted = ['', ...data.repos.map((r) => r.full_name)].join('|');
  if (select.dataset.signature !== wanted) {
    select.dataset.signature = wanted;
    select.innerHTML =
      '<option value="">All repositories</option>' +
      data.repos.map((r) => `<option value="${r.full_name}">${r.full_name}</option>`).join('');
    select.value = filters.repo;
  }
}

async function refreshTasks() {
  const params = new URLSearchParams();
  if (filters.states.size) params.set('state', [...filters.states].join(','));
  if (filters.repo) params.set('repo', filters.repo);
  if (filters.q) params.set('q', filters.q);
  const tasks = await api(`/api/tasks?${params}`);

  $('empty').hidden = tasks.length > 0;
  $('task-rows').innerHTML = tasks
    .map(
      (task) => `<tr data-id="${task.id}">
        <td>${pill(task.state)}</td>
        <td class="num">#${task.number}</td>
        <td class="title">${escapeHtml(task.title)}${task.reason ? `<small>${escapeHtml(task.reason.slice(0, 120))}</small>` : ''}</td>
        <td class="w-meta">${task.repo}</td>
        <td class="w-meta">${ago(task.entered_state_at)}</td>
      </tr>`,
    )
    .join('');

  for (const row of document.querySelectorAll('#task-rows tr')) {
    row.addEventListener('click', () => openTask(Number(row.dataset.id)));
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

async function openTask(id) {
  openTaskId = id;
  const { task, events, runs } = await api(`/api/tasks/${id}`);
  $('drawer').hidden = false;
  $('scrim').hidden = false;
  $('d-title').textContent = `#${task.number} ${task.title}`;
  $('d-sub').innerHTML = `${pill(task.state)} <span class="sep">·</span> ${task.repo} <span class="sep">·</span> ${task.branch ?? 'no branch'} <span class="sep">·</span> ${ago(task.entered_state_at)} in this state`;
  $('d-issue').href = task.url;
  $('d-pr').hidden = !task.pr_url;
  if (task.pr_url) $('d-pr').href = task.pr_url;

  $('d-timeline').innerHTML = events
    .map(
      (event) => `<li class="${event.kind}"><time>${new Date(event.created_at).toLocaleString()}</time>${escapeHtml(event.message)}</li>`,
    )
    .join('');

  const run = runs[0];
  if (!run) {
    $('d-log').textContent = 'No run yet.';
    return;
  }
  const text = await fetch(`/api/runs/${run.id}/log`).then((r) => (r.ok ? r.text() : 'Log not available.'));
  $('d-log').textContent = text;
  $('d-log').scrollTop = $('d-log').scrollHeight;
}

function closeDrawer() {
  openTaskId = null;
  $('drawer').hidden = true;
  $('scrim').hidden = true;
}

async function act(action) {
  if (!openTaskId) return;
  await fetch(`/api/tasks/${openTaskId}/${action}`, { method: 'POST' });
  closeDrawer();
  refresh();
}

async function refresh() {
  try {
    await Promise.all([refreshOverview(), refreshTasks()]);
    if (openTaskId) await openTask(openTaskId);
  } catch (error) {
    $('status-dot').className = 'dot stale';
    $('status-text').textContent = 'disconnected';
  }
}

renderFilters();
$('repo-filter').addEventListener('change', (e) => {
  filters.repo = e.target.value;
  refresh();
});
let debounce;
$('search').addEventListener('input', (e) => {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    filters.q = e.target.value.trim();
    refreshTasks();
  }, 200);
});
$('d-close').addEventListener('click', closeDrawer);
$('scrim').addEventListener('click', closeDrawer);
$('d-requeue').addEventListener('click', () => act('requeue'));
$('d-skip').addEventListener('click', () => act('skip'));
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeDrawer());

refresh();
setInterval(refresh, 4000);
