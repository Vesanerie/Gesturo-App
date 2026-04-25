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

// Format a byte count into a human-readable string (KB / MB / GB).
function formatBytes(n) {
  if (!n || n < 0) return '0 B';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
  return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

// Toast notifications: stackable, auto-dismiss. kind = 'ok' | 'err' | undefined.
function toast(text, kind, durationMs = 4000) {
  const container = $('toasts');
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.textContent = text;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('fade');
    setTimeout(() => el.remove(), 300);
  }, durationMs);
}
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
  // Stats globales : auto-load après un petit délai pour ne pas bloquer le premier render.
  setTimeout(loadGlobalStats, 800);
  // Moderation badge: fetch pending count
  setTimeout(async () => {
    try {
      const data = await callUserData('adminListPosts', { filter: 'pending', limit: 1 });
      const badge = $('mod-badge');
      if (data.pendingCount > 0) { badge.textContent = data.pendingCount; badge.classList.remove('hidden'); }
      else badge.classList.add('hidden');
    } catch {}
  }, 1200);
}

async function loadGlobalStats() {
  const el = $('global-stats');
  el.textContent = '📊 Calcul…';
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-r2`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_PUBLISHABLE_KEY,
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ action: 'stats' }),
    });
    if (!res.ok) { el.textContent = '📊 erreur'; return; }
    const data = await res.json();
    if (!data || !data.roots) { el.textContent = '📊 erreur'; return; }
    const s = data.roots['Sessions/'] || { count: 0, bytes: 0 };
    const a = data.roots['Animations/'] || { count: 0, bytes: 0 };
    const total = s.bytes + a.bytes;
    el.textContent = `📊 Photos ${formatBytes(s.bytes)} (${s.count}) · Anim ${formatBytes(a.bytes)} (${a.count}) · Total ${formatBytes(total)}`;
  } catch {
    el.textContent = '📊 erreur';
  }
}
document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('global-stats');
  if (el) el.addEventListener('click', loadGlobalStats);
});

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

// Custom MIME type used to distinguish in-app drags (file → folder moves)
// from OS file drops (uploads). The dataTransfer carries a JSON array of keys.
const IN_APP_MIME = 'application/x-gesturo-keys';

// ── File browser state ─────────────────────────────────────────────────────
let currentPrefix = 'Sessions/current/';   // always ends with '/'
let currentRoot   = 'Sessions/current/';   // remembers which "tab" is active
let currentFolders = [];                   // last loaded folders (raw, unfiltered)
let currentFiles  = [];                    // last loaded files (raw, unfiltered)
let displayedFiles = [];                   // filtered+sorted files (for shift-click range)
let searchQuery = '';                      // current search filter (lowercase)
let sortMode = 'name-asc';                 // current sort mode
const selected    = new Set();             // selected ids (file keys + folder prefixes), persistent cross-folder
const selectedSize = new Map();            // id → bytes, pour calculer le total même après navigation
let thumbSize = localStorage.getItem('admin-thumb-size') || 'M'; // S | M | L

// Finder-like navHistory: back/forward navigation between visited folders.
const navHistory = [];   // visited prefixes BEFORE the current one
const navFuture  = [];   // prefixes you've gone "back" from (cleared on new navigation)

// Pending message to display AFTER the next loadGrid() finishes rendering.
// Used so action confirmations ("✓ 12 ok") aren't immediately wiped by the
// "Chargement…" placeholder that loadGrid() sets at the start.
let pendingMsg = null;

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

document.querySelectorAll('.root-btn[data-root]').forEach((btn) => {
  btn.addEventListener('click', () => {
    currentRoot = btn.dataset.root;
    navigateTo(currentRoot);
  });
});

// Toggle current ↔ archive on the active family (Sessions or Animations).
// Lets the user reach Sessions/archive/ and Animations/archive/, which were
// otherwise unreachable from the UI (and made the unarchive flow dead code).
$('archive-toggle').addEventListener('click', () => {
  const family = currentPrefix.startsWith('Animations/') ? 'Animations/' : 'Sessions/';
  const inArchive = currentPrefix.startsWith(family + 'archive/');
  const target = family + (inArchive ? 'current/' : 'archive/');
  currentRoot = target;
  navigateTo(target);
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
  // Mark Photos / Animations active based on the FAMILY of currentPrefix
  // (Sessions/* or Animations/*), so the right tab stays lit even when
  // browsing the archive zone of that family.
  const family = currentPrefix.startsWith('Animations/') ? 'Animations/' : 'Sessions/';
  document.querySelectorAll('.root-btn[data-root]').forEach((b) => {
    b.classList.toggle('active', b.dataset.root.startsWith(family));
  });
  const inArchive = currentPrefix.startsWith(family + 'archive/');
  $('archive-toggle').classList.toggle('active', inArchive);
}

// Thumbnail proxy: wsrv.nl resizes + converts to webp on the fly, cached on their CDN.
const THUMB_PROXY = 'https://wsrv.nl';
function thumbUrl(url, w = 300) {
  return `${THUMB_PROXY}/?url=${encodeURIComponent(url)}&w=${w}&output=webp&q=70`;
}

async function loadGrid() {
  const grid = $('grid');
  const msg = $('grid-msg');
  const countEl = $('result-count');
  grid.innerHTML = '<div class="grid-loader"><div class="grid-spinner"></div></div>';
  countEl.textContent = '';
  setMsg(msg, '');
  // La sélection persiste à travers les navigations (cross-folder).
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
    if (res.status === 401) {
      setMsg(msg, 'Session expirée — reconnecte-toi.', 'err');
      toast('Session expirée. Recharge la page.', 'err', 8000);
      return;
    }
    if (res.status === 403) { setMsg(msg, 'Accès refusé — tu n\'es pas admin sur ce compte.', 'err'); return; }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setMsg(msg, `Erreur ${res.status} — ${err.error || res.statusText}`, 'err');
      return;
    }
    const data = await res.json();
    currentFolders = data.folders || [];
    currentFiles = data.files || [];
    if (pendingMsg) {
      setMsg(msg, pendingMsg.text, pendingMsg.kind);
      const captured = pendingMsg;
      pendingMsg = null;
      // Auto-clear after a few seconds, but only if nothing else has overwritten it.
      setTimeout(() => { if (msg.textContent === captured.text) setMsg(msg, ''); }, 4000);
    } else {
      setMsg(msg, '');
    }
    applyAndRender();
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
    // Every breadcrumb segment is also a drop target for in-app moves.
    attachDropTarget(btn, target);
    bc.appendChild(btn);
  });
}

// Attach in-app drop handlers to a node so it accepts files dragged from grid items.
// `destPrefix` is where the dropped keys will be moved to.
function attachDropTarget(node, destPrefix) {
  node.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes(IN_APP_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    node.classList.add('drop-hover');
  });
  node.addEventListener('dragleave', () => node.classList.remove('drop-hover'));
  node.addEventListener('drop', async (e) => {
    if (!e.dataTransfer.types.includes(IN_APP_MIME)) return;
    e.preventDefault();
    e.stopPropagation();
    node.classList.remove('drop-hover');
    let keys = [];
    try { keys = JSON.parse(e.dataTransfer.getData(IN_APP_MIME)); } catch {}
    if (!Array.isArray(keys) || keys.length === 0) return;
    // Don't move into the same folder (would be a no-op or duplicate-name conflict).
    const allAlreadyThere = keys.every((k) => {
      const parent = k.slice(0, k.lastIndexOf('/') + 1);
      return parent === destPrefix;
    });
    if (allAlreadyThere) return;
    if (keys.length >= BULK_CONFIRM_THRESHOLD) {
      const preview = keys.slice(0, 5).map((k) => k.split('/').pop()).join(', ')
        + (keys.length > 5 ? ` … (+${keys.length - 5} autres)` : '');
      openConfirm({
        title: `Déplacer ${keys.length} fichiers`,
        text: `Tu vas déplacer ${keys.length} fichiers vers :\n${destPrefix}\n\nAperçu : ${preview}`,
        onConfirm: async () => callAdmin('move', { keys, destPrefix }, `Déplacement vers ${destPrefix}…`),
      });
      return;
    }
    await callAdmin('move', { keys, destPrefix }, `Déplacement vers ${destPrefix}…`);
  });
}

// Apply current search filter + sort to currentFolders/currentFiles, then render.
// Called by loadGrid (after fetch) and by the search/sort handlers.
function applyAndRender() {
  const q = searchQuery.trim().toLowerCase();
  const folders = q ? currentFolders.filter((f) => f.name.toLowerCase().includes(q)) : currentFolders.slice();
  let files = q ? currentFiles.filter((f) => f.name.toLowerCase().includes(q)) : currentFiles.slice();
  files.sort((a, b) => {
    switch (sortMode) {
      case 'name-desc': return b.name.localeCompare(a.name);
      case 'size-desc': return (b.size || 0) - (a.size || 0);
      case 'size-asc':  return (a.size || 0) - (b.size || 0);
      default:          return a.name.localeCompare(b.name);
    }
  });
  displayedFiles = files;
  const totalBytes = files.reduce((acc, f) => acc + (f.size || 0), 0);
  const sizeStr = totalBytes > 0 ? ` · ${formatBytes(totalBytes)}` : '';
  $('result-count').textContent = `${folders.length} dossiers · ${files.length} fichiers${sizeStr}`;
  renderGrid(folders, files);
}

function renderGrid(folders, files) {
  const grid = $('grid');
  grid.innerHTML = '';
  // Folders first, then files. Cap files to 500 for perf.
  for (const f of folders) {
    const card = document.createElement('div');
    card.className = 'grid-item folder' + (selected.has(f.prefix) ? ' selected' : '');
    card.dataset.prefix = f.prefix;
    card.innerHTML = `<div class="icon">📁</div><div class="name">${escapeHtml(f.name)}</div><div class="hint">Ouvrir →</div>`;
    card.addEventListener('click', () => navigateTo(f.prefix));
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openCtxMenu(e.clientX, e.clientY, { folder: f });
    });
    // Folders are valid drop targets for in-app moves.
    attachDropTarget(card, f.prefix);
    grid.appendChild(card);
  }
  const slice = files.slice(0, 2000);
  let lastClickedIdx = -1;
  slice.forEach((it, idx) => {
    const card = document.createElement('div');
    card.className = 'grid-item' + (selected.has(it.key) ? ' selected' : '');
    card.dataset.key = it.key;
    card.dataset.size = String(it.size || 0);
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = thumbUrl(it.url);
    img.alt = it.name;
    card.appendChild(img);
    if (it.size) {
      const badge = document.createElement('div');
      badge.className = 'size-badge';
      badge.textContent = formatBytes(it.size);
      card.appendChild(badge);
    }
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = it.name;
    card.appendChild(label);
    const check = document.createElement('div');
    check.className = 'check';
    check.textContent = '✓';
    card.appendChild(check);

    card.addEventListener('click', (e) => {
      // Shift-click ou Cmd/Ctrl-click → mode sélection multi
      if (e.shiftKey && lastClickedIdx >= 0) {
        const [a, b] = [lastClickedIdx, idx].sort((x, y) => x - y);
        for (let i = a; i <= b; i++) selectAdd(slice[i].key, slice[i].size || 0);
      } else if (e.metaKey || e.ctrlKey) {
        // Cmd/Ctrl-click → toggle sélection sans perdre les autres
        if (selected.has(it.key)) selectDelete(it.key);
        else selectAdd(it.key, it.size || 0);
        lastClickedIdx = idx;
      } else if (selected.size > 0) {
        // Clic simple SANS modifier + sélection existante → toggle comme avant
        if (selected.has(it.key)) selectDelete(it.key);
        else selectAdd(it.key, it.size || 0);
        lastClickedIdx = idx;
      } else {
        // Clic simple, rien de sélectionné → ouvrir la lightbox directement
        openLightbox(it.url);
        return;
      }
      // Re-render selection state without rebuilding the whole grid
      document.querySelectorAll('.grid-item[data-key]').forEach((el) => {
        el.classList.toggle('selected', selected.has(el.dataset.key));
      });
      updateActionBar();
    });

    // In-app drag: allow dragging files onto folders / breadcrumbs to move them.
    // If the dragged file is part of the current selection, move the whole
    // selection. Otherwise just the single dragged file.
    card.draggable = true;
    card.addEventListener('dragstart', (e) => {
      const fileKeysOnly = [...selected].filter((id) => !id.endsWith('/'));
      const keysToMove = selected.has(it.key) && fileKeysOnly.length > 0 ? fileKeysOnly : [it.key];
      e.dataTransfer.setData(IN_APP_MIME, JSON.stringify(keysToMove));
      e.dataTransfer.effectAllowed = 'move';
    });

    // Right-click → context menu. If the file isn't already selected, select
    // just it before opening the menu (Finder behavior).
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!selected.has(it.key)) {
        selectClearAll();
        selectAdd(it.key, it.size || 0);
        document.querySelectorAll('.grid-item[data-key]').forEach((el) => {
          el.classList.toggle('selected', selected.has(el.dataset.key));
        });
        updateActionBar();
      }
      openCtxMenu(e.clientX, e.clientY, { url: it.url });
    });

    grid.appendChild(card);
  });
  if (files.length > 2000) {
    const note = document.createElement('div');
    note.className = 'msg muted';
    note.textContent = `+ ${files.length - 2000} fichiers non affichés (limite UI 2000). Affine la recherche.`;
    grid.appendChild(note);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Wrappers pour garder `selectedSize` à jour en parallèle de `selected`.
function selectAdd(id, size) {
  selected.add(id);
  if (size != null) selectedSize.set(id, size);
}
function selectDelete(id) {
  selected.delete(id);
  selectedSize.delete(id);
}
function selectClearAll() {
  selected.clear();
  selectedSize.clear();
}

// Split la sélection en { keys, prefixes } — les prefixes finissent par '/'.
function splitSelection() {
  const keys = [];
  const prefixes = [];
  for (const id of selected) {
    if (id.endsWith('/')) prefixes.push(id);
    else keys.push(id);
  }
  return { keys, prefixes };
}

// Lance une action sur la sélection mixte (fichiers + dossiers).
// Le backend admin-r2 accepte EITHER {keys} OR {prefix} par appel — donc on
// fait 1 appel pour les fichiers + 1 appel par dossier, en parallèle.
// Agrège les résultats en UN SEUL toast et fait UN SEUL loadGrid à la fin.
async function callAdminOnSelection(action, busyMsg) {
  const { keys, prefixes } = splitSelection();
  if (keys.length === 0 && prefixes.length === 0) return;
  if (busyMsg) toast(busyMsg);
  const calls = [];
  if (keys.length > 0) calls.push(rawCallAdmin(action, { keys }));
  for (const prefix of prefixes) calls.push(rawCallAdmin(action, { prefix }));
  const results = await Promise.all(calls);
  let totalOk = 0, totalFail = 0, networkErrors = 0;
  for (const r of results) {
    if (r.networkError) { networkErrors++; continue; }
    if (r.httpError) { totalFail++; continue; }
    totalOk += r.ok || 0;
    totalFail += r.failed || 0;
  }
  if (networkErrors > 0) {
    toast(`Erreur réseau sur ${networkErrors} appel(s)`, 'err', 6000);
  } else {
    toast(
      `✓ ${totalOk} ok${totalFail ? ` · ${totalFail} échec(s)` : ''}`,
      totalFail ? 'err' : 'ok',
    );
  }
  // Vider la sélection après une action réussie pour éviter les items fantômes.
  selectClearAll();
  updateActionBar();
  loadGrid();
}

// Variante "raw" de callAdmin : ne déclenche ni toast ni loadGrid, retourne
// un résultat structuré utilisable par l'agrégateur callAdminOnSelection.
async function rawCallAdmin(action, body) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return { networkError: true };
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
    if (!res.ok) return { httpError: true, status: res.status };
    const data = await res.json();
    return {
      ok: data.moved ?? data.count ?? 0,
      failed: (data.failed && data.failed.length) || 0,
    };
  } catch {
    return { networkError: true };
  }
}

// ── Selection / action bar ──────────────────────────────────────────────────
function updateActionBar() {
  const bar = $('action-bar');
  const count = selected.size;
  if (count === 0) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  const { keys, prefixes } = splitSelection();
  let totalBytes = 0;
  for (const k of keys) totalBytes += selectedSize.get(k) || 0;
  const sizeStr = totalBytes > 0 ? ` · ${formatBytes(totalBytes)}` : '';
  const parts = [];
  if (keys.length > 0) parts.push(`${keys.length} fichier${keys.length > 1 ? 's' : ''}`);
  if (prefixes.length > 0) parts.push(`${prefixes.length} dossier${prefixes.length > 1 ? 's' : ''}`);
  $('selection-count').textContent = `${parts.join(' · ')}${sizeStr}`;
  // In archive zones, show Restaurer instead of Archiver.
  const inArchive = currentPrefix.includes('/archive/');
  $('action-restore').style.display = inArchive ? '' : 'none';
  $('action-archive').style.display = inArchive ? 'none' : '';
}

function confirmBulkIfNeeded(verb, action, busyMsg) {
  const count = selected.size;
  if (count === 0) return;
  if (count < BULK_CONFIRM_THRESHOLD) {
    callAdminOnSelection(action, busyMsg);
    return;
  }
  openConfirm({
    title: `${verb} ${count} éléments`,
    text: `Tu vas ${verb.toLowerCase()} ${count} éléments en une fois.\n\nAperçu : ${buildSelectionPreview()}`,
    onConfirm: async () => callAdminOnSelection(action, busyMsg),
  });
}

document.getElementById('action-restore').addEventListener('click', () => {
  confirmBulkIfNeeded('Restaurer', 'unarchive', 'Restauration…');
});

$('action-clear').addEventListener('click', () => {
  selectClearAll();
  document.querySelectorAll('.grid-item.selected').forEach((el) => el.classList.remove('selected'));
  updateActionBar();
});

$('action-archive').addEventListener('click', () => {
  confirmBulkIfNeeded('Archiver', 'archive', 'Archivage en cours…');
});

$('action-delete').addEventListener('click', () => {
  if (selected.size === 0) return;
  const { keys, prefixes } = splitSelection();
  const parts = [];
  if (keys.length) parts.push(`${keys.length} fichier${keys.length > 1 ? 's' : ''}`);
  if (prefixes.length) parts.push(`${prefixes.length} dossier${prefixes.length > 1 ? 's' : ''} (et tout leur contenu)`);
  openConfirm({
    title: 'Suppression définitive',
    text: `Tu vas supprimer ${parts.join(' + ')} DÉFINITIVEMENT du bucket R2. Cette action est irréversible.\n\nAperçu : ${buildSelectionPreview()}`,
    requireType: 'SUPPRIMER',
    onConfirm: async () => {
      await callAdminOnSelection('delete', 'Suppression…');
    },
  });
});

// Seuil au-delà duquel toute action en masse demande une confirmation.
const BULK_CONFIRM_THRESHOLD = 50;

// Build une preview des N premiers noms de fichiers/dossiers de la sélection.
function buildSelectionPreview(max = 5) {
  const items = [...selected].map((id) => {
    if (id.endsWith('/')) {
      const parts = id.split('/').filter(Boolean);
      return '📁 ' + parts[parts.length - 1];
    }
    return id.split('/').pop();
  });
  const head = items.slice(0, max).join(', ');
  const more = items.length > max ? ` … (+${items.length - max} autres)` : '';
  return head + more;
}

// Generic backend call helper for action bar operations.
async function callAdmin(action, body, busyMsg) {
  if (busyMsg) toast(busyMsg);
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { toast('Pas de session.', 'err'); return; }
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
      toast(`Erreur ${res.status} — ${err.error || res.statusText}`, 'err', 6000);
      return;
    }
    const data = await res.json();
    const okCount = data.moved ?? data.count ?? 0;
    const failCount = (data.failed && data.failed.length) || 0;
    toast(
      `✓ ${okCount} ok${failCount ? ` · ${failCount} échec(s)` : ''}`,
      failCount ? 'err' : 'ok',
    );
    selectClearAll();
    updateActionBar();
    loadGrid();
  } catch (e) {
    toast('Erreur réseau : ' + e.message, 'err', 6000);
  }
}

// ── Lightbox ────────────────────────────────────────────────────────────────
let lightboxIdx = -1;
function openLightbox(url) {
  // Find index in displayedFiles to enable prev/next navigation.
  lightboxIdx = displayedFiles.findIndex((f) => f.url === url);
  showLightboxAt(lightboxIdx >= 0 ? lightboxIdx : 0, url);
  $('lightbox').classList.remove('hidden');
}
function showLightboxAt(idx, fallbackUrl) {
  const file = displayedFiles[idx];
  const img = $('lightbox-img');
  const url = file ? file.url : fallbackUrl;
  img.src = url;
  // Update metadata panel. Dimensions are filled in once the image loads.
  const nameEl = $('lightbox-meta-name');
  const infoEl = $('lightbox-meta-info');
  if (file) {
    nameEl.textContent = file.name;
    const sizeStr = formatBytes(file.size || 0);
    infoEl.textContent = `${sizeStr} · ${file.key}`;
    img.onload = () => {
      if ($('lightbox-img').src !== url) return; // user already moved on
      infoEl.textContent = `${img.naturalWidth}×${img.naturalHeight} · ${sizeStr} · ${file.key}`;
    };
  } else {
    nameEl.textContent = '';
    infoEl.textContent = '';
  }
}
function lightboxStep(delta) {
  if (displayedFiles.length === 0) return;
  if (lightboxIdx < 0) lightboxIdx = 0;
  lightboxIdx = (lightboxIdx + delta + displayedFiles.length) % displayedFiles.length;
  showLightboxAt(lightboxIdx);
}
$('lightbox-meta-copy').addEventListener('click', async (e) => {
  e.stopPropagation();
  const file = displayedFiles[lightboxIdx];
  if (!file) return;
  try {
    await navigator.clipboard.writeText(file.key);
    toast('Key copiée', 'ok', 2000);
  } catch {
    toast('Impossible de copier', 'err');
  }
});
$('lightbox-close').addEventListener('click', () => $('lightbox').classList.add('hidden'));
$('lightbox-prev').addEventListener('click', (e) => { e.stopPropagation(); lightboxStep(-1); });
$('lightbox-next').addEventListener('click', (e) => { e.stopPropagation(); lightboxStep(1); });
$('lightbox').addEventListener('click', (e) => { if (e.target.id === 'lightbox') $('lightbox').classList.add('hidden'); });
document.addEventListener('keydown', (e) => {
  if ($('lightbox').classList.contains('hidden')) return;
  if (e.key === 'Escape') $('lightbox').classList.add('hidden');
  else if (e.key === 'ArrowLeft') lightboxStep(-1);
  else if (e.key === 'ArrowRight') lightboxStep(1);
});

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
// ── Drag & drop upload ─────────────────────────────────────────────────────
// Browser-wide drag tracking. We use a counter because dragenter/dragleave fire
// for every child element entering/leaving, and we want to detect "really left"
// only when the counter reaches 0.
let dragCounter = 0;
const screenAdmin = $('screen-admin');

screenAdmin.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer || !e.dataTransfer.types.includes('Files')) return;
  if (e.dataTransfer.types.includes(IN_APP_MIME)) return; // in-app move, not an upload
  e.preventDefault();
  dragCounter++;
  $('drop-prefix').textContent = currentPrefix;
  $('drop-overlay').classList.add('visible');
});

screenAdmin.addEventListener('dragover', (e) => {
  if (!e.dataTransfer || !e.dataTransfer.types.includes('Files')) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});

screenAdmin.addEventListener('dragleave', (e) => {
  if (!e.dataTransfer || !e.dataTransfer.types.includes('Files')) return;
  dragCounter--;
  if (dragCounter <= 0) {
    dragCounter = 0;
    $('drop-overlay').classList.remove('visible');
  }
});

screenAdmin.addEventListener('drop', async (e) => {
  if (!e.dataTransfer || !e.dataTransfer.types.includes('Files')) return;
  e.preventDefault();
  dragCounter = 0;
  $('drop-overlay').classList.remove('visible');

  // Use webkitGetAsEntry to walk directories. items[].webkitGetAsEntry()
  // returns FileSystemEntry which can be a file or a directory; for directories
  // we recurse and yield every leaf file with its relative path.
  const items = [...e.dataTransfer.items];
  const entries = items
    .map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null))
    .filter(Boolean);

  let collected = [];
  if (entries.length > 0) {
    $('upload-bar').classList.remove('hidden');
    $('upload-status').textContent = 'Lecture des dossiers…';
    $('upload-count').textContent = '';
    $('upload-progress-fill').style.width = '0%';
    for (const entry of entries) {
      collected = collected.concat(await walkEntry(entry, ''));
    }
  } else {
    // Fallback (rare): no items API → use plain files (no folder support).
    collected = [...e.dataTransfer.files]
      .filter((f) => !f.name.startsWith('.'))
      .map((file) => ({ file, path: file.name }));
  }

  // Drop hidden files (.DS_Store, ._foo etc.)
  collected = collected.filter((c) => !c.path.split('/').some((seg) => seg.startsWith('.')));

  if (collected.length === 0) {
    $('upload-bar').classList.add('hidden');
    return;
  }
  await uploadFiles(collected, currentPrefix);
});

// Recursively walk a FileSystemEntry. Returns [{ file, path }] for every leaf file,
// where `path` is the path relative to the dropped root.
async function walkEntry(entry, basePath) {
  if (!entry) return [];
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    return [{ file, path: basePath + file.name }];
  }
  if (entry.isDirectory) {
    const reader = entry.createReader();
    let allEntries = [];
    // readEntries returns chunks of 100, so loop until empty
    while (true) {
      const chunk = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
      if (!chunk.length) break;
      allEntries = allEntries.concat(chunk);
    }
    let out = [];
    for (const child of allEntries) {
      out = out.concat(await walkEntry(child, basePath + entry.name + '/'));
    }
    return out;
  }
  return [];
}

// uploadFiles takes an array of { file, path } where path is the relative
// path inside the dropped folder (or just the filename for individual files).
async function uploadFiles(items, targetPrefix) {
  const bar = $('upload-bar');
  const fill = $('upload-progress-fill');
  const status = $('upload-status');
  const counter = $('upload-count');
  bar.classList.remove('hidden');
  status.textContent = 'Préparation…';
  counter.textContent = `0 / ${items.length}`;
  fill.style.width = '0%';

  const { data: { session } } = await sb.auth.getSession();
  if (!session) { status.textContent = 'Pas de session.'; return; }

  // Step 1: ask backend for presigned PUT URLs in batches of 100 (backend cap).
  let urls = [];
  try {
    const BATCH = 100;
    for (let i = 0; i < items.length; i += BATCH) {
      const slice = items.slice(i, i + BATCH);
      const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-r2`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_PUBLISHABLE_KEY,
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          action: 'upload-urls',
          prefix: targetPrefix,
          files: slice.map(({ file, path }) => ({
            name: file.name,
            path,
            contentType: file.type || 'application/octet-stream',
          })),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        status.textContent = `Erreur ${res.status} — ${err.error || res.statusText}`;
        setTimeout(() => bar.classList.add('hidden'), 4000);
        return;
      }
      urls = urls.concat((await res.json()).uploads || []);
    }
  } catch (e) {
    status.textContent = 'Erreur réseau : ' + e.message;
    setTimeout(() => bar.classList.add('hidden'), 4000);
    return;
  }

  // Step 2: upload each file to its presigned URL with bounded concurrency.
  status.textContent = 'Upload en cours…';
  let done = 0;
  let failed = 0;
  const MAX_CONCURRENT = 4;
  const queue = items.map(({ file }, i) => ({ file, upload: urls[i] }));
  const next = async () => {
    while (queue.length) {
      const { file, upload } = queue.shift();
      if (!upload) { failed++; continue; }
      try {
        const res = await fetch(upload.url, {
          method: 'PUT',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file,
        });
        if (!res.ok) failed++;
      } catch {
        failed++;
      }
      done++;
      counter.textContent = `${done} / ${items.length}`;
      fill.style.width = `${(done / items.length) * 100}%`;
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT, items.length) }, next));

  // Step 3: report and reload.
  if (failed === 0) status.textContent = `✓ ${done} fichier(s) uploadé(s)`;
  else status.textContent = `${done - failed} ok · ${failed} échec(s)`;
  setTimeout(() => bar.classList.add('hidden'), 2500);
  loadGrid();
}

