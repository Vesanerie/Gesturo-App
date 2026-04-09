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

// Custom MIME type used to distinguish in-app drags (file → folder moves)
// from OS file drops (uploads). The dataTransfer carries a JSON array of keys.
const IN_APP_MIME = 'application/x-gesturo-keys';

// ── File browser state ─────────────────────────────────────────────────────
let currentPrefix = 'Sessions/current/';   // always ends with '/'
let currentRoot   = 'Sessions/current/';   // remembers which "tab" is active
let currentFiles  = [];                    // last loaded files (for shift-click range)
const selected   = new Set();              // selected file keys (clears on navigation)

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
    if (pendingMsg) {
      setMsg(msg, pendingMsg.text, pendingMsg.kind);
      const captured = pendingMsg;
      pendingMsg = null;
      // Auto-clear after a few seconds, but only if nothing else has overwritten it.
      setTimeout(() => { if (msg.textContent === captured.text) setMsg(msg, ''); }, 4000);
    } else {
      setMsg(msg, '');
    }
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
    await callAdmin('move', { keys, destPrefix }, `Déplacement vers ${destPrefix}…`);
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
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openCtxMenu(e.clientX, e.clientY, { folder: f });
    });
    // Folders are valid drop targets for in-app moves.
    attachDropTarget(card, f.prefix);
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

    // In-app drag: allow dragging files onto folders / breadcrumbs to move them.
    // If the dragged file is part of the current selection, move the whole
    // selection. Otherwise just the single dragged file.
    card.draggable = true;
    card.addEventListener('dragstart', (e) => {
      const keysToMove = selected.has(it.key) && selected.size > 0 ? [...selected] : [it.key];
      e.dataTransfer.setData(IN_APP_MIME, JSON.stringify(keysToMove));
      e.dataTransfer.effectAllowed = 'move';
    });

    // Right-click → context menu. If the file isn't already selected, select
    // just it before opening the menu (Finder behavior).
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!selected.has(it.key)) {
        selected.clear();
        selected.add(it.key);
        document.querySelectorAll('.grid-item[data-key]').forEach((el) => {
          el.classList.toggle('selected', selected.has(el.dataset.key));
        });
        updateActionBar();
      }
      openCtxMenu(e.clientX, e.clientY, { url: it.url });
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
  // In archive zones, show Restaurer instead of Archiver.
  const inArchive = currentPrefix.includes('/archive/');
  $('action-restore').style.display = inArchive ? '' : 'none';
  $('action-archive').style.display = inArchive ? 'none' : '';
}

document.getElementById('action-restore').addEventListener('click', async () => {
  if (selected.size === 0) return;
  await callAdmin('unarchive', { keys: [...selected] }, 'Restauration…');
});

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
    // Stash the result so loadGrid() can display it AFTER it finishes rendering
    // (otherwise its "Chargement…" placeholder wipes the success message).
    pendingMsg = {
      text: `✓ ${okCount} ok${failCount ? ` · ${failCount} échec(s)` : ''}`,
      kind: failCount ? 'err' : 'ok',
    };
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

init();
