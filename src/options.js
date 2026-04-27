
function renderWeekBar() {
  if (!document.getElementById('week-streak')) return
  const all = loadHist(); const days = document.querySelectorAll('.week-day')
  // Tout en heure locale (cohérent avec utcDayKey/computeStreak).
  const now = new Date()
  const todayLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const todayKey = utcDayKey(todayLocal.getTime())
  const sessionDays = new Set(all.map(s => utcDayKey(s.ts)))
  days.forEach((el, i) => {
    const d = new Date(todayLocal); d.setDate(todayLocal.getDate() - i)
    const key = utcDayKey(d.getTime())
    const isToday = key === todayKey; const done = sessionDays.has(key)
    el.className = 'week-day'
    if (done) el.classList.add('done')
    if (isToday) el.classList.add('today')
    el.title = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
  })
  const streak = computeStreak(all); const streakEl = document.getElementById('week-streak')
  streakEl.textContent = streak + ' j'; streakEl.className = streak === 0 ? 'zero' : ''
}

// ══ HISTORIQUE ══
const HIST_KEY = 'gd4_history'; let histPeriod = 'week'
let _histCache = null, _histCacheTick = 0
function loadHist() {
  // Cache le parse pendant le même tick JS (évite 4-5 JSON.parse consécutifs dans checkBadges)
  const now = performance.now()
  if (_histCache && now - _histCacheTick < 50) return _histCache
  try { _histCache = JSON.parse(_readScoped(HIST_KEY) || '[]') } catch { _histCache = [] }
  _histCacheTick = now
  return _histCache
}
function saveHist(h) { _writeScoped(HIST_KEY, JSON.stringify(h)); _histCache = h; _histCacheTick = performance.now() }

function logSession(data) {
  const hist = loadHist(); hist.push({ ...data, ts: Date.now() })
  if (hist.length > 500) hist.splice(0, hist.length - 500)
  saveHist(hist); renderWeekBar()
  if (window.electronAPI?.saveSession) {
    window.electronAPI.saveSession({ poses: data.poses, minutes: data.minutes, cats: data.cats || data.seq || null }).catch(() => {})
  }
  checkBadges()
}

function setHistPeriod(p) {
  histPeriod = p
  document.querySelectorAll('.hist-period-tab').forEach(t => t.classList.toggle('active', t.dataset.period === p))
  renderHistList()
}

function renderHist() {
  const all = loadHist(); const localStreak = computeStreak(all)
  // Show a placeholder while fetching server streak — avoids showing 0
  // on a fresh install where localStorage is empty
  const histStreakEl = document.getElementById('hist-streak')
  if (histStreakEl) histStreakEl.textContent = all.length === 0 ? '…' : localStreak
  if (window.electronAPI?.getStreak) {
    window.electronAPI.getStreak().then(r => {
      const serverStreak = r.streak || 0
      if (histStreakEl) histStreakEl.textContent = serverStreak
      const streakEl = document.getElementById('week-streak')
      if (streakEl) { streakEl.textContent = serverStreak + ' j'; streakEl.className = serverStreak === 0 ? 'zero' : '' }
    }).catch(() => {
      if (histStreakEl) histStreakEl.textContent = localStreak
    })
  } else {
    if (histStreakEl) histStreakEl.textContent = localStreak
  }
  document.getElementById('hist-total-sessions').textContent = all.length
  document.getElementById('hist-total-mins').textContent = all.reduce((a, s) => a + (s.minutes || 0), 0)
  const unlockedCount = Object.keys(loadBadges()).length
  document.getElementById('hist-badges-count').textContent = unlockedCount + ' / ' + BADGES_DEF.length
  renderBadges()
  renderWeekActivity(all)
  renderHistList()
}

function renderWeekActivity(all) {
  let container = document.getElementById('week-activity')
  if (!container) {
    container = document.createElement('div')
    container.id = 'week-activity'
    container.className = 'week-activity'
    const summary = document.getElementById('hist-summary')
    if (summary) summary.parentNode.insertBefore(container, summary.nextSibling)
  }
  const dayLabels = ['D', 'L', 'M', 'M', 'J', 'V', 'S']
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const counts = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i)
    const dayStart = d.getTime(); const dayEnd = dayStart + 86400000
    const count = all.filter(s => s.ts >= dayStart && s.ts < dayEnd).reduce((a, s) => a + (s.poses || 0), 0)
    counts.push({ label: dayLabels[d.getDay()], count })
  }
  const max = Math.max(...counts.map(c => c.count), 1)
  container.innerHTML = counts.map(c =>
    '<div class="wa-row">' +
      '<span class="wa-label">' + c.label + '</span>' +
      '<div class="wa-track"><div class="wa-bar" style="width:' + Math.round(c.count / max * 100) + '%"></div></div>' +
      '<span class="wa-count">' + c.count + '</span>' +
    '</div>'
  ).join('')
}

const HIST_PAGE_SIZE = 50
let _histRenderedCount = 0

function _buildHistRow(s) {
  const row = document.createElement('div'); row.className = 'hist-session-row'
  const dot = document.createElement('div'); dot.className = 'hist-session-dot' + (s.type === 'anim' ? ' anim' : '')
  const info = document.createElement('div'); info.className = 'hist-session-info'
  const typeLabel = s.type === 'anim' ? 'Animation' + (s.seq ? ' — ' + s.seq : '') : s.type === 'cinema' ? '🎬 Cinéma' + (s.film ? ' — ' + s.film : '') : 'Poses' + (s.subMode === 'progressive' ? ' (progressif)' : '')
  const catsLabel = s.cats ? '<span style="color:#666"> · ' + s.cats + '</span>' : ''
  info.innerHTML = typeLabel + catsLabel + '<div class="hist-session-meta">' + (s.poses || 0) + ' frames · ' + (s.minutes || 0) + ' min</div>'
  const time = document.createElement('div'); time.className = 'hist-session-time'; time.textContent = formatHistDate(s.ts)
  row.appendChild(dot); row.appendChild(info); row.appendChild(time)
  return row
}

function renderHistList() {
  const all = loadHist(); const now = Date.now()
  const cutoff = histPeriod === 'week' ? now - 7 * 86400000 : histPeriod === 'month' ? now - 30 * 86400000 : 0
  const filtered = all.filter(s => s.ts >= cutoff).reverse()
  const list = document.getElementById('hist-sessions-list'); const empty = document.getElementById('hist-empty')
  list.innerHTML = ''
  if (filtered.length === 0) { empty.style.display = 'block'; _histRenderedCount = 0; return }
  empty.style.display = 'none'
  // Rendu paginé : max 50 items d'un coup, bouton "Voir plus" pour le reste
  const page = filtered.slice(0, HIST_PAGE_SIZE)
  page.forEach(s => list.appendChild(_buildHistRow(s)))
  _histRenderedCount = page.length
  if (filtered.length > HIST_PAGE_SIZE) _appendHistMore(list, filtered)
}

function _appendHistMore(list, filtered) {
  const existing = list.querySelector('.hist-more-btn')
  if (existing) existing.remove()
  if (_histRenderedCount >= filtered.length) return
  const btn = document.createElement('button')
  btn.className = 'hist-more-btn'
  btn.style.cssText = 'display:block;width:100%;padding:12px;margin-top:8px;background:rgba(255,255,255,0.04);border:0.5px solid rgba(255,255,255,0.08);border-radius:8px;color:#4a6280;font-size:13px;cursor:pointer;'
  btn.textContent = 'Voir plus (' + (filtered.length - _histRenderedCount) + ' restantes)'
  btn.onclick = () => {
    btn.remove()
    const next = filtered.slice(_histRenderedCount, _histRenderedCount + HIST_PAGE_SIZE)
    next.forEach(s => list.appendChild(_buildHistRow(s)))
    _histRenderedCount += next.length
    if (_histRenderedCount < filtered.length) _appendHistMore(list, filtered)
  }
  list.appendChild(btn)
}

function formatHistDate(ts) {
  const d = new Date(ts); const today = new Date(); today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
  const dDay = new Date(d); dDay.setHours(0, 0, 0, 0)
  const hm = d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0')
  if (dDay.getTime() === today.getTime()) return "Aujourd'hui " + hm
  if (dDay.getTime() === yesterday.getTime()) return 'Hier ' + hm
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ' ' + hm
}

// Clé jour en HEURE LOCALE — la journée de l'user commence à minuit local.
// Le serveur doit être aligné sur cette logique (via offset client).
function utcDayKey(ts) {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return y + '-' + m + '-' + day
}

function computeStreak(hist) {
  if (hist.length === 0) return 0
  const days = new Set(hist.map(s => utcDayKey(s.ts)))
  let streak = 0
  const cur = new Date()
  for (let i = 0; i < 365; i++) {
    const key = utcDayKey(cur.getTime())
    if (days.has(key)) streak++
    else if (i > 0) break
    cur.setDate(cur.getDate() - 1)
  }
  return streak
}

// ══ GRILLE DE COMPOSITION ══
let gridMode = 0
const GRID_TITLES = ['Grille : off', 'Tiers', 'Diagonales', 'Tiers + Diagonales']
function cycleGrid() { gridMode = (gridMode + 1) % 4; applyGrid() }

