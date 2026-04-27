
// ══ FAVORIS ══
const FAV_KEY = 'gd4_favorites'

// Scoped storage helpers — canonical implementation in src/lib/scoped-storage.js
// Kept as thin wrappers here so existing global callers still work.
function _scopedKey(base) {
  const email = (typeof _communityEmail === 'string' ? _communityEmail : '').toLowerCase()
  return email ? base + ':' + email : base
}
function _readScoped(base) {
  const sk = _scopedKey(base)
  let raw = localStorage.getItem(sk)
  if (raw === null && sk !== base) {
    const legacy = localStorage.getItem(base)
    if (legacy !== null) {
      localStorage.setItem(sk, legacy)
      localStorage.removeItem(base)
      raw = legacy
    }
  }
  return raw
}
function _writeScoped(base, value) {
  localStorage.setItem(_scopedKey(base), value)
}
function loadFavs() { try { return JSON.parse(_readScoped(FAV_KEY) || '[]') } catch { return [] } }
function saveFavs(favs) {
  _writeScoped(FAV_KEY, JSON.stringify(favs))
  // Persist to Supabase (fire-and-forget)
  if (window.electronAPI?.saveFavorites) {
    window.electronAPI.saveFavorites(favs).catch(() => {})
  }
}

// Merge remote favs with local on boot (called after auth)
// ── Maintenance mode check ──
async function checkMaintenanceMode() {
  try {
    if (!window.electronAPI?.getAppSettings) return
    const res = await window.electronAPI.getAppSettings()
    const m = res?.settings?.maintenance
    if (m && m.enabled) {
      const overlay = document.getElementById('maintenance-overlay')
      const msg = document.getElementById('maintenance-overlay-msg')
      if (msg) msg.textContent = m.message || 'Mise à jour en cours…'
      if (overlay) overlay.style.display = 'flex'
    }
  } catch { /* silent */ }
}

// ── Ping activity (update last_active on profile) ──
async function pingUserActivity() {
  try { if (window.electronAPI?.pingActivity) await window.electronAPI.pingActivity() } catch {}
}

// ── Feature flags (read-only côté app) ──
window.__featureFlags = {}
async function loadFeatureFlagsFromServer() {
  try {
    if (!window.electronAPI?.getFeatureFlags) return
    const res = await window.electronAPI.getFeatureFlags()
    window.__featureFlags = res?.flags || {}
  } catch {}
}
// Helper : isFeatureEnabled('scan_document') côté app
window.isFeatureEnabled = function(key) { return !!window.__featureFlags[key] }

// ── Error reporting ──
let _cachedAppVersion = '0.2.2'
if (window.electronAPI?.getAppVersion) {
  window.electronAPI.getAppVersion().then(v => { _cachedAppVersion = v }).catch(() => {})
}
let _lastReportedError = 0
window.addEventListener('error', (e) => {
  // Throttle : max 1 erreur reportée toutes les 10s
  const now = Date.now()
  if (now - _lastReportedError < 10000) return
  _lastReportedError = now
  try {
    if (!window.electronAPI?.logClientError) return
    window.electronAPI.logClientError({
      message: e.message || 'unknown error',
      stack: e.error?.stack || null,
      url: e.filename || location.href,
      userAgent: navigator.userAgent,
      appVersion: _cachedAppVersion,
    })
  } catch {}
})
window.addEventListener('unhandledrejection', (e) => {
  const now = Date.now()
  if (now - _lastReportedError < 10000) return
  _lastReportedError = now
  try {
    if (!window.electronAPI?.logClientError) return
    const reason = e.reason instanceof Error ? e.reason : new Error(String(e.reason))
    window.electronAPI.logClientError({
      message: reason.message || 'unhandled rejection',
      stack: reason.stack || null,
      url: location.href,
      userAgent: navigator.userAgent,
      appVersion: _cachedAppVersion,
    })
  } catch {}
})