// ── Context menu (clic droit) ──────────────────────────────────────────────
// Holds the target of the menu: { url } for a file, or { folder: {prefix,name} } for a folder.
let ctxTarget = null;

function openCtxMenu(x, y, target) {
  ctxTarget = target;
  const menu = $('ctx-menu');
  // For a folder, "Ouvrir" means navigate into it (not lightbox).
  const openBtn = menu.querySelector('[data-act="open"]');
  openBtn.textContent = target.folder ? '📂 Ouvrir' : '👁 Ouvrir';
  // Restaurer is only relevant when browsing inside an archive zone.
  // Conversely, Archiver is hidden inside archive zones (would be a no-op).
  const inArchive = currentPrefix.includes('/archive/');
  menu.querySelector('[data-act="restore"]').style.display  = inArchive ? '' : 'none';
  menu.querySelector('[data-act="archive"]').style.display  = inArchive ? 'none' : '';
  // Rename: visible for a single folder or a single-file selection.
  const canRename = !!target.folder || (selected.size === 1);
  menu.querySelector('[data-act="rename"]').style.display = canRename ? '' : 'none';
  menu.style.left = Math.min(x, window.innerWidth - 180) + 'px';
  menu.style.top  = Math.min(y, window.innerHeight - 140) + 'px';
  menu.classList.remove('hidden');
}

document.querySelectorAll('#ctx-menu .ctx-item').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const action = btn.dataset.act;
    const target = ctxTarget;
    $('ctx-menu').classList.add('hidden');
    if (!target) return;

    // ── Folder target ──────────────────────────────────────────────────────
    if (target.folder) {
      const { prefix, name } = target.folder;
      if (action === 'open') { navigateTo(prefix); return; }
      if (action === 'rename') { promptRenameFolder(prefix, name); return; }
      if (action === 'restore') {
        await callAdmin('unarchive', { prefix }, 'Restauration du dossier…');
        return;
      }
      if (action === 'archive') {
        openConfirm({
          title: `Archiver le dossier "${name}"`,
          text: `Tous les fichiers sous ${prefix} seront déplacés vers archive/. C'est réversible (les fichiers restent dans R2).`,
          onConfirm: async () => callAdmin('archive', { prefix }, 'Archivage du dossier…'),
        });
        return;
      }
      if (action === 'delete') {
        openConfirm({
          title: `Supprimer le dossier "${name}"`,
          text: `Tous les fichiers sous ${prefix} seront supprimés DÉFINITIVEMENT. Cette action est irréversible.`,
          requireType: 'SUPPRIMER',
          onConfirm: async () => callAdmin('delete', { prefix }, 'Suppression du dossier…'),
        });
      }
      return;
    }

    // ── File target (acts on the current selection, like Finder) ──────────
    if (action === 'open') { openLightbox(target.url); return; }
    if (action === 'rename') {
      // Rename only ever acts on a single file (the right-clicked one).
      const key = [...selected][0];
      if (key) promptRenameFile(key);
      return;
    }
    if (action === 'restore') {
      await callAdmin('unarchive', { keys: [...selected] }, 'Restauration…');
      return;
    }
    if (action === 'archive') {
      await callAdmin('archive', { keys: [...selected] }, 'Archivage…');
      return;
    }
    if (action === 'delete') {
      const count = selected.size;
      openConfirm({
        title: 'Suppression définitive',
        text: `Tu vas supprimer ${count} fichier${count > 1 ? 's' : ''} DÉFINITIVEMENT du bucket R2. Cette action est irréversible.`,
        requireType: 'SUPPRIMER',
        onConfirm: async () => callAdmin('delete', { keys: [...selected] }, 'Suppression…'),
      });
    }
  });
});

// Click ailleurs / Escape → ferme le menu
document.addEventListener('click', (e) => {
  if (!e.target.closest('#ctx-menu')) $('ctx-menu').classList.add('hidden');
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $('ctx-menu').classList.add('hidden');
});

// ── Bouton "Ajouter" (alternative au drag & drop) ──────────────────────────
$('add-btn').addEventListener('click', () => $('add-input').click());
$('add-input').addEventListener('change', async (e) => {
  const files = [...e.target.files].filter((f) => !f.name.startsWith('.'));
  e.target.value = ''; // reset so the same file can be picked again
  if (files.length === 0) return;
  const items = files.map((file) => ({ file, path: file.name }));
  await uploadFiles(items, currentPrefix);
});

$('confirm-cancel').addEventListener('click', () => { $('confirm-modal').classList.add('hidden'); confirmCallback = null; });
$('confirm-ok').addEventListener('click', async () => {
  $('confirm-modal').classList.add('hidden');
  if (confirmCallback) { const cb = confirmCallback; confirmCallback = null; await cb(); }
});

// ── Recherche / tri ────────────────────────────────────────────────────────
$('search-input').addEventListener('input', (e) => {
  searchQuery = e.target.value;
  applyAndRender();
});
$('sort-select').addEventListener('change', (e) => {
  sortMode = e.target.value;
  applyAndRender();
});

