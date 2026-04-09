// Gesturo Admin — vanilla JS, single-file.
// Auth = Supabase magic link. Backend = Edge Function admin-r2.
// Server-side enforces is_admin via requireAdmin() — this client cannot grant itself anything.

const SUPABASE_URL = 'https://okhmokriethdqhsiptvu.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_fzN6wsi999QFHNvg6i9m8A_wMIfp2ys';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
});

// ── DOM helpers ─────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
function show(screen) {
  $('screen-login').classList.toggle('hidden', screen !== 'login');
  $('screen-admin').classList.toggle('hidden', screen !== 'admin');
}
function setMsg(el, text, kind) {
  el.textContent = text || '';
  el.className = 'msg' + (kind ? ' ' + kind : '');
}

// ── Auth flow ───────────────────────────────────────────────────────────────
async function init() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) onLoggedIn(session);
  else show('login');

  sb.auth.onAuthStateChange((_event, s) => {
    if (s) onLoggedIn(s);
    else show('login');
  });
}

function onLoggedIn(session) {
  $('user-email').textContent = session.user.email || '';
  show('admin');
  loadGrid();
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('login-email').value.trim().toLowerCase();
  if (!email) return;
  const btn = $('login-btn');
  btn.disabled = true;
  setMsg($('login-msg'), 'Envoi en cours…');
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin + window.location.pathname },
  });
  btn.disabled = false;
  if (error) {
    setMsg($('login-msg'), 'Erreur : ' + error.message, 'err');
  } else {
    setMsg($('login-msg'), '✓ Lien envoyé. Vérifie ta boîte mail.', 'ok');
  }
});

$('logout-btn').addEventListener('click', async () => {
  await sb.auth.signOut();
});

// ── File browser state ─────────────────────────────────────────────────────
let currentPrefix = 'Sessions/current/';   // always ends with '/'
let currentRoot   = 'Sessions/current/';   // remembers which "tab" is active
let currentFiles  = [];                    // last loaded files (for shift-click range)
const selected   = new Set();              // selected file keys (clears on navigation)

// Finder-like navHistory: back/forward navigation between visited folders.
const navHistory = [];   // visited prefixes BEFORE the current one
const navFuture  = [];   // prefixes you've gone "back" from (cleared on new navigation)

// Centralised navigation. Use this everywhere instead of touching currentPrefix
// directly so the navHistory stack stays consistent.
function navigateTo(prefix) {
  if (prefix === currentPrefix) return;
  navHistory.push(currentPrefix);
  navFuture.length = 0;
  currentPrefix = prefix;
  loadGrid();
}

function navigateBack() {
  if (navHistory.length === 0) return;
  navFuture.push(currentPrefix);
  currentPrefix = navHistory.pop();
  loadGrid();
}

function navigateForward() {
  if (navFuture.length === 0) return;
  navHistory.push(currentPrefix);
  currentPrefix = navFuture.pop();
  loadGrid();
}

function navigateUp() {
  // Strip last segment of currentPrefix. Stop at the root level (Sessions/current/ or Animations/current/).
  const parts = currentPrefix.split('/').filter(Boolean);
  if (parts.length <= 2) return; // already at "Sessions/current/" or similar
  parts.pop();
  navigateTo(parts.join('/') + '/');
}

document.querySelectorAll('.root-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    currentRoot = btn.dataset.root;
    navigateTo(currentRoot);
  });
});

$('nav-back').addEventListener('click', navigateBack);
$('nav-fwd').addEventListener('click', navigateForward);
$('nav-up').addEventListener('click', navigateUp);

// Keyboard shortcuts (Mac-style)
document.addEventListener('keydown', (e) => {
  // Ignore if user is typing in an input or modal is open
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (!$('confirm-modal').classList.contains('hidden')) return;
  if (e.metaKey && e.key === '[') { e.preventDefault(); navigateBack(); }
  else if (e.metaKey && e.key === ']') { e.preventDefault(); navigateForward(); }
  else if (e.metaKey && e.key === 'ArrowUp') { e.preventDefault(); navigateUp(); }
});

function updateNavButtons() {
  $('nav-back').disabled = navHistory.length === 0;
  $('nav-fwd').disabled  = navFuture.length === 0;
  const parts = currentPrefix.split('/').filter(Boolean);
  $('nav-up').disabled = parts.length <= 2;
}

