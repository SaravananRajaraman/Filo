'use strict';

/* Dashboard SPA — vanilla JS, no build step.
   Sections: Activity (SSE), Stats, Rules editor, Duplicates. */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const state = { rules: {}, watched: [] };

/* ---------- helpers ---------- */
function fmtTime(ts) {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString();
}
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v);
  }
  for (const k of kids) e.append(k);
  return e;
}
async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    let body = {};
    try { body = await res.json(); } catch { /* noop */ }
    throw new Error(body.error || body.reason || res.statusText);
  }
  return res.headers.get('content-type')?.includes('json') ? res.json() : res.text();
}

/* ---------- tabs ---------- */
$$('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    $$('.tab').forEach((t) => t.classList.remove('active'));
    $$('.panel').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    $('#' + tab.dataset.tab).classList.add('active');
    if (tab.dataset.tab === 'stats') loadStats();
    if (tab.dataset.tab === 'rules') loadRules();
    if (tab.dataset.tab === 'dupes') loadDupes();
  });
});

/* ---------- mode pill ---------- */
async function loadMode() {
  const { dryRun } = await api('/api/settings/dry-run');
  const pill = $('#mode-pill');
  pill.textContent = dryRun ? 'DRY-RUN' : 'LIVE';
  pill.className = 'pill ' + (dryRun ? 'dry' : 'live');
}
$('#toggle-dry').addEventListener('click', async () => {
  const { dryRun } = await api('/api/settings/dry-run');
  await api('/api/settings/dry-run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dryRun: !dryRun }),
  });
  loadMode();
});

/* ---------- activity feed ---------- */
function rowFor(a) {
  const tr = el('tr', { 'data-id': a.actionId ?? a.id ?? '' });
  tr.append(
    el('td', {}, fmtTime(a.ts)),
    el('td', { class: 'mono' }, a.original_name || ''),
    el('td', { class: 'mono' }, a.dest_path || ''),
    el('td', {}, el('span', { class: 'cat' }, a.category || 'Other'))
  );
  const actionTd = el('td', {});
  const kind = a.kind || 'move';
  const id = a.actionId ?? a.id;
  if (kind === 'move' && !a.dry_run && !a.undone) {
    const btn = el('button', { class: 'btn btn-undo' }, 'Undo');
    btn.addEventListener('click', async () => {
      btn.disabled = true; btn.textContent = '…';
      try {
        await api('/api/undo/' + id, { method: 'POST' });
        btn.textContent = 'Undone';
        tr.style.opacity = '.5';
      } catch (e) {
        btn.disabled = false; btn.textContent = 'Undo';
        alert('Undo failed: ' + e.message);
      }
    });
    actionTd.append(btn);
  } else if (kind === 'dupe') {
    actionTd.append(el('span', { class: 'cat' }, 'dupe'));
  } else if (a.dry_run) {
    actionTd.append(el('span', { class: 'hint' }, 'preview'));
  }
  tr.append(actionTd);
  return tr;
}

function prependRow(a, flash) {
  const body = $('#feed-body');
  const tr = rowFor(a);
  if (flash) tr.classList.add('new');
  body.prepend(tr);
  $('#feed-empty').style.display = 'none';
  while (body.children.length > 200) body.lastChild.remove();
}

async function loadFeed() {
  const rows = await api('/api/feed/recent?limit=100');
  $('#feed-body').innerHTML = '';
  if (!rows.length) { $('#feed-empty').style.display = 'block'; return; }
  rows.forEach((r) => prependRow(r, false));
}

function connectSSE() {
  const dot = $('#live-dot');
  const es = new EventSource('/api/feed/stream');
  es.onopen = () => { dot.classList.add('on'); dot.title = 'live'; };
  es.onerror = () => { dot.classList.remove('on'); dot.title = 'reconnecting…'; };
  es.onmessage = (ev) => {
    try {
      const a = JSON.parse(ev.data);
      prependRow(a, true);
      if ($('#stats').classList.contains('active')) loadStats();
    } catch { /* ignore keepalive */ }
  };
}