function getVisibleImageRect() {
  const area = document.getElementById('photo-area'); if (!area) return null
  const areaRect = area.getBoundingClientRect()
  let el = document.getElementById('photo-img')
  if (!el || el.style.display === 'none') el = document.getElementById('pdf-canvas')
  if (!el || el.style.display === 'none') return null
  const r = el.getBoundingClientRect()
  return { left: r.left - areaRect.left, top: r.top - areaRect.top, width: r.width, height: r.height }
}

function positionGridOverlay() {
  const overlay = document.getElementById('grid-overlay'); if (!overlay) return
  const rect = getVisibleImageRect(); if (!rect) return
  overlay.style.left = rect.left + 'px'; overlay.style.top = rect.top + 'px'
  overlay.style.width = rect.width + 'px'; overlay.style.height = rect.height + 'px'
}

function applyGrid() {
  const overlay = document.getElementById('grid-overlay'); const thirds = document.getElementById('grid-thirds')
  const diags = document.getElementById('grid-diags'); const btn = document.getElementById('grid-btn')
  if (!overlay) return
  if (gridMode > 0) positionGridOverlay()
  overlay.classList.toggle('visible', gridMode > 0)
  if (thirds) thirds.style.display = (gridMode === 1 || gridMode === 3) ? '' : 'none'
  if (diags) diags.style.display = (gridMode === 2 || gridMode === 3) ? '' : 'none'
  if (btn) { btn.classList.toggle('grid-active', gridMode > 0); btn.title = GRID_TITLES[gridMode] }
}

function resetGrid() { gridMode = 0; applyGrid() }

// ══ OPTIONS ══
function closeOptionsSheet() {
  const dd = document.getElementById('options-dropdown')
  dd.classList.remove('open')
  const backdrop = document.getElementById('options-sheet-backdrop')
  if (backdrop) backdrop.classList.remove('visible')
  if (window.innerWidth < 1400) {
    setTimeout(() => { if (!dd.classList.contains('open')) dd.style.display = 'none' }, 300)
  }
}

// Swipe down to close options bottom sheet
;(function () {
  const dd = document.getElementById('options-dropdown')
  if (!dd) return
  let sheetStartY = 0, sheetTracking = false

  dd.addEventListener('touchstart', (e) => {
    if (window.innerWidth > 1399) return
    if (e.target.closest('input[type="range"], button, a, .opt-item')) return
    sheetStartY = e.touches[0].clientY
    sheetTracking = true
  }, { passive: true })

  dd.addEventListener('touchend', (e) => {
    if (!sheetTracking) return
    sheetTracking = false
    const dy = e.changedTouches[0].clientY - sheetStartY
    if (dy > 60) {
      hapticLight()
      closeOptionsSheet()
    }
  }, { passive: true })
})()
function toggleOptions() {
  const dd = document.getElementById('options-dropdown')
  const isMobile = window.innerWidth < 1400
  if (isMobile) {
    // Bottom sheet mode
    let backdrop = document.getElementById('options-sheet-backdrop')
    if (!backdrop) {
      backdrop = document.createElement('div')
      backdrop.id = 'options-sheet-backdrop'
      backdrop.addEventListener('click', () => toggleOptions())
      document.body.appendChild(backdrop)
    }
    const isOpen = dd.classList.contains('open')
    if (isOpen) {
      dd.classList.remove('open')
      backdrop.classList.remove('visible')
      // Attendre la transition avant de cacher
      setTimeout(() => { if (!dd.classList.contains('open')) dd.style.display = 'none' }, 300)
    } else {
      dd.style.display = 'block'
      // Force reflow pour que la transition joue
      dd.offsetHeight
      dd.classList.add('open')
      backdrop.classList.add('visible')
    }
    hapticLight()
  } else {
    dd.classList.toggle('open')
  }
}

// ── Musique d'ambiance (background music) ──
// Démarre au 1er clic user (les navigateurs bloquent l'autoplay avant
// interaction). Widget dans le dropdown Options : icône 🎵/🔇 cliquable
// pour on/off, slider 0-100 pour le volume. Tout persisté en localStorage.
const BGM_KEY = 'gd4_bgm_enabled'
const BGM_VOL_KEY = 'gd4_bgm_volume'  // 0-100 en string
function bgmEnabled() {
  return localStorage.getItem(BGM_KEY) !== '0'  // défaut ON
}
function bgmVolume() {
  const v = parseInt(localStorage.getItem(BGM_VOL_KEY) || '12', 10)
  return isNaN(v) ? 12 : Math.max(0, Math.min(100, v))
}
function applyBgmUi() {
  const icon = document.getElementById('opt-bgm-icon')
  const slider = document.getElementById('opt-bgm-slider')
  const value = document.getElementById('opt-bgm-value')
  const v = bgmVolume()
  if (icon) icon.textContent = bgmEnabled() ? '🎵' : '🔇'
  if (slider) slider.value = String(v)
  if (value) value.textContent = v + '%'
}
function tryPlayBgm() {
  const el = document.getElementById('bgm')
  if (!el || !bgmEnabled()) return
  if (typeof isAllMuted === 'function' && isAllMuted()) return
  el.volume = bgmVolume() / 100
  el.play().catch(() => { /* autoplay bloqué — attendra le 1er click */ })
}
function toggleBgm() {
  const enabled = bgmEnabled()
  localStorage.setItem(BGM_KEY, enabled ? '0' : '1')
  const el = document.getElementById('bgm')
  if (el) {
    if (enabled) { el.pause() }
    else { el.volume = bgmVolume() / 100; el.play().catch(() => {}) }
  }
  applyBgmUi()
}
function setBgmVolume(pct) {
  const v = Math.max(0, Math.min(100, parseInt(pct, 10) || 0))
  localStorage.setItem(BGM_VOL_KEY, String(v))
  const el = document.getElementById('bgm')
  if (el) el.volume = v / 100
  const value = document.getElementById('opt-bgm-value')
  if (value) value.textContent = v + '%'
  // Si l'user monte le volume alors que la musique était coupée, on réactive
  if (v > 0 && !bgmEnabled()) {
    localStorage.setItem(BGM_KEY, '1')
    if (el) el.play().catch(() => {})
    applyBgmUi()
  }
}
// Démarrage au 1er click (les navigateurs bloquent autoplay pur)
document.addEventListener('click', () => tryPlayBgm(), { once: true })
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', applyBgmUi)
} else {
  applyBgmUi()
}

// ── Toggle thème Jour/Nuit ──
// Le thème est aussi appliqué par un script inline en <head> AVANT le
// premier paint (anti-flash). Cette fonction sert au toggle runtime et à
// mettre à jour le label du menu.
const THEME_KEY = 'gd4_theme'
function applyTheme() {
  const light = localStorage.getItem(THEME_KEY) === 'light'
  document.body.classList.toggle('theme-light', light)
  document.documentElement.classList.remove('theme-light-preload')
  const item = document.getElementById('opt-theme')
  if (item) {
    const icon = item.querySelector('.opt-icon')
    const lbl = item.querySelector('.opt-label')
    if (icon) icon.textContent = light ? '🌙' : '☀️'
    if (lbl) lbl.textContent = light ? 'Mode Nuit' : 'Mode Jour'
  }
}
function toggleTheme() {
  const now = localStorage.getItem(THEME_KEY) === 'light' ? 'dark' : 'light'
  localStorage.setItem(THEME_KEY, now)
  applyTheme()
  toggleOptions()
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', applyTheme)
} else {
  applyTheme()
}

// ── Toggle UI legacy (ancien design) ──
const LEGACY_UI_KEY = 'gd4_legacy_ui'
function applyLegacyUi() {
  const legacy = localStorage.getItem(LEGACY_UI_KEY) === '1'
  document.body.classList.toggle('legacy-ui', legacy)
  const item = document.getElementById('opt-legacy-ui')
  if (item) {
    const icon = item.querySelector('.opt-icon')
    const lbl = item.querySelector('.opt-label')
    if (icon) icon.textContent = legacy ? '✨' : '👁'
    if (lbl) lbl.textContent = legacy ? 'Design amélioré' : 'Design ancien'
  }
}
function toggleLegacyUi() {
  const now = localStorage.getItem(LEGACY_UI_KEY) === '1' ? '0' : '1'
  localStorage.setItem(LEGACY_UI_KEY, now)
  applyLegacyUi()
  toggleOptions()
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', applyLegacyUi)
} else {
  applyLegacyUi()
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('#options-btn') && !e.target.closest('#options-dropdown')) closeOptionsSheet()
})
function confirmResetHistory() {
  closeOptionsSheet()
  showConfirmModal('Réinitialiser tout l\'historique ? Cette action est irréversible.', () => {
    saveHist([]); renderWeekBar()
    if (document.getElementById('hist-options').style.display !== 'none') renderHist()
  }, { confirmText: 'Réinitialiser', danger: true })
}
function handleLogout() {
  closeOptionsSheet()
  closeProfile()
  showConfirmModal('Se déconnecter ?', async () => {
    // Pas de clear du localStorage : les datas sont scopées par email
    // (_scopedKey) donc le compte suivant n'y a pas accès, et si l'user
    // courant revient plus tard il retrouve son historique/favoris/badges
    // locaux (philosophie local-first, la machine garde ses propres datas).
    await window.electronAPI.authLogout()
  }, { confirmText: 'Se déconnecter', danger: true })
}