// ── Raccourcis globaux supplémentaires (Cmd+A, Echap clear) ───────────────
document.addEventListener('keydown', (e) => {
  if (!$('confirm-modal').classList.contains('hidden')) return;
  if (!$('prompt-modal').classList.contains('hidden')) return;
  if (!$('lightbox').classList.contains('hidden')) return;
  // Cmd+A is global (works even when typing in the search input).
  // Other shortcuts are ignored when typing in an input.
  const inInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
  if (e.metaKey && (e.key === 'a' || e.key === 'A')) {
    e.preventDefault();
    for (const f of displayedFiles) selectAdd(f.key, f.size || 0);
    document.querySelectorAll('.grid-item[data-key]').forEach((el) => {
      el.classList.toggle('selected', selected.has(el.dataset.key));
    });
    updateActionBar();
  } else if (!inInput && (e.key === 'Delete' || e.key === 'Backspace') && selected.size > 0) {
    e.preventDefault();
    $('action-delete').click();
  } else if (!inInput && e.key === 'Escape' && selected.size > 0) {
    selectClearAll();
    document.querySelectorAll('.grid-item.selected').forEach((el) => el.classList.remove('selected'));
    updateActionBar();
  }
});

// ── Prompt modal (mkdir / rename) ──────────────────────────────────────────
let promptCallback = null;
function openPrompt({ title, text, defaultValue, onConfirm }) {
  $('prompt-title').textContent = title;
  $('prompt-text').textContent = text || '';
  const input = $('prompt-input');
  input.value = defaultValue || '';
  promptCallback = onConfirm;
  $('prompt-modal').classList.remove('hidden');
  setTimeout(() => { input.focus(); input.select(); }, 50);
}
$('prompt-cancel').addEventListener('click', () => {
  $('prompt-modal').classList.add('hidden');
  promptCallback = null;
});
$('prompt-ok').addEventListener('click', async () => {
  const val = $('prompt-input').value.trim();
  $('prompt-modal').classList.add('hidden');
  if (promptCallback && val) { const cb = promptCallback; promptCallback = null; await cb(val); }
});
$('prompt-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('prompt-ok').click(); }
  else if (e.key === 'Escape') { e.preventDefault(); $('prompt-cancel').click(); }
});

// Clic droit dans le vide → menu "Nouveau dossier"
document.addEventListener('contextmenu', (e) => {
  if ($('screen-admin').classList.contains('hidden')) return;
  if (e.target.closest('.grid-item')) return;
  if (e.target.closest('button, input, select, textarea, a, .ctx-menu, .modal-backdrop, .lightbox:not(.hidden)')) return;
  e.preventDefault();
  const menu = $('ctx-empty');
  menu.style.left = Math.min(e.clientX, window.innerWidth - 200) + 'px';
  menu.style.top  = Math.min(e.clientY, window.innerHeight - 60) + 'px';
  menu.classList.remove('hidden');
});
$('ctx-empty').querySelector('[data-act="mkdir"]').addEventListener('click', () => {
  $('ctx-empty').classList.add('hidden');
  $('mkdir-btn').click();
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#ctx-empty')) $('ctx-empty').classList.add('hidden');
});

// ── Nouveau dossier ────────────────────────────────────────────────────────
$('mkdir-btn').addEventListener('click', () => {
  openPrompt({
    title: 'Nouveau dossier',
    text: `Sera créé dans ${currentPrefix}`,
    defaultValue: '',
    onConfirm: async (name) => {
      await callAdmin('mkdir', { prefix: currentPrefix, newName: name }, 'Création…');
    },
  });
});

// ── Rename helper (utilisé par le context menu) ────────────────────────────
function promptRenameFile(key) {
  const fileName = key.split('/').pop() || '';
  openPrompt({
    title: 'Renommer le fichier',
    text: fileName,
    defaultValue: fileName,
    onConfirm: async (newName) => {
      if (newName === fileName) return;
      await callAdmin('rename', { key, newName }, 'Renommage…');
    },
  });
}
function promptRenameFolder(prefix, name) {
  openPrompt({
    title: 'Renommer le dossier',
    text: name,
    defaultValue: name,
    onConfirm: async (newName) => {
      if (newName === name) return;
      await callAdmin('rename', { prefix, newName }, 'Renommage du dossier…');
    },
  });
}

// ── Audit log (Historique) ─────────────────────────────────────────────────
async function openAuditLog() {
  $('audit-modal').classList.remove('hidden');
  const list = $('audit-list');
  list.innerHTML = '<div class="audit-empty">Chargement…</div>';
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { list.innerHTML = '<div class="audit-empty">Pas de session.</div>'; return; }
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-r2`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_PUBLISHABLE_KEY,
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ action: 'audit-list' }),
    });
    if (!res.ok) { list.innerHTML = '<div class="audit-empty">Erreur de chargement.</div>'; return; }
    const data = await res.json();
    const rows = data.rows || [];
    if (rows.length === 0) {
      list.innerHTML = '<div class="audit-empty">Aucune action enregistrée pour le moment.</div>';
      return;
    }
    list.innerHTML = '';
    for (const r of rows) {
      const row = document.createElement('div');
      row.className = 'audit-row';
      const ts = new Date(r.ts);
      const today = new Date();
      const sameDay = ts.toDateString() === today.toDateString();
      const tsStr = sameDay
        ? ts.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
        : ts.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' ' + ts.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      const countLabel = r.count != null ? `${r.count} élément${r.count > 1 ? 's' : ''}` : '';
      row.innerHTML = `
        <div class="audit-row-head">
          <div class="audit-ts">${escapeHtml(tsStr)}</div>
          <div class="audit-action ${escapeHtml(r.action)}">${escapeHtml(r.action)}</div>
          <div class="audit-count">${escapeHtml(countLabel)}</div>
        </div>
        <div class="audit-target" title="${escapeHtml(r.target || '')}">${escapeHtml(r.target || '—')}</div>
      `;
      list.appendChild(row);
    }
  } catch (e) {
    list.innerHTML = `<div class="audit-empty">Erreur : ${escapeHtml(e.message)}</div>`;
  }
}
$('audit-btn').addEventListener('click', openAuditLog);
$('audit-close').addEventListener('click', () => $('audit-modal').classList.add('hidden'));
$('audit-modal').addEventListener('click', (e) => {
  if (e.target.id === 'audit-modal') $('audit-modal').classList.add('hidden');
});

// ── Marquee selection (lasso à la souris) ──────────────────────────────────
// Click-drag dans le vide de la grille pour dessiner un rectangle qui
// sélectionne tous les fichiers qu'il croise (comme dans le Finder).
// Ignore si on clique sur une card (drag de la card prend le dessus).
(function setupMarquee() {
  const marquee = $('marquee');
  // Sortir le marquee du grid-wrap pour qu'aucun ancestor ne casse position:fixed.
  document.body.appendChild(marquee);
  marquee.style.position = 'fixed';
  marquee.style.zIndex = '500';
  let active = false;
  // Coordonnées en VIEWPORT (clientX/clientY) — plus simple, marche partout.
  let startVX = 0, startVY = 0;
  let baseSelection = new Set();

  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    // On démarre le lasso depuis n'importe où dans la zone admin sauf :
    if (e.target.closest('.grid-item')) return;       // click sur card → comportement normal
    if (e.target.closest('button, input, select, textarea, a, .ctx-menu, .modal-backdrop, .lightbox:not(.hidden)')) return;
    if ($('screen-admin').classList.contains('hidden')) return; // pas en login
    active = true;
    startVX = e.clientX;
    startVY = e.clientY;
    if (!e.metaKey && !e.shiftKey) {
      selectClearAll();
      document.querySelectorAll('.grid-item.selected').forEach((el) => el.classList.remove('selected'));
      updateActionBar();
    }
    baseSelection = new Set(selected);
    // Marquee positionné en FIXED → coords viewport directement, pas de scroll math.
    marquee.style.position = 'fixed';
    marquee.style.left = startVX + 'px';
    marquee.style.top = startVY + 'px';
    marquee.style.width = '0px';
    marquee.style.height = '0px';
    marquee.classList.remove('hidden');
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!active) return;
    const x = Math.min(startVX, e.clientX);
    const y = Math.min(startVY, e.clientY);
    const w = Math.abs(e.clientX - startVX);
    const h = Math.abs(e.clientY - startVY);
    marquee.style.left = x + 'px';
    marquee.style.top = y + 'px';
    marquee.style.width = w + 'px';
    marquee.style.height = h + 'px';
    const mRight = x + w;
    const mBottom = y + h;
    document.querySelectorAll('.grid-item').forEach((el) => {
      const id = el.dataset.key || el.dataset.prefix;
      if (!id) return;
      const r = el.getBoundingClientRect();
      const hit = r.left < mRight && r.right > x && r.top < mBottom && r.bottom > y;
      if (hit) {
        if (!selected.has(id)) {
          // size from data attr (0 for folders)
          selectAdd(id, parseInt(el.dataset.size || '0', 10));
        }
        el.classList.add('selected');
      } else if (!baseSelection.has(id)) {
        selectDelete(id);
        el.classList.remove('selected');
      }
    });
    updateActionBar();
  });

  window.addEventListener('mouseup', () => {
    if (!active) return;
    active = false;
    marquee.classList.add('hidden');
  });
})();

// ── Thumb size toggle ──────────────────────────────────────────────────────
function applyThumbSize() {
  document.body.dataset.thumbSize = thumbSize;
  document.querySelectorAll('.thumb-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.size === thumbSize);
  });
}
document.querySelectorAll('.thumb-btn').forEach((b) => {
  b.addEventListener('click', () => {
    thumbSize = b.dataset.size;
    localStorage.setItem('admin-thumb-size', thumbSize);
    applyThumbSize();
  });
});
applyThumbSize();

// ── Hover preview agrandi ──────────────────────────────────────────────────
// Survol d'une card fichier > 600ms → tooltip avec une version plus grande de la photo.
(function setupHoverPreview() {
  const preview = $('hover-preview');
  const img = $('hover-preview-img');
  let timer = null;
  let currentEl = null;

  function hide() {
    preview.classList.add('hidden');
    img.src = '';
    currentEl = null;
  }

  function position(e) {
    const pad = 16;
    const pw = preview.offsetWidth || 380;
    const ph = preview.offsetHeight || 380;
    let x = e.clientX + pad;
    let y = e.clientY + pad;
    if (x + pw > window.innerWidth) x = e.clientX - pw - pad;
    if (y + ph > window.innerHeight) y = e.clientY - ph - pad;
    preview.style.left = Math.max(8, x) + 'px';
    preview.style.top = Math.max(8, y) + 'px';
  }

  document.addEventListener('mouseover', (e) => {
    const card = e.target.closest('.grid-item[data-key]');
    if (!card || card === currentEl) return;
    currentEl = card;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const fullImg = card.querySelector('img');
      if (!fullImg) return;
      // Use a larger thumb (wsrv with w=600) instead of full original to stay snappy.
      const fileKey = card.dataset.key;
      const file = currentFiles.find((f) => f.key === fileKey);
      img.src = file ? thumbUrl(file.url, 600) : fullImg.src;
      preview.classList.remove('hidden');
      position(e);
    }, 600);
  });

  document.addEventListener('mousemove', (e) => {
    if (!preview.classList.contains('hidden')) position(e);
  });

  document.addEventListener('mouseout', (e) => {
    const card = e.target.closest('.grid-item[data-key]');
    if (!card) return;
    if (e.relatedTarget && card.contains(e.relatedTarget)) return;
    clearTimeout(timer);
    hide();
  });

  // Hide if user starts a drag, click, or scroll.
  document.addEventListener('mousedown', hide, true);
  window.addEventListener('scroll', hide, true);
})();

// ── Admin nav (Files / Challenges) ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.admin-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const panel = btn.dataset.panel;
      document.querySelectorAll('.admin-nav-btn').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.admin-panel').forEach(p => p.classList.toggle('hidden', p.id !== 'panel-' + panel));
      if (panel === 'challenges') loadChallengeList();
      if (panel === 'moderation') { loadModerationPosts(); loadModerationStats(); }
      if (panel === 'users') loadUsers();
      if (panel === 'analytics') loadAnalytics();
      if (panel === 'announcements') loadAnnouncements();
      if (panel === 'system') { loadMaintenanceState(); loadFeatureFlags(); }
      if (panel === 'errors') loadErrors();
      if (panel === 'blog') loadBlogList();
    });
  });
});

// ── Challenges CRUD ────────────────────────────────────────────────────────
async function callUserData(action, payload) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error('not logged in');
  const res = await fetch(`${SUPABASE_URL}/functions/v1/user-data`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_PUBLISHABLE_KEY,
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, payload }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'request failed');
  }
  return res.json();
}

async function loadChallengeList() {
  const list = $('ch-list');
  list.textContent = 'Chargement…';
  try {
    const data = await callUserData('adminListChallenges');
    const challenges = data.challenges || [];
    if (challenges.length === 0) { list.textContent = 'Aucun challenge.'; return; }
    list.innerHTML = '';
    challenges.forEach(ch => {
      const row = document.createElement('div');
      row.className = 'ch-row';
      const now = new Date();
      const dl = new Date(ch.deadline);
      const isActive = dl >= now;
      row.innerHTML =
        (ch.ref_image_url ? '<img class="ch-row-img" src="' + ch.ref_image_url + '" alt="">' : '<div class="ch-row-img ch-row-no-img">?</div>')
        + '<div class="ch-row-info">'
        + '<div class="ch-row-title">' + escapeHtml(ch.title) + '</div>'
        + '<div class="ch-row-meta">'
        + '<span class="ch-status ' + (isActive ? 'ch-active' : 'ch-past') + '">' + (isActive ? 'Actif' : 'Terminé') + '</span>'
        + ' · Deadline : ' + dl.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        + '</div>'
        + '</div>';
      const del = document.createElement('button');
      del.className = 'btn-danger ch-row-delete';
      del.textContent = '🗑';
      del.title = 'Supprimer';
      del.onclick = async () => {
        if (!confirm('Supprimer le challenge « ' + ch.title + ' » ?\nLes posts tagués seront dé-tagués.')) return;
        try {
          await callUserData('adminDeleteChallenge', { challengeId: ch.id });
          toast('Challenge supprimé', 'ok');
          loadChallengeList();
        } catch (e) { toast('Erreur : ' + e.message, 'err'); }
      };
      row.appendChild(del);
      list.appendChild(row);
    });
  } catch (e) { list.textContent = 'Erreur : ' + e.message; }
}

// ── Ref image picker (R2 browser for challenge ref) ──────────────────────
let _refPickerPrefix = 'Sessions/current/';

function setRefImage(url) {
  $('ch-ref-url').value = url;
  const preview = $('ch-ref-preview');
  const img = $('ch-ref-preview-img');
  img.src = thumbUrl(url, 200);
  preview.classList.remove('hidden');
}

function clearRefImage() {
  $('ch-ref-url').value = '';
  $('ch-ref-preview').classList.add('hidden');
  $('ch-ref-preview-img').src = '';
}

async function openRefPicker() {
  _refPickerPrefix = 'Sessions/current/';
  $('ref-picker-modal').classList.remove('hidden');
  await loadRefPickerGrid();
}

function closeRefPicker() {
  $('ref-picker-modal').classList.add('hidden');
}

async function loadRefPickerGrid() {
  const grid = $('ref-picker-grid');
  grid.innerHTML = '<div class="grid-loader"><div class="grid-spinner"></div></div>';
  renderRefPickerBreadcrumb();
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { grid.textContent = 'Pas de session.'; return; }
    const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-r2`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_PUBLISHABLE_KEY,
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ action: 'browse', prefix: _refPickerPrefix }),
    });
    if (!res.ok) { grid.textContent = 'Erreur ' + res.status; return; }
    const data = await res.json();
    grid.innerHTML = '';
    // Folders
    (data.folders || []).forEach(f => {
      const card = document.createElement('div');
      card.className = 'grid-item folder';
      card.innerHTML = '<div class="icon">📁</div><div class="name">' + escapeHtml(f.name) + '</div>';
      card.addEventListener('click', () => {
        _refPickerPrefix = f.prefix;
        loadRefPickerGrid();
      });
      grid.appendChild(card);
    });
    // Files (images only)
    (data.files || []).forEach(f => {
      if (!/\.(jpg|jpeg|png|gif|webp)$/i.test(f.name)) return;
      const card = document.createElement('div');
      card.className = 'grid-item ref-pickable';
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.src = thumbUrl(f.url, 200);
      img.alt = f.name;
      card.appendChild(img);
      const label = document.createElement('div');
      label.className = 'label';
      label.textContent = f.name;
      card.appendChild(label);
      card.addEventListener('click', () => {
        setRefImage(f.url);
        closeRefPicker();
        toast('Image sélectionnée', 'ok');
      });
      grid.appendChild(card);
    });
    if (grid.children.length === 0) grid.textContent = 'Aucun fichier ici.';
  } catch (e) { grid.textContent = 'Erreur : ' + e.message; }
}

