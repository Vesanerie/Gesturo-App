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

document.querySelectorAll('.root-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    currentRoot = btn.dataset.root;
    currentPrefix = currentRoot;
    loadGrid();
  });
});

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
  setActiveRoot();
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
      btn.addEventListener('click', () => { currentPrefix = target; loadGrid(); });
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
    card.innerHTML = `<div class="icon">📁</div><div class="name">${escapeHtml(f.name)}</div>`;
    card.addEventListener('click', () => { currentPrefix = f.prefix; loadGrid(); });
    grid.appendChild(card);
  }
  const slice = files.slice(0, 500);
  for (const it of slice) {
    const card = document.createElement('div');
    card.className = 'grid-item';
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = thumbUrl(it.url);
    img.alt = it.name;
    card.appendChild(img);
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = it.name;
    card.appendChild(label);
    grid.appendChild(card);
  }
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

init();