// ══ PROFIL ══
function openProfile() {
  const modal = document.getElementById('profile-modal')
  modal.style.display = 'flex'
  // Fill data
  document.getElementById('profile-email').textContent = _communityEmail || '—'
  document.getElementById('profile-username').textContent = _communityUsername || '—'
  // Avatar: first letter of username
  const avatar = document.getElementById('profile-avatar')
  const initial = (_communityUsername || _communityEmail || '?')[0].toUpperCase()
  avatar.textContent = initial
  // Plan
  const badge = document.getElementById('plan-badge')
  document.getElementById('profile-plan').textContent = badge && badge.textContent.includes('Pro') ? 'Pro' : 'Free'
  // Stats
  const hist = loadHist()
  const totalPoses = hist.reduce((a, s) => a + (s.poses || 0), 0)
  document.getElementById('profile-poses').textContent = totalPoses
  const badges = Object.keys(loadBadges()).length
  document.getElementById('profile-badges').textContent = badges
  // Streak from DOM (already computed)
  const streakEl = document.getElementById('week-streak')
  document.getElementById('profile-streak').textContent = streakEl ? streakEl.textContent : '0'
}

function closeProfile() {
  document.getElementById('profile-modal').style.display = 'none'
}

async function saveProfileUsername() {
  const input = document.getElementById('profile-username')
  const msg = document.getElementById('profile-username-msg')
  const btn = document.getElementById('profile-save-username')
  const newName = input.value.trim()
  if (!newName) { msg.textContent = 'Le pseudo ne peut pas etre vide'; msg.style.color = '#e24b4a'; return }
  if (newName === _communityUsername) { msg.textContent = 'C\'est deja ton pseudo actuel'; msg.style.color = '#4a6280'; return }
  msg.textContent = 'Enregistrement...'; msg.style.color = '#4a6280'
  btn.disabled = true
  try {
    const res = await window.electronAPI.updateUsername(newName)
    if (res.ok) {
      _communityUsername = res.username || newName
      document.getElementById('profile-avatar').textContent = _communityUsername[0].toUpperCase()
      msg.textContent = 'Pseudo mis a jour !'; msg.style.color = '#2ecc71'
    } else {
      msg.textContent = res.error || 'Erreur'; msg.style.color = '#e24b4a'
    }
  } catch (e) { msg.textContent = e.message; msg.style.color = '#e24b4a' }
  btn.disabled = false
}

// Close profile on click outside
document.addEventListener('click', (e) => {
  const modal = document.getElementById('profile-modal')
  if (modal.style.display === 'flex' && e.target === modal) closeProfile()
})

// ══ MODALES GÉNÉRIQUES (remplacent confirm/alert natifs) ══
function showConfirmModal(message, onConfirm, opts) {
  const confirmText = (opts && opts.confirmText) || 'Confirmer'
  const cancelText = (opts && opts.cancelText) || 'Annuler'
  const danger = opts && opts.danger
  let overlay = document.getElementById('generic-modal-overlay')
  if (overlay) overlay.remove()
  overlay = document.createElement('div')
  overlay.id = 'generic-modal-overlay'
  overlay.style.cssText = 'display:flex;position:fixed;inset:0;background:rgba(5,12,22,0.88);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);align-items:center;justify-content:center;z-index:9000;padding:24px;'
  overlay.innerHTML = '<div style="background:#131f2e;border:0.5px solid #1e2d40;border-radius:16px;padding:28px;max-width:340px;width:100%;text-align:center;">' +
    '<p style="font-size:15px;color:#fff;margin:0 0 22px;line-height:1.5;">' + message + '</p>' +
    '<div style="display:flex;gap:10px;justify-content:center;">' +
    '<button id="gm-cancel" style="flex:1;min-height:48px;padding:14px;font-size:14px;border-radius:10px;background:rgba(255,255,255,0.06);border:0.5px solid rgba(255,255,255,0.1);color:rgba(255,255,255,0.85);cursor:pointer;">' + cancelText + '</button>' +
    '<button id="gm-confirm" style="flex:1;min-height:48px;padding:14px;font-size:14px;border-radius:10px;background:' + (danger ? '#E24B4A' : '#2983eb') + ';border:none;color:#fff;font-weight:600;cursor:pointer;">' + confirmText + '</button>' +
    '</div></div>'
  overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove() } })
  document.body.appendChild(overlay)
  document.getElementById('gm-cancel').onclick = () => overlay.remove()
  document.getElementById('gm-confirm').onclick = () => { overlay.remove(); onConfirm() }
}

function showAlertModal(message, opts) {
  const btnText = (opts && opts.btnText) || 'OK'
  let overlay = document.getElementById('generic-modal-overlay')
  if (overlay) overlay.remove()
  overlay = document.createElement('div')
  overlay.id = 'generic-modal-overlay'
  overlay.style.cssText = 'display:flex;position:fixed;inset:0;background:rgba(5,12,22,0.88);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);align-items:center;justify-content:center;z-index:9000;padding:24px;'
  overlay.innerHTML = '<div style="background:#131f2e;border:0.5px solid #1e2d40;border-radius:16px;padding:28px;max-width:340px;width:100%;text-align:center;">' +
    '<p style="font-size:15px;color:#fff;margin:0 0 22px;line-height:1.5;">' + message + '</p>' +
    '<button id="gm-ok" style="width:100%;min-height:48px;padding:14px;font-size:14px;border-radius:10px;background:#2983eb;border:none;color:#fff;font-weight:600;cursor:pointer;">' + btnText + '</button>' +
    '</div>'
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove() })
  document.body.appendChild(overlay)
  document.getElementById('gm-ok').onclick = () => overlay.remove()
}

// ══ ONBOARDING ══
const ONBOARDING_KEY = 'gd4_onboarding_done'
// DEV : mettre à false pour revenir au comportement normal
// (affichage uniquement à la première connexion).
const DEV_ALWAYS_SHOW_ONBOARDING = false
let _onboardingShown = false

function maybeShowOnboarding() {
  if (_onboardingShown) return
  if (!DEV_ALWAYS_SHOW_ONBOARDING && _readScoped(ONBOARDING_KEY) === '1') {
    // Onboarding déjà fait → proposer le choix de thème si pas encore fait
    maybeShowThemeChooser()
    return
  }
  _onboardingShown = true
  showOnboarding()
}

function showOnboarding() {
  if (document.getElementById('onboarding-overlay')) return
  const slides = [
    {
      logo: true,
      title: 'Bienvenue sur Gestur<span class="gesturo-o">o</span>',
      subtitle: 'Ton compagnon d\u2019entrainement au dessin de poses',
    },
    {
      icon: '\ud83c\udfa8',
      title: 'Dessine des poses',
      subtitle: 'Choisis tes categories, lance une session et progresse chaque jour',
    },
    {
      icon: '\ud83c\udfac',
      title: 'Etudie la composition',
      subtitle: 'Le mode Cinema te permet d\u2019analyser les cadrages et les plans des meilleurs films',
    },
    {
      icon: '\ud83c\udfde\ufe0f',
      title: 'Decompose le mouvement',
      subtitle: 'Le mode Animation t\u2019apprend a decomposer et comprendre le mouvement image par image',
    },
    {
      icon: '\ud83c\udf0d',
      title: 'Rejoins la communaute',
      subtitle: 'Partage tes dessins, participe aux challenges et decouvre les creations des autres',
    },
    {
      icon: '\ud83d\ude80',
      title: 'C\u2019est parti !',
      subtitle: 'Tu es pret a commencer ton premier entrainement',
      cta: 'Commencer',
    },
  ]
  let current = 0

  const overlay = document.createElement('div')
  overlay.id = 'onboarding-overlay'
  overlay.className = 'onboarding-overlay'
  overlay.innerHTML = `
    <div class="onboarding-card">
      <button class="onboarding-skip" id="onboarding-skip">Passer</button>
      <div class="onboarding-viewport">
        <div class="onboarding-track" id="onboarding-track">
          ${slides.map(s => `
            <div class="onboarding-slide">
              ${s.logo
                ? '<div class="onboarding-logo">Gestur<span class="gesturo-o">o</span><span class="onboarding-logo-dot">.</span></div>'
                : '<div class="onboarding-icon">' + s.icon + '</div>'}
              <h2 class="onboarding-title">${s.title}</h2>
              <p class="onboarding-subtitle">${s.subtitle}</p>
              ${s.cta ? '<button class="onboarding-start-btn" id="onboarding-start">' + s.cta + '</button>' : ''}
            </div>
          `).join('')}
        </div>
      </div>
      <div class="onboarding-nav">
        <button class="onboarding-arrow" id="onboarding-prev" aria-label="Precedent">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <div class="onboarding-dots" id="onboarding-dots">
          ${slides.map((_, i) => `<button class="onboarding-dot${i === 0 ? ' active' : ''}" data-idx="${i}" aria-label="Slide ${i+1}"></button>`).join('')}
        </div>
        <button class="onboarding-arrow" id="onboarding-next" aria-label="Suivant">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
        </button>
      </div>
    </div>
  `
  document.body.appendChild(overlay)

  const track = document.getElementById('onboarding-track')
  const prevBtn = document.getElementById('onboarding-prev')
  const nextBtn = document.getElementById('onboarding-next')
  const dots = overlay.querySelectorAll('.onboarding-dot')

  function goTo(idx) {
    current = Math.max(0, Math.min(slides.length - 1, idx))
    track.style.transform = 'translateX(-' + (current * 100) + '%)'
    dots.forEach((d, i) => d.classList.toggle('active', i === current))
    prevBtn.disabled = current === 0
    nextBtn.disabled = current === slides.length - 1
  }

  prevBtn.addEventListener('click', () => goTo(current - 1))
  nextBtn.addEventListener('click', () => goTo(current + 1))
  dots.forEach(d => d.addEventListener('click', () => goTo(parseInt(d.dataset.idx))))
  document.getElementById('onboarding-skip').addEventListener('click', closeOnboarding)
  const startBtn = document.getElementById('onboarding-start')
  if (startBtn) startBtn.addEventListener('click', closeOnboarding)

  // Keyboard nav
  const keyHandler = (e) => {
    if (e.key === 'ArrowRight') goTo(current + 1)
    else if (e.key === 'ArrowLeft') goTo(current - 1)
    else if (e.key === 'Escape') closeOnboarding()
  }
  document.addEventListener('keydown', keyHandler)
  overlay._keyHandler = keyHandler

  // Swipe (touch)
  let touchStartX = 0, touchStartY = 0
  track.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX
    touchStartY = e.touches[0].clientY
  }, { passive: true })
  track.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - touchStartX
    const dy = e.changedTouches[0].clientY - touchStartY
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) goTo(current + 1)
      else goTo(current - 1)
    }
  }, { passive: true })

  // Mouse drag (desktop)
  let mouseStartX = 0, dragging = false
  track.addEventListener('mousedown', (e) => { dragging = true; mouseStartX = e.clientX })
  const mouseUpHandler = (e) => {
    if (!dragging) return
    dragging = false
    const dx = e.clientX - mouseStartX
    if (Math.abs(dx) > 60) {
      if (dx < 0) goTo(current + 1)
      else goTo(current - 1)
    }
  }
  window.addEventListener('mouseup', mouseUpHandler)
  overlay._mouseUpHandler = mouseUpHandler

  goTo(0)
}