// ── Announcement banner ──
async function loadAnnouncement() {
  try {
    if (!window.electronAPI?.getActiveAnnouncement) return
    const res = await window.electronAPI.getActiveAnnouncement()
    const ann = res?.announcement
    if (!ann) return
    // Check if user dismissed this specific announcement
    const dismissedId = localStorage.getItem('gesturo-dismissed-announcement')
    if (dismissedId === String(ann.id)) return
    // Show it
    const banner = document.getElementById('announcement-banner')
    if (!banner) return
    const kind = ann.kind || 'info'
    banner.className = 'announcement-backdrop kind-' + kind
    banner.dataset.id = ann.id
    // Icon per kind
    const ICONS = { info: '💙', warning: '⚠️', success: '✨' }
    const iconEl = document.getElementById('announcement-icon')
    if (iconEl) iconEl.textContent = ICONS[kind] || '💙'
    document.getElementById('announcement-message').textContent = ann.message
    const link = document.getElementById('announcement-link')
    if (ann.link_url) {
      link.href = ann.link_url
      link.textContent = ann.link_label || 'En savoir plus →'
      link.style.display = 'inline-block'
    } else {
      link.style.display = 'none'
    }
    banner.style.display = 'flex'
  } catch (e) { /* silent */ }
}

function dismissAnnouncement() {
  const banner = document.getElementById('announcement-banner')
  if (!banner) return
  const id = banner.dataset.id
  if (id) localStorage.setItem('gesturo-dismissed-announcement', String(id))
  banner.style.display = 'none'
}

async function syncFavsFromServer() {
  try {
    if (!window.electronAPI?.getFavorites) return
    const remote = await window.electronAPI.getFavorites()
    if (!Array.isArray(remote)) return
    // REPLACE (pas merge) : le serveur est la source de vérité. Permet de
    // retrouver ses favs sur une autre machine, et avec le scope par email
    // on écrit uniquement dans la clé du compte courant.
    _writeScoped(FAV_KEY, JSON.stringify(remote))
  } catch (e) { /* silent */ }
}

// Sync l'historique (sessions) depuis Supabase. Appelée au boot après auth.
// Merge local + serveur (dédupe par timestamp) pour ne rien perdre.
async function syncHistFromServer() {
  try {
    if (!window.electronAPI?.getSessions) return
    const remote = await window.electronAPI.getSessions()
    if (!Array.isArray(remote)) return
    const local = loadHist()
    const seen = new Set()
    const merged = []
    for (const s of [...remote, ...local]) {
      if (!seen.has(s.ts)) { seen.add(s.ts); merged.push(s) }
    }
    merged.sort((a, b) => a.ts - b.ts)
    _writeScoped(HIST_KEY, JSON.stringify(merged))
    if (typeof renderWeekBar === 'function') renderWeekBar()
  } catch (e) { /* silent */ }
}

// Sync les badges débloqués depuis Supabase.
async function syncBadgesFromServer() {
  try {
    if (!window.electronAPI?.getBadges) return
    const remote = await window.electronAPI.getBadges()
    if (!remote || typeof remote !== 'object') return
    // Merge : on garde le timestamp le plus ancien pour chaque badge
    // afin de ne jamais perdre un badge déjà débloqué localement.
    const local = loadBadges()
    const merged = { ...local }
    for (const [id, ts] of Object.entries(remote)) {
      if (!merged[id] || ts < merged[id]) merged[id] = ts
    }
    saveBadges(merged)
  } catch (e) { /* silent */ }
}

function currentPoseSrc() {
  const entry = sessionEntries[currentIndex]; if (!entry) return null
  const canvas = document.getElementById('pdf-canvas')
  if (entry.type === 'pdf' && canvas.style.display !== 'none') return canvas.toDataURL('image/jpeg', 0.9)
  return entry.isR2 ? entry.path : 'file://' + entry.path
}

function isFaved(src) { return loadFavs().some(f => f.src === src) }

function updatePoseStarBtn() {
  const src = currentPoseSrc(); const btn = document.getElementById('pose-fav-btn'); if (!src || !btn) return
  const faved = isFaved(src); btn.textContent = faved ? '★' : '☆'; btn.classList.toggle('active', faved)
}