function setActiveRoot() {
  document.querySelectorAll('.root-btn').forEach((b) => {
    b.classList.toggle('active', currentPrefix.startsWith(b.dataset.root));
  });
}

// Thumbnail proxy: wsrv.nl resizes + converts to webp on the fly, cached on their CDN.
function thumbUrl(url, w = 300) {
  return `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=${w}&output=webp&q=70`;
}

async function loadGrid() {
  const grid = $('grid');
  const msg = $('grid-msg');
  const countEl = $('result-count');
  grid.innerHTML = '';
  countEl.textContent = '';
  setMsg(msg, 'Chargement…');
  // Navigation always clears the selection — selecting across folders would be confusing.
  selected.clear();
  updateActionBar();
  setActiveRoot();
  updateNavButtons();
  renderBreadcrumb();

  const { data: { session } } = await sb.auth.getSession();
  if (!session) { setMsg(msg, 'Pas de session.', 'err'); return; }

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-r2`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_PUBLISHABLE_KEY,
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ action: 'browse', prefix: currentPrefix }),
    });
    if (res.status === 403) { setMsg(msg, 'Accès refusé — tu n\'es pas admin sur ce compte.', 'err'); return; }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setMsg(msg, `Erreur ${res.status} — ${err.error || res.statusText}`, 'err');
      return;
    }
    const data = await res.json();
    const folders = data.folders || [];
    const files = data.files || [];
    currentFiles = files;
    countEl.textContent = `${folders.length} dossiers · ${files.length} fichiers`;
    setMsg(msg, '');
    renderGrid(folders, files);
  } catch (e) {
    setMsg(msg, 'Erreur réseau : ' + e.message, 'err');
  }
}

function renderBreadcrumb() {
  const bc = $('breadcrumb');
  bc.innerHTML = '';
  // Split current prefix into clickable segments. Each segment navigates to its level.
  const parts = currentPrefix.split('/').filter(Boolean);
  let acc = '';
  parts.forEach((part, i) => {
    acc += part + '/';
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'sep'; sep.textContent = '›';
      bc.appendChild(sep);
    }
    const btn = document.createElement('button');
    btn.className = 'crumb' + (i === parts.length - 1 ? ' current' : '');
    btn.textContent = part;
    const target = acc;
    if (i < parts.length - 1) {
      btn.addEventListener('click', () => navigateTo(target));
    }
    bc.appendChild(btn);
  });
}

function renderGrid(folders, files) {
  const grid = $('grid');
  // Folders first, then files. Cap files to 500 for perf.
  for (const f of folders) {
    const card = document.createElement('div');
    card.className = 'grid-item folder';
    card.innerHTML = `<div class="icon">📁</div><div class="name">${escapeHtml(f.name)}</div><div class="hint">Ouvrir →</div>`;
    card.addEventListener('click', () => navigateTo(f.prefix));
    grid.appendChild(card);
  }
  const slice = files.slice(0, 500);
  let lastClickedIdx = -1;
  slice.forEach((it, idx) => {
    const card = document.createElement('div');
    card.className = 'grid-item' + (selected.has(it.key) ? ' selected' : '');
    card.dataset.key = it.key;
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = thumbUrl(it.url);
    img.alt = it.name;
    card.appendChild(img);
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = it.name;
    card.appendChild(label);
    const check = document.createElement('div');
    check.className = 'check';
    check.textContent = '✓';
    card.appendChild(check);

    card.addEventListener('click', (e) => {
      // Shift-click → range select from last clicked to here
      if (e.shiftKey && lastClickedIdx >= 0) {
        const [a, b] = [lastClickedIdx, idx].sort((x, y) => x - y);
        for (let i = a; i <= b; i++) selected.add(slice[i].key);
      } else {
        if (selected.has(it.key)) selected.delete(it.key);
        else selected.add(it.key);
        lastClickedIdx = idx;
      }
      // Re-render selection state without rebuilding the whole grid
      document.querySelectorAll('.grid-item[data-key]').forEach((el) => {
        el.classList.toggle('selected', selected.has(el.dataset.key));
      });
      updateActionBar();
    });

    card.addEventListener('dblclick', (e) => {
      e.preventDefault();
      // Open full-res image (not the thumbnail) in lightbox
      openLightbox(it.url);
    });

    grid.appendChild(card);
  });
  if (files.length > 500) {
    const note = document.createElement('div');
    note.className = 'msg muted';
    note.textContent = `+ ${files.length - 500} fichiers non affichés (limite UI 500).`;
    grid.appendChild(note);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── Selection / action bar ──────────────────────────────────────────────────
function updateActionBar() {
  const bar = $('action-bar');
  const count = selected.size;
  if (count === 0) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  $('selection-count').textContent = `${count} fichier${count > 1 ? 's' : ''} sélectionné${count > 1 ? 's' : ''}`;
}

$('action-clear').addEventListener('click', () => {
  selected.clear();
  document.querySelectorAll('.grid-item.selected').forEach((el) => el.classList.remove('selected'));
  updateActionBar();
});

$('action-archive').addEventListener('click', async () => {
  if (selected.size === 0) return;
  await callAdmin('archive', { keys: [...selected] }, 'Archivage en cours…');
});

$('action-delete').addEventListener('click', () => {
  if (selected.size === 0) return;
  const count = selected.size;
  openConfirm({
    title: 'Suppression définitive',
    text: `Tu vas supprimer ${count} fichier${count > 1 ? 's' : ''} DÉFINITIVEMENT du bucket R2. Cette action est irréversible.`,
    requireType: 'SUPPRIMER',
    onConfirm: async () => {
      await callAdmin('delete', { keys: [...selected] }, 'Suppression…');
    },
  });
});

// Generic backend call helper for action bar operations.
async function callAdmin(action, body, busyMsg) {
  const msg = $('grid-msg');
  setMsg(msg, busyMsg);
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { setMsg(msg, 'Pas de session.', 'err'); return; }
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-r2`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_PUBLISHABLE_KEY,
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ action, ...body }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setMsg(msg, `Erreur ${res.status} — ${err.error || res.statusText}`, 'err');
      return;
    }
    const data = await res.json();
    const okCount = data.moved ?? data.count ?? 0;
    const failCount = (data.failed && data.failed.length) || 0;
    setMsg(msg, `✓ ${okCount} ok${failCount ? ` · ${failCount} échec(s)` : ''}`, 'ok');
    // Reload current folder so the user sees the result immediately.
    loadGrid();
  } catch (e) {
    setMsg(msg, 'Erreur réseau : ' + e.message, 'err');
  }
}