function closeOnboarding() {
  const overlay = document.getElementById('onboarding-overlay')
  if (!overlay) return
  if (overlay._keyHandler) document.removeEventListener('keydown', overlay._keyHandler)
  if (overlay._mouseUpHandler) window.removeEventListener('mouseup', overlay._mouseUpHandler)
  overlay.style.transition = 'opacity 0.25s ease'
  overlay.style.opacity = '0'
  setTimeout(() => { overlay.remove(); maybeShowThemeChooser() }, 250)
  _writeScoped(ONBOARDING_KEY, '1')
}

// ══ THEME CHOOSER (1ère session) ══
// Propose Jour/Nuit à l'user la 1ère fois. S'affiche après l'onboarding
// ou directement si l'onboarding est déjà fait. Gated par localStorage.
const THEME_CHOSEN_KEY = 'gd4_theme_chosen'
function maybeShowThemeChooser() {
  if (_readScoped(THEME_CHOSEN_KEY) === '1') return
  showThemeChooser()
}
function showThemeChooser() {
  if (document.getElementById('theme-chooser-overlay')) return
  const overlay = document.createElement('div')
  overlay.id = 'theme-chooser-overlay'
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(5,12,22,0.85);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);z-index:1100;display:flex;align-items:center;justify-content:center;padding:24px;animation:announce-fade 0.3s ease;'
  overlay.innerHTML =
    '<div style="background:#141e2a;border:0.5px solid #1e2d40;border-radius:20px;padding:40px 32px;max-width:420px;width:100%;text-align:center;box-shadow:0 24px 64px rgba(0,0,0,0.5);">' +
    '<div style="font-size:48px;margin-bottom:16px;">🎨</div>' +
    '<h2 style="color:#fff;font-size:22px;font-weight:700;margin:0 0 8px;">Choisis ton ambiance</h2>' +
    '<p style="color:#8899aa;font-size:14px;margin:0 0 28px;line-height:1.5;">Tu pourras toujours changer dans les options.</p>' +
    '<div style="display:flex;gap:14px;">' +
      '<button id="tc-dark" style="flex:1;padding:20px 16px;border-radius:14px;border:2px solid #1e2d40;background:#0f1923;cursor:pointer;transition:border-color 0.1s,transform 0.1s;">' +
        '<div style="font-size:32px;margin-bottom:10px;">🌙</div>' +
        '<div style="color:#fff;font-size:15px;font-weight:600;">Nuit</div>' +
        '<div style="color:#4a6280;font-size:12px;margin-top:4px;">Sombre et cozy</div>' +
      '</button>' +
      '<button id="tc-light" style="flex:1;padding:20px 16px;border-radius:14px;border:2px solid #e5e0d8;background:#faf8f5;cursor:pointer;transition:border-color 0.1s,transform 0.1s;">' +
        '<div style="font-size:32px;margin-bottom:10px;">☀️</div>' +
        '<div style="color:#0a1520;font-size:15px;font-weight:600;">Jour</div>' +
        '<div style="color:#5a6b7f;font-size:12px;margin-top:4px;">Clair et lumineux</div>' +
      '</button>' +
    '</div>' +
    '</div>'
  document.body.appendChild(overlay)

  function choose(theme) {
    localStorage.setItem(THEME_KEY, theme)
    _writeScoped(THEME_CHOSEN_KEY, '1')
    applyTheme()
    overlay.style.transition = 'opacity 0.25s ease'
    overlay.style.opacity = '0'
    setTimeout(() => overlay.remove(), 250)
  }

  document.getElementById('tc-dark').onclick = () => choose('dark')
  document.getElementById('tc-light').onclick = () => choose('light')
  // Hover feedback
  document.getElementById('tc-dark').onmouseover = function() { this.style.borderColor = '#2983eb'; this.style.transform = 'scale(1.03)' }
  document.getElementById('tc-dark').onmouseout = function() { this.style.borderColor = '#1e2d40'; this.style.transform = 'none' }
  document.getElementById('tc-light').onmouseover = function() { this.style.borderColor = '#2983eb'; this.style.transform = 'scale(1.03)' }
  document.getElementById('tc-light').onmouseout = function() { this.style.borderColor = '#e5e0d8'; this.style.transform = 'none' }
}

// ══ CHOOSE USERNAME (post-signup) ══
const USERNAME_SET_KEY = 'gd4_username_set'
let _usernameAskInFlight = false

async function maybeAskForUsername() {
  if (_usernameAskInFlight) return
  if (_readScoped(USERNAME_SET_KEY) === '1') return
  if (!window.electronAPI?.getProfile) return
  _usernameAskInFlight = true
  try {
    const profile = await window.electronAPI.getProfile()
    if (!profile || profile.error) return
    // Update local state from server truth
    if (profile.username) _communityUsername = profile.username
    const emailPrefix = (_communityEmail || '').split('@')[0]
    const currentUsername = (profile.username || '').trim()
    // Needs prompt if: no username OR username is just the email prefix (default/fallback)
    const needsPrompt = !currentUsername || currentUsername === emailPrefix
    if (!needsPrompt) {
      _writeScoped(USERNAME_SET_KEY, '1')
      return
    }
    showUsernameModal()
  } catch (e) {
    
  } finally {
    _usernameAskInFlight = false
  }
}

function showUsernameModal() {
  if (document.getElementById('username-modal-overlay')) return
  const overlay = document.createElement('div')
  overlay.id = 'username-modal-overlay'
  overlay.className = 'username-modal-overlay'
  const emailPrefix = (_communityEmail || '').split('@')[0]
  overlay.innerHTML = `
    <div class="username-modal-card">
      <div class="username-modal-emoji">\u{1F44B}</div>
      <h2 class="username-modal-title">Choisis ton pseudo</h2>
      <p class="username-modal-subtitle">C'est le nom que les autres verront dans la communaute. Tu pourras le changer plus tard.</p>
      <input id="username-modal-input" class="username-modal-input" type="text" maxlength="30" placeholder="Ton pseudo" value="${emailPrefix.replace(/"/g, '&quot;')}">
      <div id="username-modal-msg" class="username-modal-msg"></div>
      <button id="username-modal-confirm" class="username-modal-confirm">Confirmer</button>
      <button id="username-modal-skip" class="username-modal-skip" style="background:none;border:none;color:#4a6280;font-size:13px;cursor:pointer;margin-top:8px;padding:8px;">Passer pour l'instant</button>
    </div>
  `
  document.body.appendChild(overlay)
  const input = document.getElementById('username-modal-input')
  const msg = document.getElementById('username-modal-msg')
  const btn = document.getElementById('username-modal-confirm')
  setTimeout(() => { input.focus(); input.select() }, 80)

  const submit = async () => {
    const name = input.value.trim()
    if (!name) { msg.textContent = 'Le pseudo ne peut pas etre vide'; return }
    if (name.length < 2) { msg.textContent = 'Pseudo trop court (2 car. min)'; return }
    msg.textContent = 'Enregistrement...'; msg.style.color = '#4a6280'
    btn.disabled = true
    try {
      const res = await window.electronAPI.updateUsername(name)
      if (res && res.ok) {
        _communityUsername = res.username || name
        _writeScoped(USERNAME_SET_KEY, '1')
        closeUsernameModal()
      } else {
        msg.textContent = (res && res.error) || 'Erreur'
        msg.style.color = '#e24b4a'
        btn.disabled = false
      }
    } catch (e) {
      msg.textContent = e.message || 'Erreur reseau'
      msg.style.color = '#e24b4a'
      btn.disabled = false
    }
  }

  btn.addEventListener('click', submit)
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit() })
  document.getElementById('username-modal-skip').addEventListener('click', closeUsernameModal)
}