function renderRefPickerBreadcrumb() {
  const bc = $('ref-picker-breadcrumb');
  bc.innerHTML = '';
  const parts = _refPickerPrefix.split('/').filter(Boolean);
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
      btn.addEventListener('click', () => {
        _refPickerPrefix = target;
        loadRefPickerGrid();
      });
    }
    bc.appendChild(btn);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  $('ch-ref-browse').addEventListener('click', openRefPicker);
  $('ref-picker-close').addEventListener('click', closeRefPicker);
  $('ch-ref-clear').addEventListener('click', clearRefImage);
  // URL manual input → preview on blur
  $('ch-ref-url').addEventListener('change', () => {
    const url = $('ch-ref-url').value.trim();
    if (url) setRefImage(url);
    else clearRefImage();
  });
});

document.addEventListener('DOMContentLoaded', () => {
  $('ch-create-btn').addEventListener('click', async () => {
    const title = $('ch-title').value.trim();
    const refUrl = $('ch-ref-url').value.trim();
    const deadline = $('ch-deadline').value;
    const msg = $('ch-form-msg');
    if (!title) { setMsg(msg, 'Le titre est requis.', 'err'); return; }
    if (!deadline) { setMsg(msg, 'La deadline est requise.', 'err'); return; }
    setMsg(msg, 'Création…');
    try {
      await callUserData('adminCreateChallenge', {
        title,
        ref_image_url: refUrl || null,
        deadline: new Date(deadline).toISOString(),
      });
      setMsg(msg, '✓ Challenge créé !', 'ok');
      $('ch-title').value = '';
      $('ch-ref-url').value = '';
      $('ch-deadline').value = '';
      loadChallengeList();
    } catch (e) {
      setMsg(msg, 'Erreur : ' + e.message, 'err');
    }
  });
});

// ── Moderation panel ──────────────────────────────────────────────────────
let _modFilter = 'pending';
let _modSearch = '';
let _modSelected = new Set();
let _modPosts = []; // current loaded posts for keyboard nav
let _modFocusIdx = -1;
let _modSearchTimer = null;

async function loadModerationStats() {
  const el = $('mod-stats');
  try {
    const data = await callUserData('adminModerationStats');
    el.innerHTML =
      '<div class="mod-stat"><span>En attente</span> <span class="mod-stat-value warn">' + data.pending + '</span></div>' +
      '<div class="mod-stat"><span>Approuvés aujourd\'hui</span> <span class="mod-stat-value ok">' + data.approvedToday + '</span></div>' +
      '<div class="mod-stat"><span>Total approuvés</span> <span class="mod-stat-value">' + data.totalApproved + '</span></div>' +
      '<div class="mod-stat"><span>Total posts</span> <span class="mod-stat-value">' + data.totalPosts + '</span></div>';
  } catch { el.innerHTML = ''; }
}

async function loadModerationPosts() {
  const grid = $('mod-grid');
  grid.innerHTML = '<div class="mod-empty">Chargement…</div>';
  _modSelected.clear();
  _modPosts = [];
  _modFocusIdx = -1;
  updateModButtons();
  try {
    const data = await callUserData('adminListPosts', { filter: _modFilter, search: _modSearch, limit: 100 });
    const posts = data.posts || [];
    _modPosts = posts;
    // Update badge
    const badge = $('mod-badge');
    if (data.pendingCount > 0) {
      badge.textContent = data.pendingCount;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
    grid.innerHTML = '';
    if (posts.length === 0) {
      grid.innerHTML = '<div class="mod-empty">' +
        (_modSearch ? 'Aucun résultat pour « ' + escapeHtml(_modSearch) + ' »' :
        _modFilter === 'pending' ? 'Aucun post en attente 👍' : 'Aucun post.') + '</div>';
      return;
    }
    posts.forEach((p, idx) => {
      const card = document.createElement('div');
      card.className = 'mod-card';
      card.dataset.id = p.id;
      card.dataset.idx = idx;
      const dt = new Date(p.created_at);
      const dateStr = dt.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      card.innerHTML =
        '<div class="mod-check" title="Sélectionner (Espace)">✓</div>' +
        '<img class="mod-card-img" loading="lazy" src="' + thumbUrl(p.image_url, 400) + '" alt="">' +
        '<div class="mod-card-body">' +
          '<div class="mod-card-user">' + escapeHtml(p.username || '—') + '</div>' +
          '<div class="mod-card-email">' + escapeHtml(p.user_email) + '</div>' +
          '<div class="mod-card-date">' + dateStr + '</div>' +
          '<span class="mod-card-status ' + (p.approved ? 'approved' : 'pending') + '">' + (p.approved ? 'Approuvé' : 'En attente') + '</span>' +
        '</div>' +
        '<div class="mod-card-actions">' +
          (p.approved
            ? '<button class="mod-btn-ban" data-act="ban" title="Bloquer cet utilisateur">🚫 Bloquer</button>' +
              '<button class="mod-btn-reject" data-act="reject">✕ Rejeter</button>'
            : '<button class="mod-btn-approve" data-act="approve">✓ Approuver</button>' +
              '<button class="mod-btn-ban" data-act="ban" title="Bloquer cet utilisateur">🚫</button>' +
              '<button class="mod-btn-reject" data-act="reject">✕ Rejeter</button>') +
        '</div>';
      // Click image → lightbox with comparison if ref exists
      card.querySelector('.mod-card-img').addEventListener('click', () => {
        openModLightbox(p);
      });
      // Click username → user profile
      card.querySelector('.mod-card-user').style.cursor = 'pointer';
      card.querySelector('.mod-card-user').addEventListener('click', () => openUserProfile(p.user_email));
      // Click check → toggle selection
      card.querySelector('.mod-check').addEventListener('click', (e) => {
        e.stopPropagation();
        toggleModSelect(p.id, card);
      });
      // Action buttons
      card.querySelectorAll('.mod-card-actions button').forEach(btn => {
        btn.addEventListener('click', async () => {
          const act = btn.dataset.act;
          if (act === 'ban') {
            if (!confirm('Bloquer l\'utilisateur ' + p.user_email + ' ?\nIl ne pourra plus publier.')) return;
            try {
              await callUserData('adminBanUser', { email: p.user_email });
              toast('Utilisateur bloqué : ' + p.user_email, 'ok');
            } catch (e) { toast('Erreur : ' + e.message, 'err'); }
            return;
          }
          if (act === 'approve') {
            try {
              await callUserData('adminApprovePost', { postId: p.id });
              toast('Post approuvé', 'ok');
              loadModerationPosts(); loadModerationStats();
            } catch (e) { toast('Erreur : ' + e.message, 'err'); }
            return;
          }
          if (act === 'reject') {
            openRejectReasonModal([p.id]);
            return;
          }
        });
      });
      grid.appendChild(card);
    });
  } catch (e) {
    grid.innerHTML = '<div class="mod-empty">Erreur : ' + escapeHtml(e.message) + '</div>';
  }
}

function toggleModSelect(id, card) {
  if (_modSelected.has(id)) { _modSelected.delete(id); card.classList.remove('selected'); }
  else { _modSelected.add(id); card.classList.add('selected'); }
  updateModButtons();
}

function updateModButtons() {
  const n = _modSelected.size;
  $('mod-approve-all').disabled = n === 0;
  $('mod-reject-all').disabled = n === 0;
  $('mod-approve-all').textContent = n > 0 ? `✓ Approuver (${n})` : '✓ Approuver la sélection';
  $('mod-reject-all').textContent = n > 0 ? `✕ Rejeter (${n})` : '✕ Rejeter la sélection';
}

// ── Feature 1: Lightbox with ref comparison ──
function openModLightbox(post) {
  const lb = $('lightbox');
  const img = $('lightbox-img');
  if (post.ref_image_url) {
    // Side-by-side comparison
    img.style.display = 'none';
    let compare = lb.querySelector('.lightbox-compare');
    if (!compare) {
      compare = document.createElement('div');
      compare.className = 'lightbox-compare';
      lb.appendChild(compare);
    }
    compare.innerHTML =
      '<div class="lightbox-compare-wrap">' +
        '<img src="' + escapeHtml(post.ref_image_url) + '" alt="Référence">' +
        '<div class="lightbox-compare-label">Référence</div>' +
      '</div>' +
      '<div class="lightbox-compare-wrap">' +
        '<img src="' + escapeHtml(post.image_url) + '" alt="Dessin">' +
        '<div class="lightbox-compare-label">Dessin de ' + escapeHtml(post.username || '?') + '</div>' +
      '</div>';
    compare.style.display = '';
  } else {
    img.src = post.image_url;
    img.style.display = '';
    const compare = lb.querySelector('.lightbox-compare');
    if (compare) compare.style.display = 'none';
  }
  lb.classList.remove('hidden');
}

// Clean up compare view when lightbox closes
(function () {
  const origClose = $('lightbox-close');
  origClose.addEventListener('click', () => {
    const compare = $('lightbox').querySelector('.lightbox-compare');
    if (compare) compare.style.display = 'none';
    $('lightbox-img').style.display = '';
  });
})();

// ── Feature 5: Keyboard shortcuts ──
function modSetFocus(idx) {
  if (_modPosts.length === 0) return;
  // Clamp
  if (idx < 0) idx = _modPosts.length - 1;
  if (idx >= _modPosts.length) idx = 0;
  _modFocusIdx = idx;
  // Update visual
  document.querySelectorAll('.mod-card.focused').forEach(c => c.classList.remove('focused'));
  const card = $('mod-grid').querySelector(`.mod-card[data-idx="${idx}"]`);
  if (card) {
    card.classList.add('focused');
    card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

document.addEventListener('keydown', (e) => {
  // Only active when moderation panel is visible
  if ($('panel-moderation').classList.contains('hidden')) return;
  // Don't intercept when typing in an input
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    e.preventDefault();
    modSetFocus(_modFocusIdx + 1);
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    e.preventDefault();
    modSetFocus(_modFocusIdx - 1);
  } else if ((e.key === 'a' || e.key === 'A') && _modFocusIdx >= 0) {
    e.preventDefault();
    const p = _modPosts[_modFocusIdx];
    if (p && !p.approved) {
      callUserData('adminApprovePost', { postId: p.id })
        .then(() => { toast('Post approuvé', 'ok'); loadModerationPosts(); loadModerationStats(); })
        .catch(err => toast('Erreur : ' + err.message, 'err'));
    }
  } else if ((e.key === 'r' || e.key === 'R') && _modFocusIdx >= 0) {
    e.preventDefault();
    const p = _modPosts[_modFocusIdx];
    if (p && confirm('Rejeter et supprimer ce post ?')) {
      callUserData('adminRejectPost', { postId: p.id })
        .then(() => { toast('Post rejeté', 'ok'); loadModerationPosts(); loadModerationStats(); })
        .catch(err => toast('Erreur : ' + err.message, 'err'));
    }
  } else if (e.key === ' ' && _modFocusIdx >= 0) {
    e.preventDefault();
    const p = _modPosts[_modFocusIdx];
    const card = $('mod-grid').querySelector(`.mod-card[data-idx="${_modFocusIdx}"]`);
    if (p && card) toggleModSelect(p.id, card);
  }
});

document.addEventListener('DOMContentLoaded', () => {
  // Filter buttons
  document.querySelectorAll('.mod-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _modFilter = btn.dataset.filter;
      document.querySelectorAll('.mod-filter-btn').forEach(b => b.classList.toggle('active', b === btn));
      loadModerationPosts();
    });
  });
  // Search input with debounce
  $('mod-search').addEventListener('input', () => {
    clearTimeout(_modSearchTimer);
    _modSearchTimer = setTimeout(() => {
      _modSearch = $('mod-search').value.trim();
      loadModerationPosts();
    }, 400);
  });
  // Batch approve
  $('mod-approve-all').addEventListener('click', async () => {
    if (_modSelected.size === 0) return;
    try {
      await callUserData('adminApprovePost', { postIds: [..._modSelected] });
      toast(`${_modSelected.size} post(s) approuvé(s)`, 'ok');
      loadModerationPosts();
      loadModerationStats();
    } catch (e) { toast('Erreur : ' + e.message, 'err'); }
  });
  // Batch reject — now with reason modal
  $('mod-reject-all').addEventListener('click', () => {
    if (_modSelected.size === 0) return;
    openRejectReasonModal([..._modSelected]);
  });
  // Speed review button
  $('mod-speed-btn').addEventListener('click', openSpeedReview);
  // Moderation log button
  $('mod-log-btn').addEventListener('click', openModerationLog);
  // Banned users button
  $('mod-banned-btn').addEventListener('click', openBannedList);
});

// ── Feature 2: Speed Review ──────────────────────────────────────────────
let _speedIdx = 0;
let _speedPosts = [];

function openSpeedReview() {
  // Get pending posts only
  _speedPosts = _modPosts.filter(p => !p.approved);
  if (_speedPosts.length === 0) { toast('Aucun post en attente', 'err'); return; }
  _speedIdx = 0;
  renderSpeedReview();
  $('speed-review').classList.remove('hidden');
}

function renderSpeedReview() {
  const p = _speedPosts[_speedIdx];
  if (!p) { closeSpeedReview(); return; }
  $('speed-counter').textContent = (_speedIdx + 1) + ' / ' + _speedPosts.length;
  $('speed-img').src = p.image_url;
  $('speed-user').textContent = p.username || '—';
  $('speed-user').onclick = () => { closeSpeedReview(); openUserProfile(p.user_email); };
  $('speed-email').textContent = p.user_email;
  $('speed-date').textContent = new Date(p.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  if (p.ref_image_url) {
    $('speed-ref').classList.remove('hidden');
    $('speed-ref-img').src = thumbUrl(p.ref_image_url, 160);
  } else {
    $('speed-ref').classList.add('hidden');
  }
}

function closeSpeedReview() {
  $('speed-review').classList.add('hidden');
  loadModerationPosts();
  loadModerationStats();
}

document.addEventListener('DOMContentLoaded', () => {
  $('speed-close').addEventListener('click', closeSpeedReview);
  $('speed-approve').addEventListener('click', async () => {
    const p = _speedPosts[_speedIdx];
    if (!p) return;
    try {
      await callUserData('adminApprovePost', { postId: p.id });
      toast('Approuvé', 'ok');
      _speedPosts.splice(_speedIdx, 1);
      if (_speedIdx >= _speedPosts.length) _speedIdx = Math.max(0, _speedPosts.length - 1);
      if (_speedPosts.length === 0) { closeSpeedReview(); toast('Tous les posts traités !', 'ok'); }
      else renderSpeedReview();
    } catch (e) { toast('Erreur : ' + e.message, 'err'); }
  });
  $('speed-reject').addEventListener('click', () => {
    const p = _speedPosts[_speedIdx];
    if (!p) return;
    openRejectReasonModal([p.id], true);
  });
});

// Speed review keyboard (A/R) — handled in the existing keydown listener via speed-review visibility
document.addEventListener('keydown', (e) => {
  if ($('speed-review').classList.contains('hidden')) return;
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'a' || e.key === 'A') { e.preventDefault(); $('speed-approve').click(); }
  else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); $('speed-reject').click(); }
  else if (e.key === 'Escape') { e.preventDefault(); closeSpeedReview(); }
});