function updateAnimStarBtn() {
  const frame = animFrames[animIndex]; const src = frame ? frame.dataUrl : null
  const btn = document.getElementById('anim-fav-btn'); if (!src || !btn) return
  const faved = isFaved(src); btn.textContent = faved ? '★' : '☆'; btn.classList.toggle('active', faved)
}

function addFav(src, label) {
  const favs = loadFavs()
  if (favs.some(f => f.src === src)) return
  if (!currentUserIsPro && favs.length >= 10) { showUpgradeModal(); return }
  favs.push({ src, label, addedAt: Date.now() }); saveFavs(favs)
}

function removeFav(src) { saveFavs(loadFavs().filter(f => f.src !== src)) }

function toggleFavPose() {
  const src = currentPoseSrc(); if (!src) return
  const btn = document.getElementById('pose-fav-btn')
  if (isFaved(src)) { removeFav(src); btn.textContent = '☆'; btn.classList.remove('active') }
  else { const entry = sessionEntries[currentIndex]; const label = entry ? (entry.path.split('/').pop() || 'Pose') : 'Pose'; addFav(src, label); btn.textContent = '★'; btn.classList.add('active') }
  btn.classList.add('bump'); setTimeout(() => btn.classList.remove('bump'), 300)
}

function toggleFavAnim() {
  const frame = animFrames[animIndex]; if (!frame) return
  const src = frame.dataUrl; const btn = document.getElementById('anim-fav-btn'); const label = 'Frame ' + (animIndex + 1)
  if (isFaved(src)) { removeFav(src); btn.textContent = '☆'; btn.classList.remove('active') }
  else { addFav(src, label); btn.textContent = '★'; btn.classList.add('active') }
  btn.classList.add('bump'); setTimeout(() => btn.classList.remove('bump'), 300)
}

function renderFavsConfig() {
  const favs = loadFavs(); const grid = document.getElementById('favs-grid-config'); const empty = document.getElementById('favs-empty-config')
  grid.innerHTML = ''
  if (favs.length === 0) { empty.style.display = 'block'; return }
  empty.style.display = 'none'
  // Refresh moodboard pin cache in background, update buttons when done
  refreshMoodboardPinCache().then(() => {
    grid.querySelectorAll('.fav-pin-btn').forEach(btn => {
      const src = btn.dataset.src
      btn.classList.toggle('pinned', isPinnedInMoodboard(src))
    })
  })
  favs.forEach((fav, i) => {
    const item = document.createElement('div'); item.className = 'fav-item'; item.style.cssText = 'position:relative;border-radius:8px;overflow:hidden;background:#242424;aspect-ratio:3/4;cursor:zoom-in;'
    const img = document.createElement('img'); img.src = fav.src; img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;'; item.appendChild(img)
    const lbl = document.createElement('div'); lbl.style.cssText = 'position:absolute;bottom:6px;left:6px;background:rgba(0,0,0,0.7);border-radius:4px;padding:2px 6px;font-size:11px;color:#e8a088;'; lbl.textContent = '★ ' + (i + 1); item.appendChild(lbl)
    // Pin moodboard button
    const pinBtn = document.createElement('button')
    pinBtn.className = 'fav-pin-btn' + (isPinnedInMoodboard(fav.src) ? ' pinned' : '')
    pinBtn.dataset.src = fav.src
    pinBtn.textContent = '📌'
    pinBtn.title = 'Épingler dans un moodboard'
    pinBtn.onclick = (e) => { e.stopPropagation(); openPinMoodboardModal(fav.src, fav.label || '', pinBtn) }
    item.appendChild(pinBtn)
    const removeBtn = document.createElement('button'); removeBtn.textContent = '✕'; removeBtn.className = 'fav-remove-btn'; removeBtn.title = 'Retirer des favoris'
    removeBtn.onclick = (e) => { e.stopPropagation(); removeFav(fav.src); renderFavsConfig() }
    item.appendChild(removeBtn)
    item.onclick = () => openLightboxFav(fav.src, i)
    grid.appendChild(item)
  })
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;'
}

// ── Pin to moodboard ──
let _moodboardPinCache = new Set()
function isPinnedInMoodboard(src) { return _moodboardPinCache.has(src) }