function closeUsernameModal() {
  const overlay = document.getElementById('username-modal-overlay')
  if (!overlay) return
  overlay.style.transition = 'opacity 0.25s ease'
  overlay.style.opacity = '0'
  setTimeout(() => overlay.remove(), 250)
}

// ══ RACCOURCIS CLAVIER ══
document.addEventListener('keydown', (e) => {
  if (document.getElementById('screen-cinema').classList.contains('active')) {
    if (e.key === 'ArrowRight') { e.preventDefault(); cinemaNext(); return }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); cinemaPrev(); return }
    if (e.key === 'g' || e.key === 'G') { toggleCinemaGrid(); return }
    if (e.key === 'f' || e.key === 'F') { flipCinemaH(); return }
    if (e.key === 'b' || e.key === 'B') { toggleCinemaBW(); return }
    if (e.key === 's' || e.key === 'S') { toggleFavCinema(); return }
  }
  if (document.getElementById('screen-session').classList.contains('active')) {
    if (e.key === ' ') { e.preventDefault(); togglePause(); return }
    if (e.key === 'ArrowRight' && !e.shiftKey) { e.preventDefault(); advance(); return }
    if (e.key === 'ArrowLeft' && !e.shiftKey) { e.preventDefault(); prevPhoto(); return }
    if (e.key === 'ArrowLeft' && e.shiftKey) { rotateLeft(); return }
    if (e.key === 'ArrowRight' && e.shiftKey) { rotateRight(); return }
    if (e.key === 'g' || e.key === 'G') { cycleGrid(); return }
    if (e.key === 'b' || e.key === 'B') { toggleBW(); return }
    if (e.key === 'f' || e.key === 'F') { flipH(); return }
    if (e.key === 's' || e.key === 'S') { toggleFavPose(); return }
    if (e.key === 'Escape') { askEnd(); return }
  }
  if (document.getElementById('screen-anim').classList.contains('active')) {
    if (e.key === ' ') { e.preventDefault(); toggleAnimLoop(); return }
    if (animStudyMode) {
      if (e.key === 'ArrowRight') { e.preventDefault(); animNextFrame(); return }
      if (e.key === 'ArrowLeft') { e.preventDefault(); animPrevFrame(); return }
    }
    if (e.key === 'ArrowLeft' && e.shiftKey) { rotateLeft(); return }
    if (e.key === 'ArrowRight' && e.shiftKey) { rotateRight(); return }
    if (e.key === 'g' || e.key === 'G') { cycleGrid(); return }
    if (e.key === 'b' || e.key === 'B') { toggleBW(); return }
    if (e.key === 'f' || e.key === 'F') { flipH(); return }
    if (e.key === 's' || e.key === 'S') { toggleFavAnim(); return }
    if (e.key === 'Escape') { openEndConfirm('anim'); return }
  }
})

function showAbout() {
  closeOptionsSheet()
  const modal = document.getElementById('about-modal')
  // Afficher IMMÉDIATEMENT — les données se remplissent en arrière-plan.
  // Avant : 2× await réseau AVANT open → 2s de latence perçue.
  modal.classList.add('open')
  // Version (IPC local, rapide)
  if (window.electronAPI?.getAppVersion) {
    window.electronAPI.getAppVersion().then(v => {
      document.getElementById('about-version').textContent = 'v' + v
    }).catch(() => {})
  }
  // Plan Pro (appel réseau Supabase — peut être lent)
  const planEl = document.getElementById('about-plan')
  const expiryRow = document.getElementById('about-expiry-row')
  const expiryEl = document.getElementById('about-expiry')
  const upgradeBtn = document.getElementById('about-upgrade-btn')
  // Valeur optimiste à partir de l'état connu localement (pas d'await)
  if (currentUserIsPro) {
    planEl.textContent = '⭐ Pro'; planEl.className = 'value pro'; upgradeBtn.style.display = 'none'
  } else {
    planEl.textContent = 'Free'; planEl.className = 'value free'; expiryRow.style.display = 'none'; upgradeBtn.style.display = 'block'
  }
  // Refresh en arrière-plan pour mettre à jour si besoin
  if (window.electronAPI?.refreshProStatus) {
    window.electronAPI.refreshProStatus().then(proData => {
      const isPro = proData?.isPro || currentUserIsPro
      const expiresAt = proData?.expiresAt
      if (isPro) {
        planEl.textContent = '⭐ Pro'; planEl.className = 'value pro'; upgradeBtn.style.display = 'none'
        if (expiresAt) {
          const d = new Date(expiresAt); expiryRow.style.display = 'flex'
          expiryEl.textContent = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
          const daysLeft = Math.ceil((d - Date.now()) / 86400000)
          if (daysLeft <= 7) { expiryEl.style.color = daysLeft <= 3 ? '#E24B4A' : '#f0c040'; expiryEl.textContent += ' (' + daysLeft + ' j)' }
        }
      } else {
        planEl.textContent = 'Free'; planEl.className = 'value free'; expiryRow.style.display = 'none'; upgradeBtn.style.display = 'block'
      }
    }).catch(() => {})
  }
}
function closeAbout() { document.getElementById('about-modal').classList.remove('open') }

// ══ BADGES ══
const BADGES_KEY = 'gd4_badges'
const BADGES_DEF = [
  { id: 'first_session',  emoji: '🎨', name: 'Premier pas',      desc: '1ère session complétée' },
  { id: 'streak_7',       emoji: '🔥', name: 'Semaine de feu',    desc: '7 jours consécutifs' },
  { id: 'streak_30',      emoji: '💎', name: 'Mois de feu',       desc: '30 jours consécutifs' },
  { id: 'poses_100',      emoji: '💪', name: 'Centurion',         desc: '100 poses dessinées' },
  { id: 'poses_500',      emoji: '⚡', name: '500 poses',         desc: '500 poses dessinées' },
  { id: 'poses_1000',     emoji: '🏆', name: 'Millénaire',        desc: '1000 poses dessinées' },
  { id: 'speed_master',   emoji: '⏱', name: 'Maître du 30s',     desc: '20 sessions en mode 30 sec' },
  { id: 'cinephile',      emoji: '🎬', name: 'Cinéphile',         desc: '5 sessions cinéma' },
  { id: 'collector',      emoji: '⭐', name: 'Collectionneur',    desc: '10 favoris enregistrés' },
  { id: 'early_bird', emoji: '🌅', name: 'Lève-tôt', desc: 'Faire une session avant 8h' },
  { id: 'explorer',       emoji: '🗺', name: 'Explorateur',       desc: 'Essayer Poses, Anim et Cinéma' },
  { id: 'poses_5000', emoji: '🔱', name: 'Légende', desc: '5000 poses dessinées' },
  // ── Badges communauté ──
  { id: 'first_share',    emoji: '📸', name: 'Premier partage',    desc: 'Partager un dessin dans la communauté' },
  { id: 'shares_10',      emoji: '🖼', name: 'Artiste prolifique', desc: '10 dessins partagés' },
  { id: 'first_reaction', emoji: '💬', name: 'Première réaction',  desc: 'Réagir à un dessin de la communauté' },
  { id: 'reactions_50',   emoji: '🤝', name: 'Supporteur',         desc: '50 réactions données' },
  { id: 'challenge_1',    emoji: '🏅', name: 'Challenger',         desc: 'Participer à un challenge' },
  { id: 'challenge_10',   emoji: '🏆', name: 'Champion',           desc: '10 challenges complétés' },
]
function loadBadges() { try { return JSON.parse(_readScoped(BADGES_KEY) || '{}') } catch { return {} } }
function saveBadges(b) { _writeScoped(BADGES_KEY, JSON.stringify(b)) }
function unlockBadge(id) {
  const badges = loadBadges()
  if (badges[id]) return
  hapticSuccess()
  const ts = Date.now()
  badges[id] = ts; saveBadges(badges)
  // Persist côté serveur (fire-and-forget) pour retrouver le badge sur
  // une autre machine via syncBadgesFromServer au prochain boot.
  if (window.electronAPI?.saveBadge) window.electronAPI.saveBadge(id, ts).catch(() => {})
  const def = BADGES_DEF.find(b => b.id === id)
  if (def) showBadgePopup(def)
  renderBadges()
}
const BADGE_SOUND_B64 = 'assets/badge-sound.wav'

let badgeQueue = []
let badgeShowing = false

function showBadgePopup(def) {
  badgeQueue.push(def)
  if (!badgeShowing) processNextBadge()
}