// ── Feature 4: User Profile modal ────────────────────────────────────────
async function openUserProfile(targetEmail) {
  $('user-profile-modal').classList.remove('hidden');
  $('up-title').textContent = 'Chargement…';
  $('up-info').innerHTML = '';
  $('up-actions').innerHTML = '';
  $('up-grid').innerHTML = '';
  $('up-logs').innerHTML = '';
  $('up-post-count').textContent = '…';
  try {
    const data = await callUserData('adminGetUserProfile', { email: targetEmail });
    const p = data.profile || {};
    $('up-title').textContent = p.username || targetEmail;
    // Info badges
    let infoHtml = '<span class="up-info-item"><strong>' + escapeHtml(targetEmail) + '</strong></span>';
    if (p.banned) infoHtml += '<span class="up-tag banned">Banni</span>';
    if (data.trusted) infoHtml += '<span class="up-tag trusted">Confiance</span>';
    infoHtml += '<span class="up-tag ' + (p.plan === 'pro' ? 'pro' : 'free') + '">' + (p.plan === 'pro' ? 'Pro' : 'Free') + '</span>';
    infoHtml += '<span class="up-info-item">' + data.approvedCount + ' post(s) approuvé(s)</span>';
    $('up-info').innerHTML = infoHtml;
    // Actions
    let actHtml = '';
    if (p.banned) {
      actHtml += '<button class="btn-secondary" id="up-unban">Débloquer</button>';
    } else {
      actHtml += '<button class="mod-btn-ban btn-secondary" id="up-ban" style="border:1px solid var(--border);padding:8px 16px;">🚫 Bloquer</button>';
    }
    $('up-actions').innerHTML = actHtml;
    if (p.banned) {
      $('up-unban').addEventListener('click', async () => {
        try {
          await callUserData('adminUnbanUser', { email: targetEmail });
          toast('Utilisateur débloqué', 'ok');
          openUserProfile(targetEmail);
        } catch (e) { toast('Erreur : ' + e.message, 'err'); }
      });
    } else {
      $('up-ban').addEventListener('click', async () => {
        if (!confirm('Bloquer ' + targetEmail + ' ?')) return;
        try {
          await callUserData('adminBanUser', { email: targetEmail });
          toast('Utilisateur bloqué', 'ok');
          openUserProfile(targetEmail);
        } catch (e) { toast('Erreur : ' + e.message, 'err'); }
      });
    }
    // Posts grid
    $('up-post-count').textContent = (data.posts || []).length;
    const grid = $('up-grid');
    grid.innerHTML = '';
    (data.posts || []).forEach(post => {
      const card = document.createElement('div');
      card.className = 'grid-item';
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.src = thumbUrl(post.image_url, 200);
      card.appendChild(img);
      const label = document.createElement('div');
      label.className = 'label';
      label.innerHTML = '<span class="mod-card-status ' + (post.approved ? 'approved' : 'pending') + '">' + (post.approved ? '✓' : '⏳') + '</span>';
      card.appendChild(label);
      card.addEventListener('click', () => {
        $('lightbox-img').src = post.image_url;
        $('lightbox-img').style.display = '';
        const compare = $('lightbox').querySelector('.lightbox-compare');
        if (compare) compare.style.display = 'none';
        $('lightbox').classList.remove('hidden');
      });
      grid.appendChild(card);
    });
    if ((data.posts || []).length === 0) grid.innerHTML = '<div class="mod-empty">Aucun post.</div>';
    // Logs
    const logs = $('up-logs');
    logs.innerHTML = '';
    (data.logs || []).forEach(l => {
      const row = document.createElement('div');
      row.className = 'up-log-row';
      const dt = new Date(l.created_at);
      row.innerHTML =
        '<span class="up-log-action ' + l.action + '">' + l.action.toUpperCase() + '</span>' +
        (l.reason ? '<span class="up-log-reason">' + escapeHtml(l.reason) + '</span>' : '') +
        '<span class="up-log-date">' + dt.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + '</span>';
      logs.appendChild(row);
    });
    if ((data.logs || []).length === 0) logs.innerHTML = '<div class="mod-empty" style="padding:12px;">Aucun historique.</div>';
  } catch (e) {
    $('up-title').textContent = 'Erreur';
    $('up-info').textContent = e.message;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  $('up-close').addEventListener('click', () => $('user-profile-modal').classList.add('hidden'));
});

// ── Feature 3: Moderation Log ────────────────────────────────────────────
async function openModerationLog() {
  $('mod-log-modal').classList.remove('hidden');
  const list = $('mod-log-list');
  list.textContent = 'Chargement…';
  try {
    const data = await callUserData('adminGetModerationLog', { limit: 100 });
    const logs = data.logs || [];
    list.innerHTML = '';
    if (logs.length === 0) { list.innerHTML = '<div class="audit-empty">Aucune action enregistrée.</div>'; return; }
    logs.forEach(l => {
      const row = document.createElement('div');
      row.className = 'mod-log-row';
      const dt = new Date(l.created_at);
      row.innerHTML =
        '<span class="mod-log-action ' + l.action + '">' + l.action.toUpperCase() + '</span>' +
        '<span class="mod-log-target">' + escapeHtml(l.target_email || '—') + '</span>' +
        (l.reason ? '<span class="mod-log-reason">' + escapeHtml(l.reason) + '</span>' : '<span class="mod-log-reason"></span>') +
        '<span class="mod-log-date">' + dt.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + '</span>';
      // Click target email → open user profile
      row.querySelector('.mod-log-target').addEventListener('click', () => {
        if (l.target_email) { $('mod-log-modal').classList.add('hidden'); openUserProfile(l.target_email); }
      });
      list.appendChild(row);
    });
  } catch (e) { list.textContent = 'Erreur : ' + e.message; }
}

document.addEventListener('DOMContentLoaded', () => {
  $('mod-log-close').addEventListener('click', () => $('mod-log-modal').classList.add('hidden'));
});

// ── Banned users list ─────────────────────────────────────────────────────
async function openBannedList() {
  $('banned-modal').classList.remove('hidden');
  const list = $('banned-list');
  list.textContent = 'Chargement…';
  try {
    const data = await callUserData('adminListBannedUsers');
    const users = data.users || [];
    list.innerHTML = '';
    if (users.length === 0) { list.innerHTML = '<div class="audit-empty">Aucun utilisateur banni.</div>'; return; }
    users.forEach(u => {
      const row = document.createElement('div');
      row.className = 'banned-row';
      row.innerHTML =
        '<div class="banned-info">' +
          '<div class="banned-username">' + escapeHtml(u.username || '—') + '</div>' +
          '<div class="banned-email">' + escapeHtml(u.email) + '</div>' +
        '</div>';
      const btn = document.createElement('button');
      btn.className = 'btn-secondary';
      btn.textContent = 'Débloquer';
      btn.addEventListener('click', async () => {
        if (!confirm('Débloquer ' + u.email + ' ?')) return;
        try {
          await callUserData('adminUnbanUser', { email: u.email });
          toast('Utilisateur débloqué : ' + u.email, 'ok');
          openBannedList();
        } catch (e) { toast('Erreur : ' + e.message, 'err'); }
      });
      row.appendChild(btn);
      list.appendChild(row);
    });
  } catch (e) { list.textContent = 'Erreur : ' + e.message; }
}

document.addEventListener('DOMContentLoaded', () => {
  $('banned-close').addEventListener('click', () => $('banned-modal').classList.add('hidden'));
});

// ── Feature 6: Reject reason modal ───────────────────────────────────────
let _rejectPostIds = [];
let _rejectFromSpeed = false;

function openRejectReasonModal(postIds, fromSpeed = false) {
  _rejectPostIds = postIds;
  _rejectFromSpeed = fromSpeed;
  $('reject-reason-input').value = '';
  document.querySelectorAll('.reject-tag').forEach(t => t.classList.remove('active'));
  $('reject-reason-modal').classList.remove('hidden');
}

document.addEventListener('DOMContentLoaded', () => {
  $('reject-reason-cancel').addEventListener('click', () => {
    $('reject-reason-modal').classList.add('hidden');
  });
  $('reject-reason-ok').addEventListener('click', async () => {
    const reason = $('reject-reason-input').value.trim() || null;
    $('reject-reason-modal').classList.add('hidden');
    try {
      if (_rejectPostIds.length === 1) {
        await callUserData('adminRejectPost', { postId: _rejectPostIds[0], reason });
      } else {
        await callUserData('adminRejectPost', { postIds: _rejectPostIds, reason });
      }
      toast(_rejectPostIds.length + ' post(s) rejeté(s)', 'ok');
      if (_rejectFromSpeed) {
        // Remove from speed list and continue
        const idx = _speedPosts.findIndex(p => p.id === _rejectPostIds[0]);
        if (idx >= 0) _speedPosts.splice(idx, 1);
        if (_speedIdx >= _speedPosts.length) _speedIdx = Math.max(0, _speedPosts.length - 1);
        if (_speedPosts.length === 0) { closeSpeedReview(); toast('Tous les posts traités !', 'ok'); }
        else renderSpeedReview();
      } else {
        loadModerationPosts();
        loadModerationStats();
      }
    } catch (e) { toast('Erreur : ' + e.message, 'err'); }
  });
  // Enter to confirm
  $('reject-reason-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); $('reject-reason-ok').click(); }
  });
  // Tag clicks → fill input + toggle active
  document.querySelectorAll('.reject-tag').forEach(tag => {
    tag.addEventListener('click', () => {
      document.querySelectorAll('.reject-tag').forEach(t => t.classList.remove('active'));
      tag.classList.add('active');
      $('reject-reason-input').value = tag.dataset.reason;
    });
  });
  // Typing in input clears active tag
  $('reject-reason-input').addEventListener('input', () => {
    document.querySelectorAll('.reject-tag').forEach(t => t.classList.remove('active'));
  });
});

// ── USERS PANEL ─────────────────────────────────────────────────────────
let _usersOffset = 0;
const _usersLimit = 50;
let _usersSearch = '';
let _usersFilterPlan = 'all';
let _usersFilterBanned = 'all';
let _usersFilterAdmin = 'all';
let _usersSearchTimer = null;

async function loadUsers() {
  const list = $('users-list');
  list.textContent = 'Chargement…';
  try {
    const data = await callUserData('adminListUsers', {
      offset: _usersOffset, limit: _usersLimit,
      search: _usersSearch,
      plan: _usersFilterPlan,
      banned: _usersFilterBanned,
      admin: _usersFilterAdmin,
    });
    const users = data.users || [];
    const total = data.total || 0;
    $('users-count').textContent = total + ' utilisateur(s)';
    $('users-page-info').textContent = users.length
      ? `${_usersOffset + 1}–${_usersOffset + users.length} sur ${total}`
      : '';
    $('users-prev').disabled = _usersOffset === 0;
    $('users-next').disabled = _usersOffset + users.length >= total;
    list.innerHTML = '';
    if (users.length === 0) { list.innerHTML = '<div class="mod-empty">Aucun utilisateur.</div>'; return; }
    users.forEach(u => {
      const row = document.createElement('div');
      row.className = 'user-row';
      const isPro = u.plan === 'pro';
      const isBanned = !!u.banned;
      const isAdmin = !!u.is_admin;
      const createdAt = u.created_at ? new Date(u.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
      const proExp = u.pro_expires_at ? ' · expire ' + new Date(u.pro_expires_at).toLocaleDateString('fr-FR') : (isPro ? ' · à vie' : '');
      row.innerHTML =
        '<div class="user-row-info">' +
          '<div class="user-row-username">' + escapeHtml(u.username || '—') + '</div>' +
          '<div class="user-row-email">' + escapeHtml(u.email) + '</div>' +
          '<div class="user-row-meta">' +
            '<span class="user-tag ' + (isPro ? 'pro' : 'free') + '">' + (isPro ? 'Pro' : 'Free') + '</span>' +
            (isAdmin ? '<span class="user-tag admin">Admin</span>' : '') +
            (isBanned ? '<span class="user-tag banned">Banni</span>' : '') +
            '<span class="user-tag date">inscrit ' + createdAt + proExp + '</span>' +
          '</div>' +
        '</div>';
      const actions = document.createElement('div');
      actions.className = 'user-row-actions';

      // Profile button (opens existing user profile modal)
      const btnProfile = document.createElement('button');
      btnProfile.textContent = '👁 Voir';
      btnProfile.onclick = () => openUserProfile(u.email);
      actions.appendChild(btnProfile);

      // Pro toggle
      const btnPro = document.createElement('button');
      if (isPro) {
        btnPro.textContent = 'Retirer Pro';
        btnPro.onclick = async () => {
          if (!confirm('Retirer Pro à ' + u.email + ' ?')) return;
          try { await callUserData('adminRevokePro', { email: u.email }); toast('Pro retiré', 'ok'); loadUsers(); }
          catch (e) { toast('Erreur : ' + e.message, 'err'); }
        };
      } else {
        btnPro.textContent = '✨ Donner Pro';
        btnPro.className = 'btn-pro-on';
        btnPro.onclick = async () => {
          const exp = prompt('Pro à vie ? Laisse vide et OK.\nOu entre une date d\'expiration (YYYY-MM-DD) :', '');
          if (exp === null) return; // cancelled
          let expiresAt = null;
          if (exp.trim()) {
            const d = new Date(exp.trim());
            if (isNaN(d.getTime())) { toast('Date invalide', 'err'); return; }
            expiresAt = d.toISOString();
          }
          try { await callUserData('adminGrantPro', { email: u.email, expiresAt }); toast('Pro accordé ✨', 'ok'); loadUsers(); }
          catch (e) { toast('Erreur : ' + e.message, 'err'); }
        };
      }
      actions.appendChild(btnPro);

      // Admin toggle
      const btnAdmin = document.createElement('button');
      btnAdmin.textContent = isAdmin ? 'Retirer admin' : '👑 Admin';
      btnAdmin.onclick = async () => {
        const msg = isAdmin ? 'Retirer les droits admin de ' + u.email + ' ?' : 'Donner les droits admin à ' + u.email + ' ?';
        if (!confirm(msg)) return;
        try { await callUserData('adminToggleAdmin', { email: u.email, makeAdmin: !isAdmin }); toast('OK', 'ok'); loadUsers(); }
        catch (e) { toast('Erreur : ' + e.message, 'err'); }
      };
      actions.appendChild(btnAdmin);

      // Ban / Unban
      const btnBan = document.createElement('button');
      btnBan.textContent = isBanned ? 'Débloquer' : '🚫 Bannir';
      if (!isBanned) btnBan.className = 'btn-ban';
      btnBan.onclick = async () => {
        const msg = isBanned ? 'Débloquer ' + u.email + ' ?' : 'Bannir ' + u.email + ' ?';
        if (!confirm(msg)) return;
        try {
          await callUserData(isBanned ? 'adminUnbanUser' : 'adminBanUser', { email: u.email });
          toast(isBanned ? 'Débloqué' : 'Banni', 'ok');
          loadUsers();
        } catch (e) { toast('Erreur : ' + e.message, 'err'); }
      };
      actions.appendChild(btnBan);

      // Delete user (destructive — require retyping email)
      const btnDel = document.createElement('button');
      btnDel.textContent = '🗑';
      btnDel.title = 'Supprimer le compte';
      btnDel.className = 'btn-ban';
      btnDel.onclick = () => {
        openConfirm({
          title: '⚠ SUPPRESSION DÉFINITIVE',
          text: 'Ceci supprime : compte auth, profil, posts, réactions, favoris, sessions, images R2.',
          requireType: u.email,
          async onConfirm() {
            try {
              const res = await callUserData('adminDeleteUser', { email: u.email });
              toast('Compte supprimé (' + res.deletedPosts + ' posts, ' + res.deletedImages + ' images)', 'ok');
              loadUsers();
            } catch (e) { toast('Erreur : ' + e.message, 'err'); }
          },
        });
      };
      actions.appendChild(btnDel);

      row.appendChild(actions);
      list.appendChild(row);
    });
  } catch (e) { list.textContent = 'Erreur : ' + e.message; }
}

document.addEventListener('DOMContentLoaded', () => {
  // Restore saved view mode
  const savedView = localStorage.getItem('gesturo-admin-users-view') || 'list';
  const initBtn = document.querySelector('.users-view-btn[data-view="' + savedView + '"]');
  if (initBtn) {
    document.querySelectorAll('.users-view-btn').forEach(b => b.classList.remove('active'));
    initBtn.classList.add('active');
    $('users-list').dataset.view = savedView;
  }
  // View toggle
  document.querySelectorAll('.users-view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      document.querySelectorAll('.users-view-btn').forEach(b => b.classList.toggle('active', b === btn));
      $('users-list').dataset.view = view;
      localStorage.setItem('gesturo-admin-users-view', view);
    });
  });
  $('users-search').addEventListener('input', () => {
    clearTimeout(_usersSearchTimer);
    _usersSearchTimer = setTimeout(() => {
      _usersSearch = $('users-search').value.trim();
      _usersOffset = 0;
      loadUsers();
    }, 400);
  });
  ['plan', 'banned', 'admin'].forEach(k => {
    $('users-filter-' + k).addEventListener('change', () => {
      if (k === 'plan') _usersFilterPlan = $('users-filter-plan').value;
      if (k === 'banned') _usersFilterBanned = $('users-filter-banned').value;
      if (k === 'admin') _usersFilterAdmin = $('users-filter-admin').value;
      _usersOffset = 0;
      loadUsers();
    });
  });
  $('users-prev').addEventListener('click', () => {
    _usersOffset = Math.max(0, _usersOffset - _usersLimit);
    loadUsers();
  });
  $('users-next').addEventListener('click', () => {
    _usersOffset += _usersLimit;
    loadUsers();
  });
});

// ── ANALYTICS PANEL ─────────────────────────────────────────────────────
async function loadAnalytics() {
  const kpis = $('analytics-kpis');
  kpis.innerHTML = '<div class="mod-empty">Chargement…</div>';
  const days = parseInt($('analytics-range').value) || 30;
  try {
    const d = await callUserData('adminGetAnalytics', { days });
    kpis.innerHTML =
      kpiCard('Utilisateurs', d.totalUsers, '+' + d.signupsPeriod + ' sur ' + days + 'j') +
      kpiCard('Pro', d.proUsers, d.conversionRate + '% de conversion', 'warm') +
      kpiCard('Sessions totales', d.totalSessions) +
      kpiCard('Sessions ' + days + 'j', d.sessionsPeriod, 'moy. ' + d.avgDurationMin + ' min/session') +
      kpiCard('Posts community', d.totalPosts) +
      kpiCard('Inscriptions ' + days + 'j', d.signupsPeriod, '', 'ok');
    renderBarChart('chart-signups', d.days.map(x => ({ label: x.date, value: x.signups })));
    renderBarChart('chart-sessions', d.days.map(x => ({ label: x.date, value: x.sessions })));
  } catch (e) { kpis.innerHTML = '<div class="mod-empty">Erreur : ' + escapeHtml(e.message) + '</div>'; }
}