async function refreshMoodboardPinCache() {
  _moodboardPinCache = new Set()
  if (!window.electronAPI?.mbListProjects) return
  try {
    const projects = await window.electronAPI.mbListProjects()
    for (const p of projects) {
      const data = await window.electronAPI.mbLoadProject(p.file)
      if (data?.photos) {
        data.photos.forEach(ph => { if (ph.src) _moodboardPinCache.add(ph.src) })
      }
    }
  } catch (e) { /* silent */ }
}

function showPinToast(message, kind) {
  let toast = document.getElementById('pin-toast')
  if (!toast) {
    toast = document.createElement('div')
    toast.id = 'pin-toast'
    toast.className = 'pin-toast'
    document.body.appendChild(toast)
  }
  toast.textContent = message
  toast.className = 'pin-toast show' + (kind ? ' ' + kind : '')
  clearTimeout(toast._hideTimer)
  toast._hideTimer = setTimeout(() => { toast.className = 'pin-toast' }, 2800)
}

async function openPinMoodboardModal(src, label, triggerBtn) {
  if (!window.electronAPI?.mbListProjects) { showPinToast('Moodboard indisponible', 'err'); return }
  let modal = document.getElementById('pin-moodboard-modal')
  if (!modal) {
    modal = document.createElement('div')
    modal.id = 'pin-moodboard-modal'
    modal.className = 'pin-modal-overlay'
    modal.innerHTML = '<div class="pin-modal">'
      + '<h3>Epingler dans un moodboard</h3>'
      + '<div id="pin-modal-list" class="pin-modal-list">Chargement...</div>'
      + '<div id="pin-modal-new-form" class="pin-modal-new-form" style="display:none;">'
      + '  <input id="pin-modal-new-input" type="text" placeholder="Nom du nouveau tableau" maxlength="60">'
      + '  <div class="pin-modal-new-actions">'
      + '    <button id="pin-modal-new-cancel" class="pin-modal-close">Annuler</button>'
      + '    <button id="pin-modal-new-ok" class="pin-modal-new-confirm">Créer</button>'
      + '  </div>'
      + '</div>'
      + '<button class="pin-modal-close" id="pin-modal-close">Fermer</button>'
      + '</div>'
    document.body.appendChild(modal)
    modal.addEventListener('click', (e) => { if (e.target === modal) closePinMoodboardModal() })
    document.getElementById('pin-modal-close').addEventListener('click', closePinMoodboardModal)
  }
  modal.style.display = 'flex'
  document.getElementById('pin-modal-new-form').style.display = 'none'
  const list = document.getElementById('pin-modal-list')
  list.style.display = ''
  list.innerHTML = 'Chargement...'
  try {
    const projects = await window.electronAPI.mbListProjects()
    list.innerHTML = ''
    if (projects.length === 0) {
      const hint = document.createElement('div')
      hint.className = 'pin-modal-hint'
      hint.textContent = 'Aucun moodboard existant.'
      list.appendChild(hint)
    }
    projects.forEach(p => {
      const row = document.createElement('button')
      row.className = 'pin-modal-item'
      row.innerHTML = '<span class="pin-modal-dot"></span><span class="pin-modal-name"></span><span class="pin-modal-count">' + (p.photoCount || 0) + ' photo' + ((p.photoCount || 0) > 1 ? 's' : '') + '</span>'
      row.querySelector('.pin-modal-dot').style.background = p.color || '#888'
      row.querySelector('.pin-modal-name').textContent = p.name
      row.onclick = async () => {
        const added = await pinImageToMoodboard(p.file, src, label)
        if (added) moodboardNeedsRefresh = true
        closePinMoodboardModal()
        await refreshMoodboardPinCache()
        if (triggerBtn) triggerBtn.classList.add('pinned')
        showPinToast(added ? '✓ Ajoutée à "' + p.name + '"' : 'Déjà dans "' + p.name + '"', added ? 'ok' : 'info')
      }
      list.appendChild(row)
    })
    const newRow = document.createElement('button')
    newRow.className = 'pin-modal-item pin-modal-new'
    newRow.innerHTML = '<span class="pin-modal-plus">+</span><span class="pin-modal-name">Nouveau tableau</span>'
    newRow.onclick = () => {
      list.style.display = 'none'
      const form = document.getElementById('pin-modal-new-form')
      form.style.display = ''
      const input = document.getElementById('pin-modal-new-input')
      input.value = ''
      setTimeout(() => input.focus(), 10)
    }
    list.appendChild(newRow)

    // Wire up the new-form buttons (idempotent — re-bind on each open)
    const okBtn = document.getElementById('pin-modal-new-ok')
    const cancelBtn = document.getElementById('pin-modal-new-cancel')
    const input = document.getElementById('pin-modal-new-input')
    const createHandler = async () => {
      const name = input.value.trim()
      if (!name) { input.focus(); return }
      try {
        const proj = await window.electronAPI.mbCreateProject(name)
        if (!proj || !proj.file) throw new Error('Création échouée')
        const added = await pinImageToMoodboard(proj.file, src, label)
        moodboardNeedsRefresh = true
        closePinMoodboardModal()
        await refreshMoodboardPinCache()
        if (triggerBtn) triggerBtn.classList.add('pinned')
        showPinToast(added ? '✓ Tableau "' + (proj.name || name) + '" créé + image ajoutée' : '✓ Tableau créé', 'ok')
      } catch (e) {
        showPinToast('Erreur : ' + e.message, 'err')
      }
    }
    okBtn.onclick = createHandler
    cancelBtn.onclick = () => {
      document.getElementById('pin-modal-new-form').style.display = 'none'
      list.style.display = ''
    }
    input.onkeydown = (e) => { if (e.key === 'Enter') createHandler() }
  } catch (e) {
    list.innerHTML = '<div class="pin-modal-hint">Erreur : ' + e.message + '</div>'
  }
}