function processNextBadge() {
  if (badgeQueue.length === 0) { badgeShowing = false; return }
  badgeShowing = true
  const def = badgeQueue.shift()

  const existing = document.getElementById('badge-popup')
  if (existing) existing.remove()

  // Son Zelda
  try {
    const audio = new Audio(BADGE_SOUND_B64)
    audio.volume = 0.25
    audio.play().catch(() => {})
  } catch(e) {}

  const DURATION = 4000
  const popup = document.createElement('div')
  popup.id = 'badge-popup'
  popup.innerHTML = `
    <div class="bp-emoji">${def.emoji}</div>
    <div class="bp-text">
      <div class="bp-title">🏆 Badge débloqué</div>
      <div class="bp-name">${def.name}</div>
      <div class="bp-progress"><div class="bp-progress-bar" id="bp-bar"></div></div>
    </div>
  `
  document.body.appendChild(popup)

  // Barre de progression
  requestAnimationFrame(() => {
    const bar = document.getElementById('bp-bar')
    if (bar) {
      bar.style.transition = `width ${DURATION}ms linear`
      requestAnimationFrame(() => { bar.style.width = '0%' })
    }
  })

  const dismiss = () => {
    clearTimeout(timer)
    const p = document.getElementById('badge-popup')
    if (p) { p.classList.add('badge-hide'); setTimeout(() => { p.remove(); processNextBadge() }, 300) }
  }

  const timer = setTimeout(dismiss, DURATION)
  popup.onclick = dismiss
}

// Cache des stats communauté (évite de re-fetch à chaque checkBadges)
let _communityStats = null
async function fetchCommunityStats(force = false) {
  if (_communityStats && !force) return _communityStats
  try {
    if (!window.electronAPI?.getMyStats) return null
    const stats = await window.electronAPI.getMyStats()
    _communityStats = stats || { postsCount: 0, reactionsGivenCount: 0, challengesCount: 0 }
    return _communityStats
  } catch { return null }
}

async function checkBadges() {
  const hist = loadHist()
  if (hist.length >= 1) unlockBadge('first_session')
  const streak = computeStreak(hist)
  if (streak >= 7) unlockBadge('streak_7')
  if (streak >= 30) unlockBadge('streak_30')
  const totalPoses = hist.reduce((a, s) => a + (s.poses || 0), 0)
  if (totalPoses >= 100) unlockBadge('poses_100')
  if (totalPoses >= 500) unlockBadge('poses_500')
  if (totalPoses >= 1000) unlockBadge('poses_1000')
  const speed30 = hist.filter(s => s.type === 'pose' && s.subMode !== 'progressive' && (s.duration === 30 || s.timer === 30)).length
  if (speed30 >= 20) unlockBadge('speed_master')
  const cinemaSessions = hist.filter(s => s.type === 'cinema').length
  if (cinemaSessions >= 5) unlockBadge('cinephile')
  if (loadFavs().length >= 10) unlockBadge('collector')
  const hasAnim = hist.some(s => s.type === 'anim')
  const hasPose = hist.some(s => s.type === 'pose')
  const hasCinema = hist.some(s => s.type === 'cinema')
  if (hasAnim && hasPose && hasCinema) unlockBadge('explorer')
  const earlySession = hist.some(s => new Date(s.ts).getHours() < 8)
  if (earlySession) unlockBadge('early_bird')
  if (totalPoses >= 5000) unlockBadge('poses_5000')

  // ── Badges communauté (fetch distant) ──
  const stats = await fetchCommunityStats()
  if (!stats) return
  if (stats.postsCount >= 1) unlockBadge('first_share')
  if (stats.postsCount >= 10) unlockBadge('shares_10')
  if (stats.reactionsGivenCount >= 1) unlockBadge('first_reaction')
  if (stats.reactionsGivenCount >= 50) unlockBadge('reactions_50')
  if (stats.challengesCount >= 1) unlockBadge('challenge_1')
  if (stats.challengesCount >= 10) unlockBadge('challenge_10')
}
function renderBadges() {
  const grid = document.getElementById('badges-grid'); if (!grid) return
  const unlocked = loadBadges(); grid.innerHTML = ''
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;margin-top:8px;'
  BADGES_DEF.forEach(def => {
    const isUnlocked = !!unlocked[def.id]
    const card = document.createElement('div')
    card.className = 'badge-card' + (isUnlocked ? ' unlocked' : '')
    card.addEventListener('click', () => showBadgeDetail(def, unlocked[def.id]))
    const date = isUnlocked ? new Date(unlocked[def.id]).toLocaleDateString('fr-FR', { day:'numeric', month:'short' }) : def.desc
    const dateColor = isUnlocked ? '#f0c040' : '#4a6280'
    card.innerHTML = `<div style="font-size:28px;margin-bottom:6px;">${def.emoji}</div><div style="font-size:12px;font-weight:600;color:#fff;margin-bottom:3px;">${def.name}</div><div style="font-size:10px;color:${dateColor};line-height:1.4;">${isUnlocked ? '✓ ' + date : date}</div>`
    grid.appendChild(card)
  })
}

function showBadgeDetail(def, unlockedTs) {
  let overlay = document.getElementById('badge-detail-overlay')
  if (overlay) overlay.remove()
  overlay = document.createElement('div')
  overlay.id = 'badge-detail-overlay'
  const dateStr = unlockedTs
    ? new Date(unlockedTs).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
    : null
  overlay.innerHTML = `
    <div class="badge-detail-card">
      <div class="badge-detail-emoji">${def.emoji}</div>
      <div class="badge-detail-name">${def.name}</div>
      <div class="badge-detail-desc">${def.desc}</div>
      ${dateStr ? '<div class="badge-detail-date">Débloqué le ' + dateStr + '</div>' : '<div class="badge-detail-locked">Pas encore débloqué</div>'}
    </div>
  `
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove() })
  document.body.appendChild(overlay)
}
function toggleBadgesPanel() {
  const panel = document.getElementById('badges-panel')
  const isOpen = panel.style.display !== 'none'
  panel.style.display = isOpen ? 'none' : 'block'
  if (!isOpen) {
    renderBadges()
    const unlockedCount = Object.keys(loadBadges()).length
    document.getElementById('hist-badges-count').textContent = unlockedCount + ' / ' + BADGES_DEF.length
  }
}

// ─── MOBILE + TABLET — tap-to-toggle des controls flottants sur Session ─
// Sur mobile (≤767px) ET tablet (768-1199px), tap sur la photo pour
// (timer, dock, transform, fav). Comportement standard apps photo natives.
// Le clic est ignoré si on a tapé un vrai bouton (pour ne pas interférer).
;(function () {
  const photoArea = document.getElementById('photo-area')
  const sessionEl = document.getElementById('screen-session')
  if (!photoArea || !sessionEl) return
  let hintShown = false
  photoArea.addEventListener('click', (e) => {
    if (window.innerWidth > 1399) return
    if (e.target.closest('button')) return
    const willHide = !sessionEl.classList.contains('controls-hidden')
    sessionEl.classList.toggle('controls-hidden')
    // Hint « Tape pour révéler » : uniquement la 1re fois qu'on cache.
    if (willHide && !hintShown) {
      hintShown = true
      sessionEl.classList.add('show-hint')
      setTimeout(() => sessionEl.classList.remove('show-hint'), 2400)
    }
  })
  // Reset à chaque entrée en session : controls visibles, hint réarmé,
  // et nettoyage du display:none résiduel que askEnd() peut laisser sur
  // #controls si la session précédente a été quittée sans cancelEnd().
  const _origStartSession = window.startSession
  if (typeof _origStartSession === 'function') {
    window.startSession = function () {
      sessionEl.classList.remove('controls-hidden')
      sessionEl.classList.remove('show-hint')
      hintShown = false
      const ctrls = document.getElementById('controls')
      if (ctrls) ctrls.style.display = ''
      closeEndConfirm()
      return _origStartSession.apply(this, arguments)
    }
  }
})()

// ─── MOBILE + TABLET — tap-to-toggle des controls sur Animation ─────────
// Même logique que Session : tap sur la photo toggle .controls-hidden.
// Le timer d'étude reste visible via #anim-float-timer (synced dans
// updateStudyTimer). L'overlay play n'est pas affecté.
;(function () {
  const photoArea = document.getElementById('anim-photo-area')
  const animEl = document.getElementById('screen-anim')
  if (!photoArea || !animEl) return
  photoArea.addEventListener('click', (e) => {
    if (window.innerWidth > 1399) return
    if (e.target.closest('button') || e.target.closest('.anim-big-btn')) return
    // Ne pas toggle si l'overlay play est visible
    const overlay = document.getElementById('anim-overlay')
    if (overlay && !overlay.classList.contains('hidden')) return
    animEl.classList.toggle('controls-hidden')
  })
})()

// ─── MOBILE — Accordion sur les cards de l'écran Config ─────────────────
// Sur mobile, on transforme chaque .card de #screen-config en accordéon :
// le h3 devient un header cliquable, le reste du contenu est wrappé dans
// un .card-body qu'on collapse/expand. Première card de chaque mode reste
// ouverte par défaut. Desktop intouché car le CSS qui hide le body est
// uniquement dans @media (max-width: 767px).
;(function () {
  function setupConfigAccordion() {
    const screen = document.getElementById('screen-config')
    if (!screen) return
    const cards = screen.querySelectorAll('.card')
    cards.forEach((card) => {
      const h3 = card.querySelector(':scope > h3')
      if (!h3) return
      // Si déjà wrappé, ne pas refaire
      if (card.querySelector(':scope > .card-body')) return
      const body = document.createElement('div')
      body.className = 'card-body'
      // Déplacer tous les enfants après h3 dans body
      let n = h3.nextSibling
      while (n) {
        const next = n.nextSibling
        body.appendChild(n)
        n = next
      }
      card.appendChild(body)
      h3.addEventListener('click', () => {
        // Accordion-only sur mobile (≤767px). Sur tablet + desktop, le
        // clic est sans effet car le CSS n'a pas de .collapsed.
        if (window.innerWidth > 767) return
        card.classList.toggle('collapsed')
      })
    })
    // Première card de chaque conteneur reste ouverte, les autres collapsed
    // (uniquement à l'init et seulement en mobile).
    if (window.innerWidth <= 767) {
      ['pose-options', 'anim-options'].forEach((id) => {
        const wrap = document.getElementById(id)
        if (!wrap) return
        const cs = wrap.querySelectorAll('.card')
        cs.forEach((c, i) => { if (i > 0) c.classList.add('collapsed') })
      })
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupConfigAccordion)
  } else {
    setupConfigAccordion()
  }
})()

