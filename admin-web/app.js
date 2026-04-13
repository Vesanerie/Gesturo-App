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
function thumbUrl(url, w = 300) {
  return `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=${w}&output=webp&q=70`;
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

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
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
          if (act === 'reject' && !confirm('Rejeter et supprimer définitivement ce post ?')) return;
          try {
            await callUserData(act === 'approve' ? 'adminApprovePost' : 'adminRejectPost', { postId: p.id });
            toast(act === 'approve' ? 'Post approuvé' : 'Post rejeté et supprimé', 'ok');
            loadModerationPosts();
            loadModerationStats();
          } catch (e) { toast('Erreur : ' + e.message, 'err'); }
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
  // Batch reject
  $('mod-reject-all').addEventListener('click', async () => {
    if (_modSelected.size === 0) return;
    if (!confirm(`Rejeter et supprimer définitivement ${_modSelected.size} post(s) ?\nLes images seront supprimées de R2.`)) return;
    try {
      await callUserData('adminRejectPost', { postIds: [..._modSelected] });
      toast(`${_modSelected.size} post(s) rejeté(s) et supprimé(s)`, 'ok');
      loadModerationPosts();
      loadModerationStats();
    } catch (e) { toast('Erreur : ' + e.message, 'err'); }
  });
});

init();