function kpiCard(label, value, sub, tone) {
  return '<div class="kpi-card">' +
    '<div class="kpi-label">' + label + '</div>' +
    '<div class="kpi-value' + (tone ? ' ' + tone : '') + '">' + value + '</div>' +
    (sub ? '<div class="kpi-sub">' + sub + '</div>' : '') +
  '</div>';
}

function renderBarChart(containerId, data) {
  const container = $(containerId);
  container.innerHTML = '';
  const max = Math.max(1, ...data.map(d => d.value));
  data.forEach(d => {
    const bar = document.createElement('div');
    bar.className = 'chart-bar';
    bar.dataset.value = d.value;
    bar.style.height = Math.max(2, (d.value / max) * 100) + '%';
    const tip = document.createElement('div');
    tip.className = 'chart-tooltip';
    const dt = new Date(d.label);
    tip.textContent = dt.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ' : ' + d.value;
    bar.appendChild(tip);
    container.appendChild(bar);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  $('analytics-range').addEventListener('change', loadAnalytics);
  $('analytics-refresh').addEventListener('click', loadAnalytics);
});

// ── ANNOUNCEMENTS PANEL ─────────────────────────────────────────────────
async function loadAnnouncements() {
  const list = $('ann-list');
  list.textContent = 'Chargement…';
  try {
    const data = await callUserData('adminListAnnouncements');
    const items = data.announcements || [];
    if (items.length === 0) { list.innerHTML = '<div class="mod-empty">Aucune annonce.</div>'; return; }
    list.innerHTML = '';
    items.forEach(a => {
      const row = document.createElement('div');
      row.className = 'ann-row' + (a.active ? ' active' : '');
      const expires = a.expires_at ? ' · expire le ' + new Date(a.expires_at).toLocaleDateString('fr-FR') : '';
      const created = new Date(a.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
      row.innerHTML =
        '<div class="ann-row-info">' +
          '<div class="ann-row-msg">' +
            '<span class="ann-row-kind ' + (a.kind || 'info') + '">' + (a.kind || 'info') + '</span>' +
            escapeHtml(a.message) +
          '</div>' +
          '<div class="ann-row-meta">' +
            '<span class="ann-row-status ' + (a.active ? 'active' : 'inactive') + '">' + (a.active ? 'Active' : 'Inactive') + '</span>' +
            ' · créée le ' + created + expires +
          '</div>' +
        '</div>';
      const actions = document.createElement('div');
      actions.className = 'ann-row-actions';
      const btnToggle = document.createElement('button');
      btnToggle.textContent = a.active ? 'Désactiver' : 'Activer';
      btnToggle.onclick = async () => {
        try { await callUserData('adminToggleAnnouncement', { id: a.id, active: !a.active }); loadAnnouncements(); }
        catch (e) { toast('Erreur : ' + e.message, 'err'); }
      };
      const btnDel = document.createElement('button');
      btnDel.textContent = '🗑';
      btnDel.onclick = async () => {
        if (!confirm('Supprimer cette annonce ?')) return;
        try { await callUserData('adminDeleteAnnouncement', { id: a.id }); toast('Supprimée', 'ok'); loadAnnouncements(); }
        catch (e) { toast('Erreur : ' + e.message, 'err'); }
      };
      actions.appendChild(btnToggle);
      actions.appendChild(btnDel);
      row.appendChild(actions);
      list.appendChild(row);
    });
  } catch (e) { list.textContent = 'Erreur : ' + e.message; }
}

document.addEventListener('DOMContentLoaded', () => {
  $('ann-create-btn').addEventListener('click', async () => {
    const message = $('ann-message').value.trim();
    const kind = $('ann-kind').value;
    const link_url = $('ann-link-url').value.trim() || null;
    const link_label = $('ann-link-label').value.trim() || null;
    const expRaw = $('ann-expires').value;
    const expires_at = expRaw ? new Date(expRaw).toISOString() : null;
    const msg = $('ann-form-msg');
    if (!message) { setMsg(msg, 'Le message est requis.', 'err'); return; }
    setMsg(msg, 'Publication…');
    try {
      await callUserData('adminCreateAnnouncement', { message, kind, link_url, link_label, expires_at });
      setMsg(msg, '✓ Annonce publiée !', 'ok');
      $('ann-message').value = '';
      $('ann-link-url').value = '';
      $('ann-link-label').value = '';
      $('ann-expires').value = '';
      loadAnnouncements();
    } catch (e) { setMsg(msg, 'Erreur : ' + e.message, 'err'); }
  });
});

// ── SYSTEM PANEL : Maintenance + Feature Flags ──────────────────────────
async function loadMaintenanceState() {
  try {
    const data = await callUserData('getAppSettings');
    const m = data.settings?.maintenance || { enabled: false, message: '' };
    $('maintenance-enabled').checked = !!m.enabled;
    $('maintenance-msg').value = m.message || '';
  } catch {}
}

async function saveMaintenance() {
  const enabled = $('maintenance-enabled').checked;
  const message = $('maintenance-msg').value.trim();
  const status = $('maintenance-msg-status');
  setMsg(status, 'Enregistrement…');
  try {
    await callUserData('adminSetAppSetting', { key: 'maintenance', value: { enabled, message } });
    setMsg(status, '✓ Mode maintenance ' + (enabled ? 'ACTIVÉ' : 'désactivé'), 'ok');
  } catch (e) { setMsg(status, 'Erreur : ' + e.message, 'err'); }
}

async function loadFeatureFlags() {
  const list = $('flags-list');
  list.textContent = 'Chargement…';
  try {
    const data = await callUserData('getFeatureFlags');
    const flags = data.raw || [];
    if (flags.length === 0) { list.innerHTML = '<div class="mod-empty">Aucun flag.</div>'; return; }
    list.innerHTML = '';
    flags.forEach(f => {
      const row = document.createElement('div');
      row.className = 'flag-row' + (f.enabled ? ' enabled' : '');
      row.innerHTML =
        '<span class="flag-row-key">' + escapeHtml(f.key) + '</span>' +
        '<span class="flag-row-desc">' + escapeHtml(f.description || '') + '</span>' +
        '<span class="flag-row-status ' + (f.enabled ? 'on' : 'off') + '">' + (f.enabled ? 'ON' : 'OFF') + '</span>';
      const actions = document.createElement('div');
      actions.className = 'flag-row-actions';
      const btnToggle = document.createElement('button');
      btnToggle.textContent = f.enabled ? 'Désactiver' : 'Activer';
      btnToggle.onclick = async () => {
        try { await callUserData('adminSetFeatureFlag', { key: f.key, enabled: !f.enabled, description: f.description }); loadFeatureFlags(); }
        catch (e) { toast('Erreur : ' + e.message, 'err'); }
      };
      const btnDel = document.createElement('button');
      btnDel.textContent = '🗑';
      btnDel.onclick = async () => {
        if (!confirm('Supprimer le flag « ' + f.key + ' » ?')) return;
        try { await callUserData('adminDeleteFeatureFlag', { key: f.key }); loadFeatureFlags(); }
        catch (e) { toast('Erreur : ' + e.message, 'err'); }
      };
      actions.appendChild(btnToggle);
      actions.appendChild(btnDel);
      row.appendChild(actions);
      list.appendChild(row);
    });
  } catch (e) { list.textContent = 'Erreur : ' + e.message; }
}

document.addEventListener('DOMContentLoaded', () => {
  $('maintenance-save').addEventListener('click', saveMaintenance);
  $('flag-create-btn').addEventListener('click', async () => {
    const key = $('flag-key').value.trim();
    const description = $('flag-desc').value.trim();
    const enabled = $('flag-enabled').checked;
    if (!key) { toast('La clé est requise', 'err'); return; }
    try {
      await callUserData('adminSetFeatureFlag', { key, description, enabled });
      toast('Flag enregistré', 'ok');
      $('flag-key').value = ''; $('flag-desc').value = ''; $('flag-enabled').checked = false;
      loadFeatureFlags();
    } catch (e) { toast('Erreur : ' + e.message, 'err'); }
  });
});

// ── ERRORS PANEL ─────────────────────────────────────────────────────────
async function loadErrors() {
  const list = $('errors-list');
  list.textContent = 'Chargement…';
  try {
    const data = await callUserData('adminListErrors', { limit: 200 });
    const errs = data.errors || [];
    const badge = $('errors-badge');
    if (errs.length > 0) { badge.textContent = errs.length; badge.classList.remove('hidden'); }
    else badge.classList.add('hidden');
    if (errs.length === 0) { list.innerHTML = '<div class="mod-empty">Aucune erreur 👌</div>'; return; }
    list.innerHTML = '';
    errs.forEach(e => {
      const row = document.createElement('div');
      row.className = 'error-row';
      const dt = new Date(e.created_at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      row.innerHTML =
        '<div class="error-row-head">' +
          '<span class="error-row-msg">' + escapeHtml(e.message || '—') + '</span>' +
          '<span class="error-row-date">' + dt + '</span>' +
        '</div>' +
        '<div class="error-row-meta">' +
          (e.user_email ? '<span>👤 ' + escapeHtml(e.user_email) + '</span>' : '') +
          (e.url ? '<span>🔗 ' + escapeHtml(e.url) + '</span>' : '') +
          (e.app_version ? '<span>v' + escapeHtml(e.app_version) + '</span>' : '') +
          (e.user_agent ? '<span>📱 ' + escapeHtml(e.user_agent.slice(0, 60)) + '</span>' : '') +
        '</div>' +
        (e.stack ? '<div class="error-row-stack collapsed" onclick="this.classList.toggle(\'collapsed\')">' + escapeHtml(e.stack) + '</div>' : '');
      list.appendChild(row);
    });
  } catch (e) { list.textContent = 'Erreur : ' + e.message; }
}

document.addEventListener('DOMContentLoaded', () => {
  $('errors-refresh').addEventListener('click', loadErrors);
  $('errors-clear').addEventListener('click', async () => {
    if (!confirm('Vider toutes les erreurs ?')) return;
    try { await callUserData('adminClearErrors'); toast('Vidé', 'ok'); loadErrors(); }
    catch (e) { toast('Erreur : ' + e.message, 'err'); }
  });
});

// ── ANALYTICS EXTRAS : Top users / Inactive / Retention / Export CSV ─────
async function loadTopUsers() {
  const list = $('top-users-list');
  list.innerHTML = '<div class="mod-empty">Chargement…</div>';
  try {
    const sortBy = $('top-users-sort').value;
    const data = await callUserData('adminGetTopUsers', { sortBy, limit: 20 });
    const users = data.users || [];
    list.innerHTML = '';
    users.forEach((u, i) => {
      const row = document.createElement('div');
      row.className = 'top-user-row';
      const since = u.created_at ? new Date(u.created_at).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }) : '';
      const stat = sortBy === 'sessions' ? `${u.sessions_count}s`
                 : sortBy === 'posts' ? `${u.posts_count}p`
                 : '';
      row.innerHTML =
        '<span class="top-user-rank">#' + (i + 1) + '</span>' +
        '<span class="top-user-name">' + escapeHtml(u.username || u.email) + '</span>' +
        (stat ? '<span class="top-user-stat">' + stat + '</span>' : '') +
        '<span class="top-user-since">' + since + '</span>';
      row.onclick = () => openUserProfile(u.email);
      list.appendChild(row);
    });
    if (users.length === 0) list.innerHTML = '<div class="mod-empty">Aucun user.</div>';
  } catch (e) { list.innerHTML = '<div class="mod-empty">Erreur : ' + escapeHtml(e.message) + '</div>'; }
}

async function loadInactiveUsers() {
  const list = $('inactive-users-list');
  list.innerHTML = '<div class="mod-empty">Chargement…</div>';
  try {
    const days = parseInt($('inactive-days').value);
    const data = await callUserData('adminGetInactiveUsers', { days });
    const users = data.users || [];
    list.innerHTML = '';
    users.slice(0, 50).forEach((u, i) => {
      const row = document.createElement('div');
      row.className = 'top-user-row';
      const lastSeen = u.last_active
        ? 'vu ' + new Date(u.last_active).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
        : 'jamais vu';
      row.innerHTML =
        '<span class="top-user-rank">' + (i + 1) + '</span>' +
        '<span class="top-user-name">' + escapeHtml(u.username || u.email) + '</span>' +
        '<span class="top-user-since">' + lastSeen + '</span>';
      row.onclick = () => openUserProfile(u.email);
      list.appendChild(row);
    });
    if (users.length === 0) list.innerHTML = '<div class="mod-empty">Personne d\'inactif 🎉</div>';
  } catch (e) { list.innerHTML = '<div class="mod-empty">Erreur : ' + escapeHtml(e.message) + '</div>'; }
}

async function loadRetention() {
  const wrap = $('retention-cohorts');
  wrap.innerHTML = '<div class="mod-empty">Chargement…</div>';
  try {
    const data = await callUserData('adminGetRetention', { weeks: 12 });
    const cohorts = data.cohorts || [];
    wrap.innerHTML = '';
    if (cohorts.length === 0) { wrap.innerHTML = '<div class="mod-empty">Pas assez de données.</div>'; return; }
    cohorts.forEach(c => {
      const row = document.createElement('div');
      row.className = 'retention-row';
      const weekLabel = c.week === 0 ? 'Cette sem.' : '–' + c.week + ' sem.';
      row.innerHTML =
        '<span class="retention-week">' + weekLabel + '</span>' +
        '<span class="retention-count">' + c.active + '/' + c.total + '</span>' +
        '<div class="retention-bar-wrap"><div class="retention-bar" style="width:' + c.retention + '%"></div></div>' +
        '<span class="retention-pct">' + c.retention + '%</span>';
      wrap.appendChild(row);
    });
  } catch (e) { wrap.innerHTML = '<div class="mod-empty">Erreur : ' + escapeHtml(e.message) + '</div>'; }
}

async function exportCSV(kind) {
  try {
    toast('Préparation de l\'export...');
    const data = await callUserData('adminExportCSV', { kind });
    const blob = new Blob([data.csv || ''], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gesturo-' + kind + '-' + new Date().toISOString().split('T')[0] + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast('✓ Exporté ' + data.count + ' lignes', 'ok');
  } catch (e) { toast('Erreur : ' + e.message, 'err'); }
}

// Wrap loadAnalytics to also load extras
const _origLoadAnalytics = loadAnalytics;
loadAnalytics = async function() {
  await _origLoadAnalytics();
  loadTopUsers();
  loadInactiveUsers();
  loadRetention();
};

document.addEventListener('DOMContentLoaded', () => {
  $('top-users-sort').addEventListener('change', loadTopUsers);
  $('inactive-days').addEventListener('change', loadInactiveUsers);
  document.querySelectorAll('[data-export]').forEach(btn => {
    btn.addEventListener('click', () => exportCSV(btn.dataset.export));
  });
  // Auto-load errors badge at startup (after a delay)
  setTimeout(async () => {
    try {
      const d = await callUserData('adminListErrors', { limit: 1 });
      const badge = $('errors-badge');
      if (d.errors && d.errors.length) { badge.textContent = '!'; badge.classList.remove('hidden'); }
    } catch {}
  }, 1500);
});

// ── Scraper Panel ──────────────────────────────────────────────────────────
let scraperImages = [];    // { url, filename, selected }
let scraperBusy = false;

async function callScraper(action, payload) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error('not logged in');
  const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-scraper`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_PUBLISHABLE_KEY,
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function scraperScan() {
  const url = $('scraper-url').value.trim();
  if (!url) { toast('Colle une URL', 'err'); return; }
  if (scraperBusy) return;
  scraperBusy = true;
  const btn = $('scraper-scan-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Scan en cours…';
  setMsg($('scraper-msg'), 'Analyse de la page…');
  $('scraper-grid').textContent = 'Scan en cours…';

  try {
    const data = await callScraper('scan', { url });
    scraperImages = (data.images || []).map(img => ({ ...img, selected: true }));
    renderScraperGrid();
    setMsg($('scraper-msg'), `✓ ${scraperImages.length} image(s) trouvée(s)`, 'ok');
  } catch (e) {
    setMsg($('scraper-msg'), 'Erreur : ' + e.message, 'err');
    $('scraper-grid').textContent = 'Erreur lors du scan.';
  } finally {
    scraperBusy = false;
    btn.disabled = false;
    btn.textContent = '🔍 Scanner la page';
  }
}

function renderScraperGrid() {
  const grid = $('scraper-grid');
  const actions = $('scraper-actions');
  const count = $('scraper-count');
  const dlBtn = $('scraper-download-btn');

  const validImages = scraperImages.filter(i => !i.broken);
  if (validImages.length === 0) {
    grid.textContent = 'Aucune image trouvée.';
    actions.classList.add('hidden');
    count.textContent = '';
    return;
  }

  actions.classList.remove('hidden');
  const selectedCount = validImages.filter(i => i.selected).length;
  count.textContent = `(${selectedCount}/${validImages.length} sélectionnées)`;
  dlBtn.disabled = selectedCount === 0;

  grid.innerHTML = '';
  scraperImages.forEach((img, idx) => {
    if (img.broken) return; // hide broken images
    const card = document.createElement('div');
    card.className = 'scraper-card' + (img.selected ? ' selected' : '');
    const imgEl = document.createElement('img');
    imgEl.src = img.url;
    imgEl.alt = '';
    imgEl.loading = 'lazy';
    imgEl.onerror = () => {
      scraperImages[idx].broken = true;
      scraperImages[idx].selected = false;
      card.remove();
      // Update counts
      const valid = scraperImages.filter(i => !i.broken);
      const sel = valid.filter(i => i.selected);
      count.textContent = `(${sel.length}/${valid.length} sélectionnées)`;
      dlBtn.disabled = sel.length === 0;
    };
    card.innerHTML =
      '<div class="scraper-card-check">' + (img.selected ? '☑' : '☐') + '</div>'
      + '<div class="scraper-card-name" title="' + escapeHtml(img.filename) + '">' + escapeHtml(img.filename) + '</div>';
    card.insertBefore(imgEl, card.querySelector('.scraper-card-name'));
    card.addEventListener('click', () => {
      scraperImages[idx].selected = !scraperImages[idx].selected;
      renderScraperGrid();
    });
    grid.appendChild(card);
  });
}

function scraperSelectAll() {
  const valid = scraperImages.filter(i => !i.broken);
  const allSelected = valid.every(i => i.selected);
  scraperImages.forEach(i => { if (!i.broken) i.selected = !allSelected; });
  renderScraperGrid();
}

function getScraperDestMode() {
  const radio = document.querySelector('input[name="scraper-dest-mode"]:checked');
  return radio ? radio.value : 'r2';
}

async function scraperDownload() {
  const selected = scraperImages.filter(i => i.selected && !i.broken);
  if (selected.length === 0) { toast('Aucune image sélectionnée', 'err'); return; }
  if (scraperBusy) return;

  const mode = getScraperDestMode();
  if (mode === 'local') return scraperDownloadLocal(selected);
  return scraperDownloadR2(selected);
}

async function scraperDownloadR2(selected) {
  scraperBusy = true;
  const dlBtn = $('scraper-download-btn');
  dlBtn.disabled = true;
  dlBtn.textContent = '⏳ Upload R2…';

  let dest = $('scraper-dest').value.trim();
  if (!dest.endsWith('/')) dest += '/';
  const dateFolder = new Date().toISOString().slice(0, 10) + '/';
  dest += dateFolder;

  const quality = parseInt($('scraper-quality').value) || 75;
  const progressBar = $('scraper-progress');
  const progressFill = $('scraper-progress-fill');
  const progressText = $('scraper-progress-text');
  progressBar.classList.remove('hidden');

  const batchSize = 10;
  let done = 0;
  let okTotal = 0;
  let failTotal = 0;

  for (let i = 0; i < selected.length; i += batchSize) {
    const batch = selected.slice(i, i + batchSize);
    const pct = Math.round((i / selected.length) * 100);
    progressFill.style.width = pct + '%';
    progressText.textContent = `${done}/${selected.length} images traitées…`;

    try {
      const data = await callScraper('download', {
        images: batch.map(img => ({ url: img.url, filename: img.filename })),
        destPrefix: dest,
        quality,
      });
      okTotal += data.ok || 0;
      failTotal += data.failed || 0;
    } catch (e) {
      failTotal += batch.length;
      toast('Erreur batch : ' + e.message, 'err');
    }
    done += batch.length;
  }

  progressFill.style.width = '100%';
  progressText.textContent = `✓ ${okTotal} uploadées, ${failTotal} échec(s)`;
  toast(`✓ ${okTotal} images uploadées dans R2`, okTotal > 0 ? 'ok' : 'err');

  scraperBusy = false;
  dlBtn.disabled = false;
  dlBtn.textContent = '⬇ Télécharger la sélection';
}

async function scraperDownloadLocal(selected) {
  scraperBusy = true;
  const dlBtn = $('scraper-download-btn');
  dlBtn.disabled = true;
  dlBtn.textContent = '⏳ Téléchargement…';

  const progressBar = $('scraper-progress');
  const progressFill = $('scraper-progress-fill');
  const progressText = $('scraper-progress-text');
  progressBar.classList.remove('hidden');
  progressFill.style.width = '30%';
  progressText.textContent = 'Téléchargement côté serveur…';

  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { toast('Pas de session', 'err'); throw new Error('no session'); }

    const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-scraper`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_PUBLISHABLE_KEY,
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        action: 'download-zip',
        images: selected.map(img => ({ url: img.url, filename: img.filename })),
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    progressFill.style.width = '80%';
    progressText.textContent = 'Réception du ZIP…';

    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'gesturo-scrape-' + new Date().toISOString().slice(0, 10) + '.zip';
    a.click();
    URL.revokeObjectURL(a.href);

    progressFill.style.width = '100%';
    progressText.textContent = `✓ ZIP téléchargé (${selected.length} images)`;
    toast(`✓ ZIP téléchargé`, 'ok');
  } catch (e) {
    toast('Erreur : ' + e.message, 'err');
    progressText.textContent = 'Erreur';
  }

  scraperBusy = false;
  dlBtn.disabled = false;
  dlBtn.textContent = '⬇ Télécharger la sélection';
}