/* ---------- stats ---------- */
async function loadStats() {
  const s = await api('/api/stats');
  $('#stat-today').textContent = s.today;
  $('#stat-total').textContent = s.totalMoves;
  $('#stat-dupes').textContent = s.totalDupes;
  $('#stat-undone').textContent = s.totalUndone;
  const max = Math.max(1, ...s.byCategory.map((c) => c.n));
  const bars = $('#cat-bars');
  bars.innerHTML = '';
  if (!s.byCategory.length) { bars.append(el('p', { class: 'empty' }, 'No moves yet.')); return; }
  s.byCategory.forEach((c) => {
    const row = el('div', { class: 'bar-row' });
    row.append(
      el('span', {}, c.category || 'Other'),
      el('div', { class: 'bar-track' }, el('div', { class: 'bar-fill', style: `width:${(c.n / max) * 100}%` })),
      el('span', { class: 'mono' }, String(c.n))
    );
    bars.append(row);
  });
}

/* ---------- rules editor ---------- */
async function loadRules() {
  const data = await api('/api/rules');
  state.watched = [...data.watched];
  state.rules = { ...data.rules };
  renderRules();
}
function renderRules() {
  const wl = $('#watched-list'); wl.innerHTML = '';
  state.watched.forEach((w, i) => {
    const row = el('div', { class: 'list-row single' });
    const input = el('input', { type: 'text', value: w });
    input.addEventListener('input', () => { state.watched[i] = input.value; });
    const del = el('button', { class: 'btn btn-danger' }, 'Remove');
    del.addEventListener('click', () => { state.watched.splice(i, 1); renderRules(); });
    row.append(input, del);
    wl.append(row);
  });

  const rl = $('#rules-list'); rl.innerHTML = '';
  Object.entries(state.rules).forEach(([cat, dest]) => {
    const row = el('div', { class: 'list-row' });
    const input = el('input', { type: 'text', value: dest });
    input.addEventListener('input', () => { state.rules[cat] = input.value; });
    const del = el('button', { class: 'btn btn-danger' }, 'Remove');
    del.addEventListener('click', () => { delete state.rules[cat]; renderRules(); });
    row.append(el('span', { class: 'key' }, cat), input, del);
    rl.append(row);
  });
}
$('#watched-add').addEventListener('click', () => {
  const v = $('#watched-new').value.trim();
  if (v) { state.watched.push(v); $('#watched-new').value = ''; renderRules(); }
});
$('#rule-add').addEventListener('click', () => {
  const cat = $('#rule-cat').value.trim();
  const dest = $('#rule-dest').value.trim();
  if (cat && dest) { state.rules[cat] = dest; $('#rule-cat').value = ''; $('#rule-dest').value = ''; renderRules(); }
});
$('#rules-save').addEventListener('click', async () => {
  const status = $('#rules-status');
  status.textContent = 'Saving…';
  try {
    await api('/api/rules', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ watched: state.watched, rules: state.rules }),
    });
    status.textContent = 'Saved & reloaded ✓';
    setTimeout(() => (status.textContent = ''), 2500);
  } catch (e) {
    status.textContent = 'Error: ' + e.message;
  }
});

/* ---------- duplicates ---------- */
async function loadDupes() {
  const rows = await api('/api/duplicates');
  const body = $('#dupes-body'); body.innerHTML = '';
  if (!rows.length) { $('#dupes-empty').style.display = 'block'; return; }
  $('#dupes-empty').style.display = 'none';
  rows.slice().reverse().forEach((d) => {
    body.append(el('tr', {},
      el('td', {}, fmtTime(d.ts)),
      el('td', { class: 'mono' }, (d.src_path || '').split(/[\\/]/).pop()),
      el('td', {}, el('span', { class: 'cat' }, d.category || 'Other')),
      el('td', { class: 'mono' }, d.original_of || '—'),
      el('td', { class: 'mono' }, d.dest_path || '')
    ));
  });
}

/* ---------- boot ---------- */
loadMode();
loadFeed();
connectSSE();