function closePinMoodboardModal() {
  const modal = document.getElementById('pin-moodboard-modal')
  if (modal) modal.style.display = 'none'
}

async function pinImageToMoodboard(projectFile, src, label) {
  try {
    const data = await window.electronAPI.mbLoadProject(projectFile)
    if (!data) return false
    const photos = data.photos || []
    if (photos.some(ph => ph.src === src)) return false
    const maxId = photos.reduce((m, ph) => Math.max(m, ph.id || 0), 0)
    const newPhoto = {
      id: maxId + 1,
      src,
      name: label || 'Gesturo favori',
      x: 200 + Math.random() * 300,
      y: 200 + Math.random() * 300,
      w: 240, h: 320,
      rotation: (Math.random() - 0.5) * 8,
      zIndex: maxId + 1,
      flipped: false,
    }
    photos.push(newPhoto)
    await window.electronAPI.mbSaveProject(projectFile, {
      ...data,
      photos,
      updatedAt: Date.now(),
    })
    return true
  } catch (e) { ; return false }
}

let lbFavSrc = null
function openLightboxFav(src, index) {
  lbFavSrc = src; const lb = document.getElementById('lightbox')
  lb.querySelector('img').src = src
  document.getElementById('lightbox-info').textContent = 'Favori ' + (index + 1)
  document.getElementById('lb-fav-remove').style.display = 'block'
  lb.classList.add('open'); document.addEventListener('keydown', onLbKey)
}
function removeFavFromLightbox() { if (!lbFavSrc) return; removeFav(lbFavSrc); lbFavSrc = null; closeLightbox(); renderFavsConfig() }

function _initFavoritesListeners() {
  document.getElementById('announcement-banner').addEventListener('click', function(e) { if (e.target === this) dismissAnnouncement() })
  document.getElementById('announcement-close').addEventListener('click', dismissAnnouncement)
  document.getElementById('pose-fav-btn').addEventListener('click', toggleFavPose)
  document.getElementById('anim-fav-btn').addEventListener('click', toggleFavAnim)
  document.getElementById('lightbox').addEventListener('click', closeLightbox)
  document.getElementById('lb-fav-remove').addEventListener('click', function(e) { e.stopPropagation(); removeFavFromLightbox() })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initFavoritesListeners)
} else {
  _initFavoritesListeners()
}