// Listen for images sent by the bookmarklet via postMessage
window.addEventListener('message', (e) => {
  if (!e.data || e.data.type !== 'gesturo-scraper-images') return;
  const urls = e.data.images || [];
  if (urls.length === 0) { toast('Aucune image trouvée par le bookmarklet', 'err'); return; }
  // Switch to scraper panel
  document.querySelectorAll('.admin-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.panel === 'scraper'));
  document.querySelectorAll('.admin-panel').forEach(p => p.classList.toggle('hidden', p.id !== 'panel-scraper'));
  // Populate images
  scraperImages = urls.map((url, i) => {
    const path = new URL(url).pathname;
    const base = path.split('/').pop() || ('image_' + i);
    return { url, filename: sanitizeFilenameClient(base), selected: true };
  });
  renderScraperGrid();
  setMsg($('scraper-msg'), `✓ ${scraperImages.length} image(s) reçues du bookmarklet`, 'ok');
  toast(`${scraperImages.length} images reçues`, 'ok');
});

function sanitizeFilenameClient(name) {
  return name.replace(/[\\/:*?"<>|]/g, '_').replace(/^\.+/, '').trim() || 'image';
}

function buildBookmarklet() {
  const supabaseUrl = SUPABASE_URL;
  const supabaseKey = SUPABASE_PUBLISHABLE_KEY;
  const code = `
(function(){
if(document.getElementById('gesturo-scraper-overlay')){document.getElementById('gesturo-scraper-overlay').remove();return;}
var imgs=new Set();
document.querySelectorAll('img').forEach(function(el){
  var s=el.currentSrc||el.src;
  if(!s||s.startsWith('data:')||s.length<30)return;
  if(el.naturalWidth<80||el.naturalHeight<80)return;
  if(/icon|logo|favicon|sprite|avatar|emoji|badge|spacer/i.test(s))return;
  if(s.includes('pinimg.com'))s=s.replace(/\\/\\d+x\\//g,'/originals/');
  imgs.add(s);
});
document.querySelectorAll('[style*=background-image]').forEach(function(el){
  var m=el.style.backgroundImage.match(/url\\(["']?([^"')]+)/);
  if(m&&m[1]&&!m[1].startsWith('data:')&&m[1].length>30){
    var u=m[1];
    if(u.includes('pinimg.com'))u=u.replace(/\\/\\d+x\\//g,'/originals/');
    imgs.add(u);
  }
});
var arr=Array.from(imgs);
if(!arr.length){alert('Gesturo: aucune image. Scroll la page et réessaie.');return;}
var sel=new Set(arr);
var ov=document.createElement('div');
ov.id='gesturo-scraper-overlay';
ov.style.cssText='position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,0.92);display:flex;flex-direction:column;font-family:-apple-system,sans-serif;color:#fff;';
var hdr=document.createElement('div');
hdr.style.cssText='display:flex;align-items:center;justify-content:space-between;padding:12px 20px;background:#111;border-bottom:1px solid #333;flex-shrink:0;';
hdr.innerHTML='<div style="display:flex;align-items:center;gap:12px"><b style="font-size:18px;color:#f0c040">Gesturo Scraper</b><span id="gs-count" style="color:#888">'+arr.length+' images</span></div><div style="display:flex;gap:8px"><button id="gs-selall" style="padding:6px 14px;background:#333;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px">Tout sélectionner</button><button id="gs-zip" style="padding:6px 14px;background:#5b9bd5;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600">⬇ ZIP</button><button id="gs-r2" style="padding:6px 14px;background:#7dd097;color:#111;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600">☁ Upload R2</button><button id="gs-close" style="padding:6px 14px;background:#E24B4A;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px">✕</button></div>';
ov.appendChild(hdr);
var grid=document.createElement('div');
grid.id='gs-grid';
grid.style.cssText='display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;padding:16px;overflow-y:auto;flex:1;';
ov.appendChild(grid);
var status=document.createElement('div');
status.id='gs-status';
status.style.cssText='padding:8px 20px;background:#111;border-top:1px solid #333;font-size:13px;color:#888;flex-shrink:0;display:none;';
ov.appendChild(status);
document.body.appendChild(ov);
function render(){
  grid.innerHTML='';
  var c=0;
  arr.forEach(function(url,i){
    var card=document.createElement('div');
    card.style.cssText='position:relative;border-radius:8px;overflow:hidden;cursor:pointer;border:2px solid '+(sel.has(url)?'#5b9bd5':'#333')+';';
    var img=document.createElement('img');
    img.src=url;img.style.cssText='width:100%;aspect-ratio:1;object-fit:cover;display:block;';
    img.onerror=function(){card.remove();arr.splice(arr.indexOf(url),1);sel.delete(url);updCount();};
    var chk=document.createElement('div');
    chk.style.cssText='position:absolute;top:4px;left:4px;background:rgba(0,0,0,0.7);border-radius:4px;padding:2px 6px;font-size:14px;';
    chk.textContent=sel.has(url)?'☑':'☐';
    card.appendChild(img);card.appendChild(chk);
    card.onclick=function(){if(sel.has(url))sel.delete(url);else sel.add(url);render();};
    grid.appendChild(card);
    if(sel.has(url))c++;
  });
  updCount();
}
function updCount(){document.getElementById('gs-count').textContent=sel.size+'/'+arr.length+' sélectionnées';}
render();
document.getElementById('gs-close').onclick=function(){ov.remove();};
document.getElementById('gs-selall').onclick=function(){
  if(sel.size===arr.length){sel.clear();}else{arr.forEach(function(u){sel.add(u);});}
  render();
};
document.getElementById('gs-zip').onclick=function(){dl('zip');};
document.getElementById('gs-r2').onclick=function(){dl('r2');};
async function dl(mode){
  var selected=Array.from(sel);
  if(!selected.length){alert('Sélectionne au moins une image');return;}
  var st=document.getElementById('gs-status');
  st.style.display='block';
  st.textContent='Connexion…';
  try{
    var token=localStorage.getItem('gesturo-scraper-token');
    if(!token){
      token=prompt('Colle ton token Gesturo (copie-le depuis l\\'admin → onglet Scraper)');
      if(!token){st.style.display='none';return;}
      localStorage.setItem('gesturo-scraper-token',token);
    }
    var imgs=selected.map(function(u,i){
      var p=new URL(u).pathname;var f=p.split('/').pop()||('img_'+i+'.jpg');
      return{url:u,filename:f};
    });
    if(mode==='r2'){
      st.textContent='Upload vers R2 (0/'+imgs.length+')…';
      var batch=10,ok=0,fail=0;
      for(var i=0;i<imgs.length;i+=batch){
        var b=imgs.slice(i,i+batch);
        var dest='Sessions/current/scraped/'+new Date().toISOString().slice(0,10)+'/';
        var r=await fetch('${supabaseUrl}/functions/v1/admin-scraper',{
          method:'POST',
          headers:{'Content-Type':'application/json','apikey':'${supabaseKey}','Authorization':'Bearer '+token},
          body:JSON.stringify({action:'download',images:b,destPrefix:dest,quality:75})
        });
        if(r.ok){var d=await r.json();ok+=d.ok||0;fail+=d.failed||0;}else{fail+=b.length;}
        st.textContent='Upload vers R2 ('+Math.min(i+batch,imgs.length)+'/'+imgs.length+')… ✓'+ok+' ✕'+fail;
      }
      st.textContent='✓ '+ok+' images uploadées dans R2'+(fail?' · '+fail+' échecs':'');
    }else{
      st.textContent='Création du ZIP côté serveur…';
      var r=await fetch('${supabaseUrl}/functions/v1/admin-scraper',{
        method:'POST',
        headers:{'Content-Type':'application/json','apikey':'${supabaseKey}','Authorization':'Bearer '+token},
        body:JSON.stringify({action:'download-zip',images:imgs})
      });
      if(!r.ok){st.textContent='Erreur: '+r.status;return;}
      var blob=await r.blob();
      var a=document.createElement('a');
      a.href=URL.createObjectURL(blob);
      a.download='gesturo-scrape-'+new Date().toISOString().slice(0,10)+'.zip';
      a.click();
      st.textContent='✓ ZIP téléchargé ('+imgs.length+' images)';
    }
  }catch(e){
    if(e.message&&e.message.includes('401')){localStorage.removeItem('gesturo-scraper-token');st.textContent='Token expiré. Recopie-le depuis l\\'admin et réessaie.';}
    else st.textContent='Erreur: '+e.message;
  }
}
})()`;
  return 'javascript:' + encodeURIComponent(code.replace(/\n\s*/g, ''));
}

document.addEventListener('DOMContentLoaded', () => {
  const scanBtn = $('scraper-scan-btn');
  if (scanBtn) {
    scanBtn.addEventListener('click', scraperScan);
    $('scraper-select-all').addEventListener('click', scraperSelectAll);
    $('scraper-download-btn').addEventListener('click', scraperDownload);
    $('scraper-url').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); scraperScan(); }
    });
    // Build bookmarklet
    const bm = $('scraper-bookmarklet');
    if (bm) bm.href = buildBookmarklet();
    // Copy token button
    const copyTokenBtn = $('scraper-copy-token');
    if (copyTokenBtn) copyTokenBtn.addEventListener('click', async () => {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) { toast('Pas de session', 'err'); return; }
      await navigator.clipboard.writeText(session.access_token);
      $('scraper-token-msg').textContent = '✓ Token copié ! Colle-le quand le bookmarklet te le demande.';
      toast('Token copié', 'ok');
    });
  }
});

// ── Blog panel ─────────────────────────────────────────────────────────────
// Publishes articles to gesturo-website repo via GitHub API.
// GitHub token is stored in localStorage (set once, persists).

const GITHUB_REPO = 'Vesanerie/gesturo-website';
const BLOG_OG_IMAGE = 'https://pub-06c22b8e08f544fea3cf8dfe718bfe78.r2.dev/gesturo-og.jpg';

function getGithubToken() {
  let token = localStorage.getItem('gesturo_github_token');
  if (!token) {
    token = prompt('Entre ton GitHub Personal Access Token (fine-grained, repo contents write).\nIl sera sauvegarde localement.');
    if (token) localStorage.setItem('gesturo_github_token', token.trim());
  }
  return token ? token.trim() : null;
}

async function githubAPI(method, path, body) {
  const token = getGithubToken();
  if (!token) throw new Error('Pas de token GitHub');
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `GitHub ${res.status}`);
  }
  return res.json();
}