// ── Lightbox ────────────────────────────────────────────────────────────────
function openLightbox(url) {
  $('lightbox-img').src = url;
  $('lightbox').classList.remove('hidden');
}
$('lightbox-close').addEventListener('click', () => $('lightbox').classList.add('hidden'));
$('lightbox').addEventListener('click', (e) => { if (e.target.id === 'lightbox') $('lightbox').classList.add('hidden'); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('lightbox').classList.add('hidden'); });

// ── Confirmation modal ──────────────────────────────────────────────────────
let confirmCallback = null;
function openConfirm({ title, text, requireType, onConfirm }) {
  $('confirm-title').textContent = title;
  $('confirm-text').textContent = text;
  const extra = $('confirm-extra');
  extra.innerHTML = '';
  const okBtn = $('confirm-ok');
  if (requireType) {
    const p = document.createElement('p');
    p.innerHTML = `Tape <strong>${escapeHtml(requireType)}</strong> pour confirmer :`;
    p.style.marginBottom = '6px';
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'confirm-input';
    input.autocomplete = 'off';
    extra.appendChild(p);
    extra.appendChild(input);
    okBtn.disabled = true;
    input.addEventListener('input', () => { okBtn.disabled = input.value !== requireType; });
    setTimeout(() => input.focus(), 50);
  } else {
    okBtn.disabled = false;
  }
  confirmCallback = onConfirm;
  $('confirm-modal').classList.remove('hidden');
}
$('confirm-cancel').addEventListener('click', () => { $('confirm-modal').classList.add('hidden'); confirmCallback = null; });
$('confirm-ok').addEventListener('click', async () => {
  $('confirm-modal').classList.add('hidden');
  if (confirmCallback) { const cb = confirmCallback; confirmCallback = null; await cb(); }
});

init();