// ── Mobile back gesture: close topmost overlay ──
// Handles hardware back button (Capacitor) and also provides a
// helper for swipe-down-to-close on overlays.
;(function() {
  // Priority-ordered list: first open overlay wins.
  function closeTopOverlay() {
    const checks = [
      { el: () => document.getElementById('badge-detail-overlay'), close: () => document.getElementById('badge-detail-overlay')?.remove() },
      { el: () => document.getElementById('lightbox'), test: (e) => e.classList.contains('open'), close: closeLightbox },
      { el: () => document.getElementById('community-compare'), test: (e) => e.style.display !== 'none', close: closeCommunityCompare },
      { el: () => document.getElementById('community-upload-overlay'), test: (e) => e.style.display !== 'none', close: closeCommunityUpload },
      { el: () => document.getElementById('share-drawing-overlay'), test: (e) => e.style.display !== 'none', close: closeShareDrawing },
      { el: () => document.getElementById('end-confirm-modal'), test: (e) => e.classList.contains('open'), close: closeEndConfirm },
      { el: () => document.getElementById('about-modal'), test: (e) => e.classList.contains('open'), close: closeAbout },
      { el: () => document.getElementById('profile-modal'), test: (e) => e.style.display !== 'none', close: closeProfile },
    ]
    for (const c of checks) {
      const e = c.el()
      if (!e) continue
      if (c.test ? c.test(e) : true) { c.close(); return true }
    }
    return false
  }

  // Capacitor hardware back button
  if (typeof Capacitor !== 'undefined') {
    document.addEventListener('backbutton', (e) => {
      if (closeTopOverlay()) { e.preventDefault(); return }
      // If on a session screen, go back to config
      const active = document.querySelector('.screen.active')
      if (active && ['screen-session', 'screen-anim', 'screen-cinema', 'screen-end'].includes(active.id)) {
        e.preventDefault()
        showScreen('screen-config')
      }
    })
  }

  // Swipe-down to close overlays on touch devices
  const SWIPE_THRESHOLD = 80
  let touchStartY = 0, touchTarget = null

  const overlaySelectors = [
    '#community-compare', '#community-upload-overlay', '#share-drawing-overlay',
    '#lightbox', '#profile-modal', '#about-modal'
  ]

  document.addEventListener('touchstart', (e) => {
    const t = e.touches[0]
    for (const sel of overlaySelectors) {
      const el = document.querySelector(sel)
      if (el && (el.style.display !== 'none' && el.style.display !== '') || el?.classList.contains('open')) {
        if (el.contains(e.target) || el === e.target) {
          touchStartY = t.clientY
          touchTarget = sel
          return
        }
      }
    }
    touchTarget = null
  }, { passive: true })

  document.addEventListener('touchend', (e) => {
    if (!touchTarget) return
    const t = e.changedTouches[0]
    const dy = t.clientY - touchStartY
    if (dy > SWIPE_THRESHOLD) {
      closeTopOverlay()
    }
    touchTarget = null
  }, { passive: true })
})()

// ══ PULL-TO-REFRESH — Communauté ══
// Scroll vers le haut (tirer depuis scrollTop=0) pour recharger le feed.
// Marche sur mobile (touch) + desktop (wheel/trackpad). overscroll-behavior
// sur #screen-config désactive le PTR natif du navigateur pour laisser la
// main au custom.
;(function setupCommunityPullToRefresh() {
  const scrollEl = document.getElementById('screen-config')
  const feedEl = document.getElementById('community-options')
  if (!scrollEl || !feedEl) return

  const indicator = document.createElement('div')
  indicator.id = 'ptr-indicator'
  indicator.innerHTML = '<div class="ptr-spinner"></div>'
  feedEl.insertBefore(indicator, feedEl.firstChild)

  const THRESHOLD = 60
  const MAX = 110
  let startY = 0
  let pulling = false
  let pulled = 0
  let refreshing = false

  function communityActive() {
    // L'onglet Communauté est dans l'écran config → on vérifie que le
    // container est visible ET que l'écran config est actif.
    return feedEl.style.display !== 'none'
      && document.getElementById('screen-config').classList.contains('active')
  }

  function setVisual(px) {
    indicator.style.height = Math.min(px, MAX) + 'px'
    const ratio = Math.min(px / THRESHOLD, 1)
    indicator.style.opacity = String(ratio)
    indicator.classList.toggle('ptr-active', px > 4)
  }

  function resetVisual() {
    indicator.style.height = ''
    indicator.style.opacity = ''
    indicator.classList.remove('ptr-active')
  }

  async function doRefresh() {
    if (refreshing) return
    refreshing = true
    indicator.classList.add('ptr-refreshing')
    try {
      if (typeof renderCommunity === 'function') await renderCommunity()
    } catch (e) { /* silent */ }
    setTimeout(() => {
      indicator.classList.remove('ptr-refreshing')
      resetVisual()
      refreshing = false
    }, 400)
  }

  // ── Touch (mobile) ──
  scrollEl.addEventListener('touchstart', (e) => {
    if (!communityActive() || refreshing) return
    if (scrollEl.scrollTop > 0) return
    startY = e.touches[0].clientY
    pulling = true
  }, { passive: true })

  scrollEl.addEventListener('touchmove', (e) => {
    if (!pulling) return
    const delta = e.touches[0].clientY - startY
    if (delta < 0) { pulling = false; resetVisual(); return }
    pulled = delta * 0.55  // friction
    setVisual(pulled)
  }, { passive: true })

  scrollEl.addEventListener('touchend', () => {
    if (!pulling) return
    pulling = false
    if (pulled >= THRESHOLD) doRefresh()
    else resetVisual()
    pulled = 0
  }, { passive: true })

  // ── Wheel (desktop trackpad : scroll up au-delà de 0) ──
  let wheelPull = 0
  let wheelResetTimer = null
  scrollEl.addEventListener('wheel', (e) => {
    if (!communityActive() || refreshing) return
    if (scrollEl.scrollTop > 0) { wheelPull = 0; resetVisual(); return }
    // deltaY négatif = scroll vers le haut
    if (e.deltaY >= 0) { wheelPull = 0; resetVisual(); return }
    wheelPull += Math.abs(e.deltaY)
    setVisual(wheelPull * 0.6)
    clearTimeout(wheelResetTimer)
    wheelResetTimer = setTimeout(() => {
      if (wheelPull * 0.6 >= THRESHOLD) doRefresh()
      else resetVisual()
      wheelPull = 0
    }, 140)
  }, { passive: true })
})()