async function githubGetFile(path) {
  const token = getGithubToken();
  if (!token) throw new Error('Pas de token GitHub');
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${path}?ref=main`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
    },
  });
  if (!res.ok) return null;
  return res.json();
}

// Load existing articles from the blog index
async function loadBlogList() {
  const list = $('blog-list');
  list.innerHTML = '<div class="muted">Chargement...</div>';
  try {
    const data = await githubGetFile('blog/index.html');
    if (!data) { list.innerHTML = '<div class="muted">Impossible de charger le blog</div>'; return; }
    const html = atob(data.content);
    // Parse article cards from the HTML
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const cards = doc.querySelectorAll('.article-card');
    if (cards.length === 0) {
      list.innerHTML = '<div class="muted">Aucun article publie</div>';
      return;
    }
    list.innerHTML = '';
    cards.forEach(card => {
      const title = card.querySelector('.article-title')?.textContent || 'Sans titre';
      const date = card.querySelector('.article-meta')?.textContent || '';
      const href = card.getAttribute('href') || '';
      const el = document.createElement('div');
      el.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:rgba(255,255,255,0.02);border:0.5px solid rgba(200,214,229,0.08);border-radius:10px;';
      el.innerHTML = `<div><strong>${title}</strong><br><span class="muted" style="font-size:12px;">${date} — ${href}</span></div>
        <a href="https://gesturo.fr${href}" target="_blank" class="btn-secondary" style="padding:6px 12px;font-size:12px;">Voir</a>`;
      list.appendChild(el);
    });
  } catch (e) {
    list.innerHTML = `<div class="msg err">${e.message}</div>`;
  }
}

function showBlogEditor(article) {
  $('blog-editor').style.display = 'block';
  $('blog-editor-title').textContent = article ? 'Modifier l\'article' : 'Nouvel article';
  if (!article) {
    $('blog-title').value = '';
    $('blog-slug').value = '';
    $('blog-category').value = 'Guide';
    $('blog-readtime').value = '6 min de lecture';
    $('blog-description').value = '';
    $('blog-keywords').value = '';
    $('blog-excerpt').value = '';
    $('blog-content').value = '';
  }
  $('blog-title').focus();
}

function hideBlogEditor() {
  $('blog-editor').style.display = 'none';
  setMsg($('blog-msg'), '');
}

// Auto-generate slug from title
document.addEventListener('DOMContentLoaded', () => {
  const titleInput = $('blog-title');
  const slugInput = $('blog-slug');
  if (titleInput && slugInput) {
    titleInput.addEventListener('input', () => {
      if (!slugInput.dataset.manual) {
        slugInput.value = titleInput.value
          .toLowerCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 80);
      }
    });
    slugInput.addEventListener('input', () => { slugInput.dataset.manual = '1'; });
  }
});

// Toolbar: insert HTML tags
function blogInsertTag(tag) {
  const ta = $('blog-content');
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const selected = ta.value.substring(start, end);
  let insert = '';
  if (tag === 'ul') {
    insert = `<ul>\n  <li>${selected || 'Element'}</li>\n  <li></li>\n</ul>`;
  } else if (tag === 'a') {
    const url = prompt('URL du lien :', 'https://gesturo.fr');
    if (!url) return;
    insert = `<a href="${url}">${selected || 'texte du lien'}</a>`;
  } else if (tag === 'p') {
    insert = `<p>${selected || ''}</p>`;
  } else {
    insert = `<${tag}>${selected || ''}</${tag}>`;
  }
  ta.value = ta.value.substring(0, start) + insert + ta.value.substring(end);
  ta.focus();
  ta.selectionStart = ta.selectionEnd = start + insert.length;
}

// Upload image to R2 via admin-r2 presigned URL, insert <img> tag
function blogInsertImage() {
  const input = $('blog-image-input');
  input.value = '';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const ta = $('blog-content');
    const slug = $('blog-slug').value || 'article';
    const ext = file.name.split('.').pop().toLowerCase();
    const filename = `blog-${slug}-${Date.now()}.${ext}`;
    const key = `Blog/${filename}`;

    toast('Upload de l\'image...', undefined, 8000);
    try {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) throw new Error('Pas de session');
      // Get presigned PUT URL from admin-r2
      const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-r2`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_PUBLISHABLE_KEY,
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ action: 'upload-urls', keys: [key] }),
      });
      if (!res.ok) throw new Error('Erreur presigned URL');
      const data = await res.json();
      const putUrl = data.urls[0];

      // Upload to R2
      const putRes = await fetch(putUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!putRes.ok) throw new Error('Upload R2 echoue');

      // Build public URL
      const publicUrl = `https://pub-06c22b8e08f544fea3cf8dfe718bfe78.r2.dev/${key}`;

      // Insert img tag at cursor
      const imgTag = `<img src="${publicUrl}" alt="${prompt('Description de l\'image (alt text) :', file.name) || file.name}" loading="lazy">`;
      const pos = ta.selectionStart;
      ta.value = ta.value.substring(0, pos) + '\n' + imgTag + '\n' + ta.value.substring(pos);
      ta.focus();
      toast('Image uploadee et inseree', 'ok');
    } catch (e) {
      toast('Erreur upload : ' + e.message, 'err');
    }
  };
  input.click();
}

// Preview in new tab
function previewBlogArticle() {
  const content = $('blog-content').value;
  const title = $('blog-title').value || 'Apercu';
  const category = $('blog-category').value;
  const html = buildArticleHTML({
    title, slug: 'preview', description: '', keywords: '', category,
    readTime: $('blog-readtime').value, content,
    dateDisplay: new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }),
    dateISO: new Date().toISOString().split('T')[0],
  });
  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
}

// Publish article to GitHub
async function publishBlogArticle() {
  const title = $('blog-title').value.trim();
  const slug = $('blog-slug').value.trim();
  const description = $('blog-description').value.trim();
  const keywords = $('blog-keywords').value.trim();
  const category = $('blog-category').value;
  const readTime = $('blog-readtime').value.trim();
  const excerpt = $('blog-excerpt').value.trim();
  const content = $('blog-content').value;

  if (!title || !slug || !content) {
    setMsg($('blog-msg'), 'Titre, slug et contenu sont obligatoires.', 'err');
    return;
  }

  const btn = $('blog-publish-btn');
  btn.disabled = true;
  btn.textContent = 'Publication...';
  setMsg($('blog-msg'), 'Publication en cours...', '');

  const now = new Date();
  const months = ['janvier','fevrier','mars','avril','mai','juin','juillet','aout','septembre','octobre','novembre','decembre'];
  const dateDisplay = `${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
  const dateISO = now.toISOString().split('T')[0];

  const article = { title, slug, description, keywords, category, readTime, content, dateDisplay, dateISO };

  try {
    // 1. Push article HTML
    const articleHtml = buildArticleHTML(article);
    await githubAPI('PUT', `blog/${slug}.html`, {
      message: `feat(blog): ${title}`,
      content: btoa(unescape(encodeURIComponent(articleHtml))),
      branch: 'main',
    });

    // 2. Update blog/index.html — add card
    const indexData = await githubGetFile('blog/index.html');
    if (indexData) {
      let indexHtml = decodeURIComponent(escape(atob(indexData.content)));
      const card = `\n  <a href="/blog/${slug}.html" class="article-card">\n    <img class="article-thumb" src="${BLOG_OG_IMAGE}" alt="${title}" loading="lazy">\n    <div class="article-body">\n      <div class="article-tag">${category}</div>\n      <h2 class="article-title">${title}</h2>\n      <p class="article-excerpt">${excerpt || description}</p>\n      <span class="article-meta">${dateDisplay}</span>\n    </div>\n  </a>\n`;
      const marker = '============================================================\n  -->';
      indexHtml = indexHtml.replace(marker, marker + card);
      await githubAPI('PUT', 'blog/index.html', {
        message: `feat(blog): add card for ${slug}`,
        content: btoa(unescape(encodeURIComponent(indexHtml))),
        sha: indexData.sha,
        branch: 'main',
      });
    }

    // 3. Update sitemap.xml — add entry
    const sitemapData = await githubGetFile('sitemap.xml');
    if (sitemapData) {
      let sitemap = decodeURIComponent(escape(atob(sitemapData.content)));
      const entry = `\n  <url>\n    <loc>https://gesturo.fr/blog/${slug}.html</loc>\n    <lastmod>${dateISO}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.8</priority>\n  </url>`;
      sitemap = sitemap.replace('</urlset>', entry + '\n</urlset>');
      await githubAPI('PUT', 'sitemap.xml', {
        message: `feat(blog): sitemap entry for ${slug}`,
        content: btoa(unescape(encodeURIComponent(sitemap))),
        sha: sitemapData.sha,
        branch: 'main',
      });
    }

    setMsg($('blog-msg'), '✓ Article publie ! Deploy en cours via GitHub Actions → O2Switch.', 'ok');
    toast('Article publie sur gesturo.fr !', 'ok', 6000);
    hideBlogEditor();
    loadBlogList();
  } catch (e) {
    setMsg($('blog-msg'), 'Erreur : ' + e.message, 'err');
    toast('Erreur publication : ' + e.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Publier sur gesturo.fr';
  }
}

function buildArticleHTML(a) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${a.title} — Blog Gesturo</title>
  <meta name="description" content="${a.description}">
  <meta name="keywords" content="${a.keywords}">
  <link rel="canonical" href="https://gesturo.fr/blog/${a.slug}.html">
  <meta name="robots" content="index, follow">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="Gesturo">
  <meta property="og:title" content="${a.title}">
  <meta property="og:description" content="${a.description}">
  <meta property="og:url" content="https://gesturo.fr/blog/${a.slug}.html">
  <meta property="og:image" content="${BLOG_OG_IMAGE}">
  <meta property="og:locale" content="fr_FR">
  <meta property="article:published_time" content="${a.dateISO}">
  <meta property="article:author" content="Gesturo">
  <meta property="article:section" content="${a.category}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${a.title}">
  <meta name="twitter:description" content="${a.description}">
  <meta name="twitter:image" content="${BLOG_OG_IMAGE}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;700;800&family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400&display=swap" rel="stylesheet">
  <style>
    :root{--bg:#0c1520;--bg-deep:#0a1118;--bg2:#131e2c;--bg3:#182536;--surface:rgba(19,30,44,0.6);--surface-hover:rgba(24,37,54,0.75);--border:rgba(200,214,229,0.08);--border-strong:rgba(200,214,229,0.18);--accent:#5b9bd5;--accent-strong:#2983eb;--warm:#f0c040;--warm-soft:rgba(240,192,64,0.12);--warm-glow:rgba(240,192,64,0.3);--text:#e8dfd0;--text-soft:#c8d6e5;--muted:#8aaccc;--muted2:#4a6280;--radius:14px;--radius-lg:20px;--ease:cubic-bezier(0.4,0,0.2,1)}*{box-sizing:border-box;margin:0;padding:0}html{scroll-behavior:smooth}body{font-family:'DM Sans',sans-serif;background:linear-gradient(180deg,#0c1520 0%,#0a1118 100%);background-attachment:fixed;color:var(--text);overflow-x:hidden;line-height:1.65;min-height:100vh}body::before{content:'';position:fixed;inset:0;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.55'/%3E%3C/svg%3E");pointer-events:none;z-index:0;opacity:0.35;mix-blend-mode:overlay}nav{position:fixed;top:0;left:0;right:0;z-index:100;display:flex;align-items:center;justify-content:space-between;padding:20px 48px;background:rgba(12,21,32,0.72);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border-bottom:0.5px solid var(--border)}.nav-logo{font-family:'Syne',sans-serif;font-weight:800;font-size:20px;letter-spacing:-0.5px;color:var(--text);text-decoration:none}.nav-logo span{color:var(--warm);text-shadow:0 0 20px var(--warm-glow)}.nav-right{display:flex;align-items:center;gap:24px}.nav-link{color:var(--muted);text-decoration:none;font-size:14px;transition:color .3s var(--ease)}.nav-link:hover{color:var(--warm)}.nav-cta{background:var(--accent-strong);color:#fff;border:none;border-radius:10px;padding:10px 20px;font-family:'DM Sans',sans-serif;font-size:14px;font-weight:500;cursor:pointer;text-decoration:none;transition:all .4s var(--ease);box-shadow:0 4px 20px rgba(41,131,235,0.25)}.nav-cta:hover{background:#4499f5;transform:translateY(-1px)}.article-header{padding:140px 24px 40px;text-align:center;max-width:760px;margin:0 auto;position:relative;z-index:1}.article-header .tag{display:inline-block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1.5px;color:var(--warm);background:var(--warm-soft);border:0.5px solid rgba(240,192,64,0.3);border-radius:99px;padding:5px 14px;margin-bottom:20px}.article-header h1{font-family:'Syne',sans-serif;font-weight:800;font-size:clamp(30px,5vw,48px);letter-spacing:-1.5px;line-height:1.1;margin-bottom:16px}.article-header .meta{font-size:14px;color:var(--muted2)}.article-content{max-width:700px;margin:0 auto;padding:40px 24px 100px;position:relative;z-index:1}.article-content h2{font-family:'Syne',sans-serif;font-weight:700;font-size:26px;letter-spacing:-0.5px;margin:48px 0 16px;color:var(--text)}.article-content h3{font-family:'Syne',sans-serif;font-weight:700;font-size:20px;margin:32px 0 12px;color:var(--text)}.article-content p{font-size:16px;color:var(--text-soft);line-height:1.85;margin-bottom:20px}.article-content ul,.article-content ol{margin:0 0 20px 24px;color:var(--text-soft);font-size:16px;line-height:1.85}.article-content li{margin-bottom:8px}.article-content strong{color:var(--text);font-weight:600}.article-content em{color:var(--warm);font-style:normal}.article-content blockquote{border-left:3px solid var(--warm);padding:16px 24px;margin:24px 0;background:var(--warm-soft);border-radius:0 var(--radius) var(--radius) 0;font-style:italic;color:var(--text-soft)}.article-content img{width:100%;border-radius:var(--radius);border:0.5px solid var(--border-strong);margin:24px 0}.article-content a{color:var(--accent);text-decoration:underline;transition:color .3s}.article-content a:hover{color:var(--warm)}.cta-box{background:var(--surface);border:0.5px solid var(--border-strong);border-radius:var(--radius-lg);padding:40px;text-align:center;margin:48px 0;backdrop-filter:blur(12px)}.cta-box h3{font-family:'Syne',sans-serif;font-weight:700;font-size:22px;margin-bottom:12px}.cta-box p{font-size:15px;color:var(--muted);margin-bottom:20px}.cta-box a{display:inline-block;background:var(--accent-strong);color:#fff;border-radius:12px;padding:14px 28px;font-weight:500;text-decoration:none;transition:all .4s var(--ease);box-shadow:0 8px 30px rgba(41,131,235,0.28)}.cta-box a:hover{background:#4499f5;transform:translateY(-2px)}.back-link{display:inline-flex;align-items:center;gap:6px;color:var(--muted);text-decoration:none;font-size:14px;margin-bottom:40px;transition:color .3s}.back-link:hover{color:var(--warm)}footer{padding:36px 48px;border-top:0.5px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap;background:rgba(10,17,28,0.35);position:relative;z-index:1;backdrop-filter:blur(6px)}footer .logo{font-family:'Syne',sans-serif;font-weight:800;font-size:16px;color:var(--text)}footer .logo span{color:var(--warm)}footer p{font-size:13px;color:var(--muted)}footer a{color:var(--muted);text-decoration:none;font-size:13px;transition:color .3s}footer a:hover{color:var(--warm)}.footer-links{display:flex;gap:24px}@media(max-width:640px){nav{padding:16px 20px}.article-header{padding:120px 20px 30px}.article-content{padding:30px 20px 80px}footer{padding:24px;flex-direction:column;text-align:center}.footer-links{justify-content:center}}
  </style>
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"Article","headline":"${a.title}","description":"${a.description}","image":"${BLOG_OG_IMAGE}","datePublished":"${a.dateISO}","dateModified":"${a.dateISO}","author":{"@type":"Organization","name":"Gesturo","url":"https://gesturo.fr"},"publisher":{"@type":"Organization","name":"Gesturo","url":"https://gesturo.fr"},"mainEntityOfPage":"https://gesturo.fr/blog/${a.slug}.html","keywords":"${a.keywords}","inLanguage":"fr","articleSection":"${a.category}"}
  </script>
</head>
<body>
<nav aria-label="Navigation blog Gesturo">
  <a href="/" class="nav-logo">Gestur<span>o</span></a>
  <div class="nav-right">
    <a href="/" class="nav-link">Accueil</a>
    <a href="/blog/" class="nav-link" style="color:var(--warm);">Blog</a>
    <a href="/#waitlist" class="nav-cta">Rejoindre la beta</a>
  </div>
</nav>
<article>
  <header class="article-header">
    <span class="tag">${a.category}</span>
    <h1>${a.title}</h1>
    <p class="meta">${a.dateDisplay} &middot; ${a.readTime}</p>
  </header>
  <div class="article-content">
    <a href="/blog/" class="back-link">&larr; Retour au blog</a>
    ${a.content}
    <div class="cta-box">
      <h3>Pret a passer a l'action ?</h3>
      <p>Gesturo te donne 1 900+ photos de modele vivant, un minuteur precis et tout ce qu'il faut pour progresser en gesture drawing. Gratuit pour commencer.</p>
      <a href="https://gesturo.fr/#waitlist">Essayer Gesturo gratuitement</a>
    </div>
    <a href="/blog/" class="back-link">&larr; Tous les articles</a>
  </div>
</article>
<footer>
  <div class="logo">Gestur<span>o</span></div>
  <p>&copy; 2026 Gesturo — Application de gesture drawing et dessin de modele vivant.</p>
  <div class="footer-links">
    <a href="/">Accueil</a>
    <a href="mailto:hello@gesturo.art">Contact</a>
    <a href="/mentions-legales.html">Mentions legales</a>
  </div>
</footer>
</body>
</html>`;
}

init();