// ══ SOUND DESIGN — hover léger sur les boutons ══
// Web Audio API pour générer un "tick" doux (sine 900Hz, attack/decay 80ms,
// volume 4%). Pas de fichier embarqué. Désactivé sur mobile (pas de hover
// tactile natif). Track le dernier élément hovered pour ne pas répéter.
;(function setupHoverSound() {
  // Pas de hover pertinent sur les appareils tactiles purs
  if (typeof window.matchMedia === 'function' && !window.matchMedia('(hover: hover)').matches) return

  const INTERACTIVE_SEL = 'button, .mode-tab, .cat-chip, .chip, .sub-mode-card, .bottom-tab, .opt-item, .end-btn, .seq-card, .film-card, .community-tab, .hist-period-tab'
  let audioCtx = null
  let lastHoveredEl = null

  function getCtx() {
    if (!audioCtx) {
      try {
        const C = window.AudioContext || window.webkitAudioContext
        if (C) audioCtx = new C()
      } catch (e) { /* silent */ }
    }
    return audioCtx
  }

  // Mélodie UI ambient en MI MINEUR — accordée à la musique de fond
  // (AKR - Soft Hope : E minor, 101 BPM). Gamme pentatonique E minor
  // (E G A B D) : toutes les combinaisons sonnent bien, jamais de dissonance
  // avec la musique de fond. Séquence qui flotte autour de la tonique E.
  //
  // Son premium : sine pur + harmonique à l'octave (volume bas) pour la
  // richesse, attack 15ms + decay 400ms lent → effet "chime" smooth.
  // Low-pass très ouvert pour garder l'air.
  const MELODY_E_MINOR = [
    659.25,   // E5 (tonique)
    987.77,   // B5 (quinte)
    783.99,   // G5 (tierce mineure)
    1174.66,  // D6
    880.00,   // A5
    1318.51,  // E6 (octave tonique)
    987.77,   // B5
    783.99,   // G5
    1174.66,  // D6
    880.00,   // A5
    987.77,   // B5
    659.25,   // E5 (retour tonique)
    783.99,   // G5
    1318.51,  // E6
    880.00,   // A5
    987.77    // B5
  ]
  let melodyIdx = 0
  function playTick() {
    if (typeof isAllMuted === 'function' && isAllMuted()) return
    const ctx = getCtx()
    if (!ctx || ctx.state === 'suspended') return
    const freq = MELODY_E_MINOR[melodyIdx]
    melodyIdx = (melodyIdx + 1) % MELODY_E_MINOR.length
    const now = ctx.currentTime
    // Master gain : attack 15ms, decay 400ms lent → fade gracieux
    const master = ctx.createGain()
    master.gain.setValueAtTime(0.0001, now)
    master.gain.linearRampToValueAtTime(0.028, now + 0.015)
    master.gain.exponentialRampToValueAtTime(0.0001, now + 0.42)
    // Low-pass très ouvert pour garder l'éclat tout en adoucissant
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 4500
    filter.Q.value = 0.5
    master.connect(filter)
    filter.connect(ctx.destination)
    // Voix 1 : fondamentale (sine = timbre le plus doux)
    const osc1 = ctx.createOscillator()
    osc1.type = 'sine'
    osc1.frequency.value = freq
    osc1.connect(master)
    osc1.start(now)
    osc1.stop(now + 0.45)
    // Voix 2 : octave supérieure à -12dB pour la richesse "chime"
    const osc2 = ctx.createOscillator()
    const octaveGain = ctx.createGain()
    octaveGain.gain.value = 0.25  // 25% du gain principal = harmonique subtile
    osc2.type = 'sine'
    osc2.frequency.value = freq * 2
    osc2.connect(octaveGain)
    octaveGain.connect(master)
    osc2.start(now)
    osc2.stop(now + 0.45)
  }

  document.addEventListener('mouseover', (e) => {
    const target = e.target.closest(INTERACTIVE_SEL)
    if (!target) return
    if (target === lastHoveredEl) return
    if (target.disabled) return
    lastHoveredEl = target
    playTick()
  })

  document.addEventListener('mouseout', (e) => {
    const target = e.target.closest(INTERACTIVE_SEL)
    if (!target) return
    const related = e.relatedTarget
    // On reset si la souris sort VRAIMENT de l'elt interactif (et n'est pas
    // passée à un enfant ou à un autre elt du même groupe).
    if (related && related.closest && related.closest(INTERACTIVE_SEL) === target) return
    if (target === lastHoveredEl) lastHoveredEl = null
  })
})()

// ══ AMBIENT WATER SOUND — streaming via <audio> + filtre ASMR ══
// Avant : fetch + decodeAudioData d'un WAV de 47MB → freeze 1-2s au 1er
// clic. Maintenant : <audio loop> en streaming (jamais tout en mémoire)
// + createMediaElementSource pour brancher un filtre low-pass ASMR.
// Résultat : zéro freeze, zéro decode, lecture instantanée.
const WATER_VOL_KEY = 'gd4_water_volume'   // 0-100
const MUTE_ALL_KEY = 'gd4_mute_all'         // '1' = muted
function waterVolume() {
  const v = parseInt(localStorage.getItem(WATER_VOL_KEY) || '22', 10)
  return isNaN(v) ? 22 : Math.max(0, Math.min(100, v))
}
function isAllMuted() { return localStorage.getItem(MUTE_ALL_KEY) === '1' }
let _waterGainNode = null

;(function setupAmbientWater() {
  let connected = false

  function initWater() {
    const el = document.getElementById('water-sound')
    if (!el || connected) return
    connected = true

    el.volume = 1  // volume géré par le GainNode, pas par l'élément

    try {
      const C = window.AudioContext || window.webkitAudioContext
      if (!C) { el.volume = isAllMuted() ? 0 : waterVolume() / 100; return }
      const ctx = new C()
      const source = ctx.createMediaElementSource(el)
      const gain = ctx.createGain()
      gain.gain.value = isAllMuted() ? 0 : waterVolume() / 100
      _waterGainNode = gain

      const lowpass = ctx.createBiquadFilter()
      lowpass.type = 'lowpass'
      lowpass.frequency.value = 1200
      lowpass.Q.value = 0.6

      const lowshelf = ctx.createBiquadFilter()
      lowshelf.type = 'lowshelf'
      lowshelf.frequency.value = 200
      lowshelf.gain.value = 3

      source.connect(gain)
      gain.connect(lowpass)
      lowpass.connect(lowshelf)
      lowshelf.connect(ctx.destination)
    } catch (e) {
      el.volume = isAllMuted() ? 0 : waterVolume() / 100
    }

    if (!isAllMuted()) el.play().catch(() => {})
  }

  document.addEventListener('click', initWater, { once: true })
})()

// ══ CONTRÔLES AUDIO GLOBAUX ══
// Setter du volume du son d'eau (0-100). Persiste + applique en temps réel.
function setWaterVolume(pct) {
  const v = Math.max(0, Math.min(100, parseInt(pct, 10) || 0))
  localStorage.setItem(WATER_VOL_KEY, String(v))
  if (_waterGainNode && !isAllMuted()) {
    _waterGainNode.gain.value = v / 100
  } else if (!_waterGainNode) {
    const el = document.getElementById('water-sound')
    if (el) el.volume = isAllMuted() ? 0 : v / 100
  }
  const value = document.getElementById('opt-water-value')
  if (value) value.textContent = v + '%'
}

// Toggle mute global : coupe BGM + water + sons UI d'un coup.
// Pour le hover sound : on gate via isAllMuted() dans playTick.
function toggleMuteAll() {
  const muted = isAllMuted()
  const next = muted ? '0' : '1'
  localStorage.setItem(MUTE_ALL_KEY, next)
  // Musique
  const bgm = document.getElementById('bgm')
  if (bgm) {
    if (!muted) { bgm.pause() }
    else if (bgmEnabled()) { bgm.volume = bgmVolume() / 100; bgm.play().catch(() => {}) }
  }
  // Water sound
  const waterEl = document.getElementById('water-sound')
  if (_waterGainNode) {
    _waterGainNode.gain.value = muted ? waterVolume() / 100 : 0
  } else if (waterEl) {
    waterEl.volume = muted ? waterVolume() / 100 : 0
  }
  if (waterEl) {
    if (!muted) waterEl.pause()
    else waterEl.play().catch(() => {})
  }
  applyMuteUi()
}

function applyMuteUi() {
  const item = document.getElementById('opt-mute-all')
  if (!item) return
  const icon = item.querySelector('.opt-icon')
  const lbl = item.querySelector('.opt-label')
  const muted = isAllMuted()
  if (icon) icon.textContent = muted ? '🔊' : '🔇'
  if (lbl) lbl.textContent = muted ? 'Réactiver les sons' : 'Couper tous les sons'
}

function applyWaterUi() {
  const slider = document.getElementById('opt-water-slider')
  const value = document.getElementById('opt-water-value')
  const v = waterVolume()
  if (slider) slider.value = String(v)
  if (value) value.textContent = v + '%'
}

function _initOptionsListeners() {
  applyMuteUi(); applyWaterUi()

  document.getElementById('profile-btn').addEventListener('click', openProfile)
  document.getElementById('options-btn').addEventListener('click', toggleOptions)
  document.getElementById('opt-hist').addEventListener('click', () => { toggleOptions(); switchMainMode('hist') })
  document.getElementById('opt-bgm-icon').addEventListener('click', toggleBgm)
  document.getElementById('opt-bgm-slider').addEventListener('input', function() { setBgmVolume(this.value) })
  document.getElementById('opt-water-slider').addEventListener('input', function() { setWaterVolume(this.value) })
  document.getElementById('opt-mute-all').addEventListener('click', toggleMuteAll)
  document.getElementById('opt-theme').addEventListener('click', toggleTheme)
  document.getElementById('opt-legacy-ui').addEventListener('click', toggleLegacyUi)
  document.getElementById('opt-about').addEventListener('click', showAbout)
  document.getElementById('opt-logout').addEventListener('click', handleLogout)
  document.getElementById('opt-reset-history').addEventListener('click', confirmResetHistory)
  document.getElementById('grid-btn').addEventListener('click', cycleGrid)
  document.querySelectorAll('.hist-period-tab').forEach(function(t) {
    t.addEventListener('click', function() { setHistPeriod(this.dataset.period) })
  })
  document.getElementById('about-modal').addEventListener('click', function(e) { if (e.target === this) closeAbout() })
  document.getElementById('about-discord-link').addEventListener('click', function() { window.electronAPI.openExternal('https://discord.gg/f9pf3vmgg2') })
  document.getElementById('about-site-link').addEventListener('click', function() { window.electronAPI.openExternal('https://gesturo.art') })
  document.getElementById('about-music-link').addEventListener('click', function() { window.electronAPI.openExternal('https://www.instagram.com/akr.prod/') })
  document.getElementById('about-upgrade-btn').addEventListener('click', function() { window.electronAPI.openExternal('https://gesturo.art'); closeAbout() })
  document.getElementById('btn-close-about').addEventListener('click', closeAbout)
  document.getElementById('btn-close-profile').addEventListener('click', closeProfile)
  document.getElementById('btn-profile-logout').addEventListener('click', handleLogout)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initOptionsListeners)
} else {
  _initOptionsListeners()
}
