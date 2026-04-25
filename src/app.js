pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'

// ══ STATE ══
let currentRotation = 0
let currentFlipH = false
let currentBW = false
let allEntries = [], categories = {}, sequences = {}
let selectedCats = new Set()
let selectedSeq = null
let sessionEntries = [], sessionLog = []
let currentIndex = 0, timerDuration = 30, timeLeft = 30
let paused = false, ticker = null, loading = false
let currentSubMode = 'custom', mainMode = 'pose'

const PROGRESSIVE_PHASES = [
  { duration: 30, count: 10, label: '30 sec' },
  { duration: 60, count: 5,  label: '1 min' },
  { duration: 120, count: 5, label: '2 min' },
  { duration: 300, count: 2, label: '5 min' }
]
let progressiveQueue = []

// ══ ANIMATION STATE ══
let animFrames = []
let animNavPath = []
let animIndex = 0
let animLooping = false
let animInterval = null
let animStudyMode = false
let isR2Mode = false
let currentUserIsPro = false
// Seule séquence animation accessible aux users FREE (la première alphabétiquement
// parmi les current/free/*). Tout le reste est locké. Pro = accès complet.
let _freeAllowedSeq = null
let studyTimeLeft = 30, studyDuration = 30, studyTicker = null

// ══ AUDIO ══
let audioCtx = null
function beep(freq, dur, vol) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)()
    const o = audioCtx.createOscillator(), g = audioCtx.createGain()
    o.connect(g); g.connect(audioCtx.destination)
    o.frequency.value = freq
    g.gain.setValueAtTime(vol, audioCtx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur)
    o.start(); o.stop(audioCtx.currentTime + dur)
  } catch(e) { console.warn('Audio error:', e) }
}
function soundWarning() { beep(880, 0.15, 0.3) }
function soundNext() { beep(440, 0.3, 0.4); setTimeout(() => beep(550, 0.3, 0.3), 150) }

// ══ INIT ══
window.addEventListener('DOMContentLoaded', () => {
  if (window.electronAPI?.authCheck) {
    window.electronAPI.authCheck().then(result => {
      if (result.authenticated) {
        if (result.isAdmin) document.getElementById('admin-source-card').style.display = 'block'
        if (result.email) _communityEmail = result.email
        if (result.username) _communityUsername = result.username
        maybeShowOnboarding()
        maybeAskForUsername()
      }
    })
  }
  renderWeekBar()
  document.getElementById('options-btn').style.display = 'flex'
  document.getElementById('discord-btn').style.display = 'flex'
  document.getElementById('profile-btn').style.display = 'flex'

  if (window.electronAPI?.onAuthRequired) {
    if (window.electronAPI?.onAuthSuccess) {
      window.electronAPI.onAuthSuccess((user) => {
        if (user.isAdmin) document.getElementById('admin-source-card').style.display = 'block'
        if (user.email) _communityEmail = user.email
        if (user.username) _communityUsername = user.username
        maybeShowOnboarding()
        maybeAskForUsername()
      })
    }
    window.electronAPI.onAuthRequired(() => {
      document.getElementById('options-btn').style.display = 'none'
      document.getElementById('profile-btn').style.display = 'none'
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'))
      const existing = document.getElementById('screen-login')
      if (existing) existing.remove()
      const div = document.createElement('div')
      div.id = 'screen-login'
      div.className = 'auth-screen'
      div.innerHTML = `
        <div class="auth-card">
          <div class="auth-logo"><span class="auth-logo-text">Gestur<span class="gesturo-o">o</span><span class="auth-logo-dot">.</span></span></div>
          <div class="auth-subtitle">Entrainement au dessin de poses</div>
          <div id="auth-login-form" class="auth-form">
            <div class="auth-input-wrap">
              <input id="auth-email" type="email" placeholder="Email" autocomplete="email">
              <span class="auth-input-icon"><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 4L12 13 2 4"/></svg></span>
            </div>
            <div class="auth-input-wrap">
              <input id="auth-password" type="password" placeholder="Mot de passe" autocomplete="current-password">
              <span class="auth-input-icon"><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span>
            </div>
            <button id="btn-email-login" class="auth-btn auth-btn-primary">Se connecter</button>
            <button type="button" id="auth-forgot-btn" class="auth-forgot">Mot de passe oublie ?</button>
            <div id="auth-msg" class="auth-msg"></div>
            <div class="auth-separator"><span>ou</span></div>
            <button id="btn-google-login" class="auth-btn auth-btn-google">
              <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 0 1 0-9.18l-7.98-6.19a24.01 24.01 0 0 0 0 21.56l7.98-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
              Continuer avec Google
            </button>
            <p class="auth-switch">Pas de compte ? <a href="#" id="auth-goto-signup">Creer un compte</a></p>
          </div>
          <div id="auth-signup-form" class="auth-form" style="display:none;">
            <div class="auth-input-wrap">
              <input id="auth-signup-username" type="text" placeholder="Pseudo (visible dans la communauté)" autocomplete="username">
              <span class="auth-input-icon"><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg></span>
            </div>
            <div class="auth-input-wrap">
              <input id="auth-signup-email" type="email" placeholder="Email" autocomplete="email">
              <span class="auth-input-icon"><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 4L12 13 2 4"/></svg></span>
            </div>
            <div class="auth-input-wrap">
              <input id="auth-signup-password" type="password" placeholder="Mot de passe (6 car. min)" autocomplete="new-password">
              <span class="auth-input-icon"><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span>
            </div>
            <button id="btn-email-signup" class="auth-btn auth-btn-primary">Creer mon compte</button>
            <div id="auth-signup-msg" class="auth-msg"></div>
            <p class="auth-switch">Deja un compte ? <a href="#" id="auth-goto-login">Se connecter</a></p>
          </div>
        </div>
      `
      document.body.appendChild(div)
      document.getElementById('auth-goto-signup').addEventListener('click', (e) => {
        e.preventDefault()
        document.getElementById('auth-login-form').style.display = 'none'
        document.getElementById('auth-signup-form').style.display = ''
      })
      document.getElementById('auth-goto-login').addEventListener('click', (e) => {
        e.preventDefault()
        document.getElementById('auth-signup-form').style.display = 'none'
        document.getElementById('auth-login-form').style.display = ''
      })
      document.getElementById('btn-google-login').addEventListener('click', () => {
        window.electronAPI.authGoogle().then(result => {
          if (result?.success) location.reload()
          else document.getElementById('auth-msg').textContent = result?.message || result?.reason || 'Connexion échouée'
        }).catch(e => document.getElementById('auth-msg').textContent = e.message)
      })
      document.getElementById('btn-email-login').addEventListener('click', function() {
        const btn = this
        const email = document.getElementById('auth-email').value.trim()
        const password = document.getElementById('auth-password').value
        const msg = document.getElementById('auth-msg')
        if (!email || !password) { msg.textContent = 'Email et mot de passe requis'; return }
        btn.disabled = true; msg.textContent = 'Connexion...'
        window.electronAPI.authEmail({ email, password }).then(result => {
          if (result?.success) location.reload()
          else { msg.textContent = result?.message || 'Connexion échouée'; btn.disabled = false }
        }).catch(e => { msg.textContent = e.message; btn.disabled = false })
      })
      document.getElementById('btn-email-signup').addEventListener('click', function() {
        const btn = this
        const username = document.getElementById('auth-signup-username').value.trim()
        const email = document.getElementById('auth-signup-email').value.trim()
        const password = document.getElementById('auth-signup-password').value
        const msg = document.getElementById('auth-signup-msg')
        if (!username) { msg.textContent = 'Choisis un pseudo'; return }
        if (!email || !password) { msg.textContent = 'Email et mot de passe requis'; return }
        if (password.length < 6) { msg.textContent = 'Mot de passe trop court (6 car. min)'; return }
        btn.disabled = true; msg.textContent = 'Inscription...'
        window.electronAPI.authSignup({ email, password, username }).then(result => {
          if (result?.needsConfirmation) { msg.textContent = 'Vérifie tes emails pour confirmer ton compte !'; msg.style.color = '#2ecc71'; return }
          if (result?.success) location.reload()
          else { msg.textContent = result?.message || 'Inscription échouée'; btn.disabled = false }
        }).catch(e => { msg.textContent = e.message; btn.disabled = false })
      })
      document.getElementById('auth-password').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('btn-email-login').click()
      })
      document.getElementById('auth-signup-password').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('btn-email-signup').click()
      })
      document.getElementById('auth-forgot-btn').addEventListener('click', () => {
        const email = document.getElementById('auth-email').value.trim()
        const msg = document.getElementById('auth-msg')
        if (!email) { msg.textContent = 'Entre ton email ci-dessus d\'abord'; msg.style.color = '#e24b4a'; return }
        msg.textContent = 'Envoi du lien...'; msg.style.color = '#4a6280'
        window.electronAPI.authResetPassword(email).then(result => {
          if (result?.success) { msg.textContent = 'Lien envoyé ! Vérifie tes emails.'; msg.style.color = '#2ecc71' }
          else { msg.textContent = result?.message || 'Erreur'; msg.style.color = '#e24b4a' }
        }).catch(e => { msg.textContent = e.message; msg.style.color = '#e24b4a' })
      })
    })
  }

  function initAutoLoad() {
    if (!window.electronAPI) { setTimeout(initAutoLoad, 100); return }
    window.electronAPI.onUseR2Mode(({ isPro }) => {
      isR2Mode = true
      currentUserIsPro = isPro
      const badge = document.getElementById('plan-badge')
      if (badge) {
        badge.style.display = 'flex'
        if (isPro) {
          badge.textContent = '⭐ PRO'
          badge.style.background = 'rgba(240,192,64,0.15)'
          badge.style.border = '0.5px solid #f0c040'
          badge.style.color = '#f0c040'
        } else {
          badge.textContent = 'FREE'
          badge.style.background = 'rgba(255,255,255,0.05)'
          badge.style.border = '0.5px solid #333'
          badge.style.color = '#555'
        }
      }
      loadR2(isPro)
      syncFavsFromServer()
      syncHistFromServer()
      syncBadgesFromServer()
      loadAnnouncement()
      checkMaintenanceMode()
      pingUserActivity()
      loadFeatureFlagsFromServer()
      // Poll announcements toutes les 5 min + quand l'app revient au focus
      setInterval(loadAnnouncement, 5 * 60 * 1000)
      window.addEventListener('focus', loadAnnouncement)
    })
    window.electronAPI.onAutoLoad(f => { isR2Mode = false; loadFolder(f) })
  }
  initAutoLoad()
})

function adminSetSource(source) {
  if (source === 'r2') {
    document.getElementById('btn-source-r2').style.cssText += ';background:#1a2e44;border-color:#5b9bd5;color:#5b9bd5'
    document.getElementById('btn-source-local').style.background = ''
    document.getElementById('btn-source-local').style.borderColor = ''
    document.getElementById('btn-source-local').style.color = ''
    window.electronAPI.adminSwitchSource({ useLocal: false })
  } else {
    document.getElementById('btn-source-local').style.cssText += ';background:#1a2e44;border-color:#5b9bd5;color:#5b9bd5'
    document.getElementById('btn-source-r2').style.background = ''
    document.getElementById('btn-source-r2').style.borderColor = ''
    document.getElementById('btn-source-r2').style.color = ''
    window.electronAPI.adminSwitchSource({ useLocal: true })
  }
}

window.addEventListener('resize', () => { if (typeof gridMode !== 'undefined' && gridMode > 0) positionGridOverlay() })

// ══ MOODBOARD (in-app via webview) ══
let moodboardLoaded = false
let moodboardNeedsRefresh = false
async function openMoodboard() {
  if (window.matchMedia && window.matchMedia('(max-width: 1399px)').matches) {
    showScreen('screen-config'); return
  }
  const wv = document.getElementById('moodboard-webview')
  if (!moodboardLoaded) {
    try {
      const p = await window.electronAPI.getMoodboardPreloadPath()
      if (p) wv.setAttribute('preload', 'file://' + p)
    } catch (e) {  }
    wv.setAttribute('src', 'moodboard/index.html')
    moodboardLoaded = true
  } else if (moodboardNeedsRefresh) {
    // A project was created/modified from outside the webview — reload it
    try { wv.reload() } catch (e) {  }
    moodboardNeedsRefresh = false
  }
  showScreen('screen-moodboard')
}
function closeMoodboard() { showScreen('screen-config') }

// Kill tous les intervals/tickers d'une session active. Appelé automatiquement
// par showScreen() quand on quitte screen-session/anim/cinema vers un autre
// écran — garantit qu'aucun chargement ni timer ne tourne en arrière-plan.
function cleanupActiveSession() {
  try {
    if (typeof ticker !== 'undefined' && ticker) { clearInterval(ticker); ticker = null }
    if (typeof animInterval !== 'undefined' && animInterval) { clearInterval(animInterval); animInterval = null }
    if (typeof studyTicker !== 'undefined' && studyTicker) { clearInterval(studyTicker); studyTicker = null }
    if (typeof _bgPreloadTimer !== 'undefined' && _bgPreloadTimer) { clearTimeout(_bgPreloadTimer); _bgPreloadTimer = null }
    if (typeof animLooping !== 'undefined') animLooping = false
    if (typeof communityInterval !== 'undefined' && communityInterval) { clearInterval(communityInterval); communityInterval = null }
    if (typeof _countdownInterval !== 'undefined' && _countdownInterval) { clearInterval(_countdownInterval); _countdownInterval = null }
    paused = false
  } catch (e) { /* silent */ }
}

function showScreen(id) {
  // Si on quitte un écran de jeu vers autre chose, kill les intervals pour
  // éviter que les poses continuent à défiler / charger en arrière-plan.
  const GAME_SCREENS = ['screen-session', 'screen-anim', 'screen-cinema']
  const previousActive = document.querySelector('.screen.active')
  const oldId = previousActive ? previousActive.id : null
  if (oldId && oldId !== id && GAME_SCREENS.includes(oldId)) {
    cleanupActiveSession()
  }
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'))
  document.getElementById(id).classList.add('active')
  const visible = id === 'screen-config'
  document.getElementById('options-btn').style.display = visible ? 'flex' : 'none'
  document.getElementById('discord-btn').style.display = visible ? 'flex' : 'none'
  document.getElementById('profile-btn').style.display = visible ? 'flex' : 'none'
  const badge = document.getElementById('plan-badge')
  if (badge) badge.style.display = (visible && badge.textContent.trim()) ? 'flex' : 'none'
  document.getElementById('options-dropdown').classList.remove('open')
  // Orientation : libre sur les écrans où la photo est plein écran
  // (pose / animation / cinéma), lock portrait ailleurs. Sur desktop
  // Electron les helpers sont absents = no-op silencieux.
  const FREE_ORIENTATION = ['screen-session', 'screen-anim', 'screen-cinema']
  if (FREE_ORIENTATION.includes(id)) {
    if (window.__unlockOrientation) window.__unlockOrientation()
  } else {
    if (window.__lockPortrait) window.__lockPortrait()
  }
}

function applyTransform() {
  const scaleX = currentFlipH ? -1 : 1
  const transform = 'rotate(' + currentRotation + 'deg) scaleX(' + scaleX + ')'
  const filter = currentBW ? 'grayscale(1)' : ''
  document.getElementById('photo-img').style.transform = transform
  document.getElementById('photo-img').style.filter = filter
  document.getElementById('pdf-canvas').style.transform = transform
  document.getElementById('pdf-canvas').style.filter = filter
}

function toggleBW() {
  currentBW = !currentBW
  const btn = document.getElementById('bw-btn')
  btn.style.color = currentBW ? '#fff' : ''
  btn.style.background = currentBW ? 'rgba(255,255,255,0.15)' : ''
  btn.style.borderColor = currentBW ? 'rgba(255,255,255,0.4)' : ''
  applyTransform()
}
function rotateLeft() { currentRotation = (currentRotation - 90 + 360) % 360; applyTransform() }
function rotateRight() { currentRotation = (currentRotation + 90) % 360; applyTransform() }
function flipH() { currentFlipH = !currentFlipH; applyTransform() }

let flipModeEnabled = false
function toggleFlipMode() {
  flipModeEnabled = !flipModeEnabled
  const toggle = document.getElementById('flip-toggle')
  const knob = document.getElementById('flip-knob')
  const label = document.getElementById('flip-label')
  // Toggle classe .on (utilisée par le CSS mobile/tablet pour l'état iOS-like)
  toggle.classList.toggle('on', flipModeEnabled)
  // Inline styles conservés pour le rendu desktop (non overridés par le CSS)
  if (flipModeEnabled) {
    toggle.style.background = '#fff'; knob.style.left = '21px'; knob.style.background = '#111'
    label.textContent = 'Activé'; label.style.color = '#fff'
  } else {
    toggle.style.background = '#2e2e2e'; knob.style.left = '3px'; knob.style.background = '#666'
    label.textContent = 'Désactivé'; label.style.color = '#555'
  }
}

function resetTransform() {
  currentRotation = flipModeEnabled ? 180 : 0
  currentFlipH = false
  requestAnimationFrame(() => applyTransform())
}

// ══ CHARGEMENT DOSSIER ══
async function loadFolder(folder) {
  document.getElementById('folder-path').textContent = folder
  document.getElementById('file-count').textContent = 'Indexation...'
  document.getElementById('btn-start').disabled = true
  allEntries = []; categories = {}; sequences = {}
  // imgCache gardé entre sessions (les URLs R2 ne changent pas, re-download inutile)
  const fileInfos = await window.electronAPI.listFiles(folder)
  for (const info of fileInfos) {
    const fp = info.path, cat = info.category, seq = info.sequence
    if (seq) {
      if (!sequences[seq]) sequences[seq] = { paths: [], animCategory: info.animCategory || null }
      sequences[seq].paths.push(fp); continue
    }
    if (window.electronAPI.isPdf(fp)) {
      const e = { type: 'pdf-pending', path: fp, category: cat }
      allEntries.push(e)
      if (!categories[cat]) categories[cat] = []
      categories[cat].push(e)
    } else {
      const e = { type: 'image', path: fp, category: cat }
      allEntries.push(e)
      if (!categories[cat]) categories[cat] = []
      categories[cat].push(e)
    }
  }
  renderCategories(); renderSequences()
  const seqCount = Object.keys(sequences).length
  const pdfCount = allEntries.filter(e => e.type === 'pdf-pending').length
  let msg = allEntries.length + ' fichiers indexés'
  if (pdfCount > 0) msg += ' (' + pdfCount + ' PDF)'
  if (seqCount > 0) msg += ' · ' + seqCount + ' séquence(s)'
  document.getElementById('file-count').textContent = msg
  document.getElementById('btn-start').disabled = false
}

async function loadR2(isPro) {
  document.getElementById('folder-path').textContent = isPro ? '☁️ Gesturo Pro — R2' : '☁️ Gesturo — R2'
  document.getElementById('file-count').textContent = 'Chargement depuis le cloud...'
  document.getElementById('btn-start').disabled = true
  allEntries = []; categories = {}; sequences = {}
  // imgCache gardé entre sessions (les URLs R2 ne changent pas, re-download inutile)
  try {
    const [photos, anims] = await Promise.all([
      window.electronAPI.listR2Photos({ isPro }),
      window.electronAPI.listR2Animations({ isPro })
    ])
    for (const info of photos) {
      const fp = info.path, cat = info.category, sub = info.subcategory
      const e = { type: 'image', path: fp, category: cat, subcategory: sub, isR2: true }
      allEntries.push(e)
      if (!categories[cat]) categories[cat] = { entries: [], subcategories: {} }
      categories[cat].entries.push(e)
      if (sub) {
        if (!categories[cat].subcategories[sub]) categories[cat].subcategories[sub] = []
        categories[cat].subcategories[sub].push(e)
      }
    }
    for (const info of anims) {
      const seq = info.sequence; if (!seq) continue
      if (!sequences[seq]) sequences[seq] = { paths: [], animCategory: info.animCategory || null, locked: !!info.locked }
      sequences[seq].paths.push(info.path)
      // Si n'importe quel path d'une seq est marqué locked, toute la seq l'est
      if (info.locked) sequences[seq].locked = true
    }
    // Determine la seule sequence animation accessible aux users FREE :
    // la premiere current/free/* alphabetiquement. Deterministe → meme choix
    // entre runs. Pour PRO on laisse null (pas de restriction).
    if (!isPro) {
      const freeSeqs = Object.keys(sequences).filter(s => s.startsWith('current/free')).sort()
      _freeAllowedSeq = freeSeqs[0] || null
    } else {
      _freeAllowedSeq = null
    }
    if (!isPro) {
      // FREE users : injecter les catégories Pro comme "teasers" lockés
      // (le backend ne les renvoie pas aux FREE, donc on les ajoute ici en placeholder)
      for (const proCat of PRO_CATEGORIES) {
        if (!categories[proCat]) {
          categories[proCat] = { entries: [], subcategories: {}, locked: true }
        }
      }
    } else {
      // PRO users : masquer les catégories FREE_ONLY (actuellement vide)
      for (const freeCat of FREE_ONLY_CATEGORIES) {
        delete categories[freeCat]
      }
    }
    renderCategories(); renderSequences()
    const seqCount = Object.keys(sequences).length
    document.getElementById('file-count').textContent = allEntries.length + ' photos · ' + seqCount + ' séquence(s)'
    const r2Status = document.getElementById('r2-status')
    if (r2Status) r2Status.textContent = allEntries.length + ' photos chargées ✓'
    document.getElementById('btn-start').disabled = allEntries.length === 0
  } catch(e) {
    
    const msg = (e && e.message) || String(e)
    // Si l'Edge Function renvoie 401, c'est généralement une session expirée
    // ou un compte sans entrée profiles. On le dit clairement au user au lieu
    // de l'ancien faux "0 photos chargées ✓".
    const is401 = /\b401\b/.test(msg)
    const hint = is401
      ? '❌ Session expirée — déconnecte-toi puis reconnecte-toi'
      : '❌ Erreur de chargement R2 : ' + msg
    document.getElementById('file-count').textContent = hint
    const r2Status = document.getElementById('r2-status')
    if (r2Status) r2Status.textContent = hint
    document.getElementById('btn-start').disabled = true
  }
}

async function pickFolder() {
  const folder = await window.electronAPI.pickFolder()
  if (!folder) return
  await loadFolder(folder)
}

// ══ CATÉGORIES ══
const CAT_ICONS = { 'animals': '🐾', 'jambes-pieds': '🦵', 'mains': '🤲', 'nudite': '🔞', 'poses-dynamiques': '⚡', 'visage': '👤' }
function getCatIcon(cat) { return CAT_ICONS[cat.toLowerCase()] || '📁' }
function getCatLabel(cat) { const labels = { 'animals': 'Animaux', 'jambes-pieds': 'Jambes & Pieds', 'mains': 'Mains', 'nudite': 'Nudité', 'poses-dynamiques': 'Poses Dynamiques', 'visage': 'Visage' }; return labels[cat.toLowerCase()] || cat.charAt(0).toUpperCase() + cat.slice(1).replace(/-/g, ' ') }
const NUDITY_KW = ['nudité', 'nudite', 'nu ', 'nude', 'nsfw']
function isNudity(n) { return NUDITY_KW.some(k => n.toLowerCase().includes(k)) }
// Cats injectées côté client comme teasers lockés (non renvoyées par le
// backend aux users FREE). Historiquement juste 'nudite' — à étendre si
// on ajoute d'autres cats cachées dans R2.
const PRO_CATEGORIES = ['nudite']
// Catégories visibles uniquement par les users FREE (masquées pour les PRO)
// Vide pour l'instant — prêt à être rempli quand le catalogue aura un vrai split free/pro
const FREE_ONLY_CATEGORIES = []
// Whitelist : seules catégories RÉELLEMENT accessibles en FREE. Toutes les
// autres (mains, jambes-pieds, visage, animals, nudite, etc.) sont lockées
// et ouvrent la modale upgrade Pro au clic. On utilise une whitelist
// (plutôt qu'une blacklist) pour que toute nouvelle cat ajoutée au
// catalogue soit Pro par défaut — fail-safe pour la monétisation.
const FREE_ACCESSIBLE_CATEGORIES = ['poses-dynamiques']
function isProCategory(cat) {
  return !FREE_ACCESSIBLE_CATEGORIES.includes(cat.toLowerCase())
}
function isFreeOnlyCategory(cat) { return FREE_ONLY_CATEGORIES.includes(cat.toLowerCase()) }

function buildCatCard(cat, key, count, previewUrl, isSelected, hasSubs, nudity = false, locked = false) {
  const card = document.createElement('div')
  card.dataset.cat = key
  if (locked) card.classList.add('cat-locked')
  const borderColor = locked ? '#3a5570' : (isSelected ? (nudity ? '#E24B4A' : '#2983eb') : '#1e2d40')
  const borderStyle = locked ? 'dashed' : 'solid'
  card.style.cssText = `position:relative;border-radius:10px;overflow:hidden;cursor:${locked ? 'not-allowed' : 'pointer'};border:1.5px ${borderStyle} ${borderColor};background:#131f2e;aspect-ratio:4/3;transition:border-color 0.15s,transform 0.15s;${locked ? 'opacity:0.5;' : ''}`
  if (previewUrl) {
    const img = document.createElement('img')
    img.src = previewUrl; img.loading = 'lazy'
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;opacity:0;transition:opacity 0.3s;'
    img.onload = () => { img.style.opacity = isSelected ? '1' : '0.35' }
    img.onerror = () => { img.style.display = 'none' }
    card.appendChild(img)
  }
  const overlay = document.createElement('div')
  overlay.style.cssText = 'position:absolute;inset:0;background:linear-gradient(to top, rgba(5,10,18,0.95) 0%, rgba(5,10,18,0.3) 60%, transparent 100%);display:flex;flex-direction:column;justify-content:flex-end;padding:10px;'
  overlay.appendChild(Object.assign(document.createElement('div'), { textContent: getCatIcon(cat), style: 'font-size:18px;margin-bottom:4px;' }))
  const labelText = getCatLabel(cat) + (locked ? ' 🔒' : '')
  overlay.appendChild(Object.assign(document.createElement('div'), { textContent: labelText, style: 'font-size:12px;font-weight:600;color:#fff;line-height:1.2;' }))
  const subText = locked ? 'Pro' : (count + ' poses')
  overlay.appendChild(Object.assign(document.createElement('div'), { textContent: subText, style: 'font-size:11px;color:#4a6280;margin-top:2px;' }))
  card.appendChild(overlay)
  if (!hasSubs && !locked) {
    const badge = document.createElement('div')
    badge.style.cssText = `position:absolute;top:8px;right:8px;width:20px;height:20px;border-radius:50%;background:${nudity ? '#E24B4A' : '#2983eb'};display:${isSelected ? 'flex' : 'none'};align-items:center;justify-content:center;font-size:11px;color:#fff;font-weight:700;`
    badge.textContent = '✓'
    card.appendChild(badge)
  }
  if (!locked) {
    card.addEventListener('mouseenter', () => { card.style.transform = 'translateY(-2px)' })
    card.addEventListener('mouseleave', () => { card.style.transform = '' })
  }
  return card
}

function renderCategories(parentCat = null) {
  const wrap = document.getElementById('categories-wrap')
  wrap.innerHTML = ''
  // Tri : cats accessibles d'abord (déverrouillées), puis les lockées —
  // pour qu'un user FREE voie immédiatement ce qu'il peut utiliser sans
  // scroller. Pour un user Pro, isCatLocked retourne false partout donc
  // l'ordre reste alphabétique.
  const cats = Object.keys(categories).sort((a, b) => {
    const aLocked = isCatLocked(a)
    const bLocked = isCatLocked(b)
    if (aLocked !== bLocked) return aLocked ? 1 : -1
    return a.localeCompare(b)
  })
  if (cats.length === 0) { selectedCats = new Set(['Sans catégorie']); return }
  const header = document.createElement('div')
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;'
  if (parentCat) {
    header.innerHTML = `<button class="cat-back-btn" onclick="renderCategories(null)"><span class="cat-back-arrow">‹</span> ${getCatLabel(parentCat)}</button><span style="font-size:12px;color:#3a5570;text-transform:uppercase;letter-spacing:0.8px;">Sous-collections</span>`
  } else {
    const selectableRoots = cats.filter(c => !isCatLocked(c))
    const allSelected = selectableRoots.length > 0 && selectableRoots.every(c => selectedCats.has(c))
    header.innerHTML = `<span style="font-size:12px;color:#3a5570;text-transform:uppercase;letter-spacing:0.8px;">Collections</span><button id="cat-all" onclick="toggleAllCats()" style="font-size:12px;background:transparent;border:0.5px solid #1e2d40;border-radius:6px;color:${allSelected ? '#2983eb' : '#3a5570'};padding:4px 10px;cursor:pointer;">${allSelected ? '✓ Tout' : 'Tout sélectionner'}</button>`
  }
  wrap.appendChild(header)
  const grid = document.createElement('div')
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;'
  wrap.appendChild(grid)
  if (parentCat) {
    const subs = categories[parentCat]?.subcategories || {}
    Object.keys(subs).sort().forEach(sub => {
      const entries = subs[sub]
      const isSelected = selectedCats.has(parentCat + '/' + sub)
      const card = buildCatCard(sub, parentCat + '/' + sub, entries.length, entries[0]?.path || null, isSelected, false, isNudity(parentCat))
      card.onclick = () => toggleSubCat(parentCat, sub, card)
      grid.appendChild(card)
    })
  } else {
    cats.forEach(cat => {
      const nudity = isNudity(cat)
      const catData = categories[cat]
      const entries = Array.isArray(catData) ? catData : (catData.entries || [])
      const subs = Array.isArray(catData) ? {} : (catData.subcategories || {})
      const hasSubs = Object.keys(subs).length > 0
      const isSelected = selectedCats.has(cat)
      // Une catégorie est lockée si explicitement marquée, ou si c'est une Pro cat pour un user FREE
      const locked = (!Array.isArray(catData) && catData.locked) || (!currentUserIsPro && isProCategory(cat))
      // Deselect locked categories pour éviter qu'elles soient dans selectedCats
      if (locked && selectedCats.has(cat)) selectedCats.delete(cat)
      const card = buildCatCard(cat, cat, entries.length, entries[0]?.path || null, isSelected && !locked, hasSubs, nudity, locked)
      if (locked) {
        card.onclick = () => showUpgradeModal()
      } else if (hasSubs) {
        card.onclick = () => renderCategories(cat)
        const arrow = document.createElement('div')
        arrow.style.cssText = 'position:absolute;top:8px;left:8px;background:rgba(5,10,18,0.7);border-radius:4px;padding:2px 6px;font-size:10px;color:#8aaccc;'
        arrow.textContent = Object.keys(subs).length + ' collections →'
        card.appendChild(arrow)
      } else { card.onclick = () => toggleCat(cat, card) }
      grid.appendChild(card)
    })
  }
}

function showUpgradeModal() {
  const existing = document.getElementById('upgrade-modal'); if (existing) existing.remove()
  const modal = document.createElement('div')
  modal.id = 'upgrade-modal'
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:9999;'
  modal.innerHTML = `<div style="background:#1e1e1e;border:0.5px solid #333;border-radius:16px;padding:32px;width:360px;text-align:center;"><div style="font-size:28px;margin-bottom:12px;">⭐</div><h2 style="color:#fff;font-size:20px;margin-bottom:8px;">Gestur<span class="gesturo-o">o</span> Pro</h2><p style="color:#555;font-size:14px;line-height:1.6;margin-bottom:24px;">Accède à toutes les catégories, les animations et les poses de nudité académique.</p><button onclick="window.electronAPI.openExternal('https://gesturo.art')" style="width:100%;padding:13px;background:#fff;color:#111;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer;margin-bottom:10px;">Découvrir Pro</button><button onclick="document.getElementById('upgrade-modal').remove()" style="width:100%;padding:10px;background:transparent;color:#555;border:none;font-size:14px;cursor:pointer;">Pas maintenant</button></div>`
  document.body.appendChild(modal)
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove() })
}

// Applique l'état visuel (border, opacity, check) d'une catégorie card.
function applyCatVisual(card, selected, nudity) {
  if (selected) {
    card.style.borderColor = nudity ? '#E24B4A' : '#2983eb'
    const img = card.querySelector('img'); if (img) img.style.opacity = '1'
    card.lastElementChild.style.display = 'flex'
  } else {
    card.style.borderColor = '#1e2d40'
    const img = card.querySelector('img'); if (img) img.style.opacity = '0.35'
    card.lastElementChild.style.display = 'none'
  }
}

// Modale à 2 choix positifs (Ajouter / Remplacer) + fermeture. Utilisée
// quand l'user clique sur un 2e pack alors qu'une sélection existe déjà.
function showCatChoiceModal(catLabel, onAdd, onReplace) {
  let overlay = document.getElementById('generic-modal-overlay')
  if (overlay) overlay.remove()
  overlay = document.createElement('div')
  overlay.id = 'generic-modal-overlay'
  overlay.style.cssText = 'display:flex;position:fixed;inset:0;background:rgba(5,12,22,0.88);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);align-items:center;justify-content:center;z-index:9000;padding:24px;'
  overlay.innerHTML =
    '<div style="background:#131f2e;border:0.5px solid #1e2d40;border-radius:16px;padding:28px;max-width:380px;width:100%;text-align:center;">' +
    '<p style="font-size:15px;color:#fff;margin:0 0 8px;line-height:1.5;font-weight:600;">Ajouter « ' + catLabel + ' » ?</p>' +
    '<p style="font-size:13px;color:#8aaccc;margin:0 0 22px;line-height:1.5;">Tu as déjà une sélection. Veux-tu cumuler les packs ou repartir de zéro ?</p>' +
    '<div style="display:flex;flex-direction:column;gap:8px;">' +
    '<button id="gm-add" style="width:100%;min-height:48px;padding:14px;font-size:14px;border-radius:10px;background:#2983eb;border:none;color:#fff;font-weight:600;cursor:pointer;">➕ Ajouter à la sélection</button>' +
    '<button id="gm-replace" style="width:100%;min-height:48px;padding:14px;font-size:14px;border-radius:10px;background:rgba(255,255,255,0.06);border:0.5px solid rgba(255,255,255,0.1);color:rgba(255,255,255,0.85);cursor:pointer;">🔄 Remplacer la sélection</button>' +
    '<button id="gm-cancel-choice" style="width:100%;min-height:40px;padding:10px;font-size:13px;border-radius:10px;background:transparent;border:none;color:#4a6280;cursor:pointer;">Annuler</button>' +
    '</div></div>'
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove() })
  document.body.appendChild(overlay)
  document.getElementById('gm-add').onclick = () => { overlay.remove(); onAdd() }
  document.getElementById('gm-replace').onclick = () => { overlay.remove(); onReplace() }
  document.getElementById('gm-cancel-choice').onclick = () => overlay.remove()
}

function toggleCat(cat, card) {
  const nudity = isNudity(cat)
  // Cas 1 : catégorie déjà sélectionnée → retirer (peut ramener à 0)
  if (selectedCats.has(cat)) {
    selectedCats.delete(cat)
    applyCatVisual(card, false, nudity)
    updateAllBtn()
    return
  }
  // Cas 2 : rien de sélectionné → ajouter directement
  if (selectedCats.size === 0) {
    selectedCats.add(cat)
    applyCatVisual(card, true, nudity)
    updateAllBtn()
    return
  }
  // Cas 3 : d'autres packs déjà sélectionnés → demander Ajouter / Remplacer
  showCatChoiceModal(getCatLabel(cat),
    () => {
      // Ajouter à la sélection existante
      selectedCats.add(cat)
      applyCatVisual(card, true, nudity)
      updateAllBtn()
    },
    () => {
      // Remplacer : on clear et on ne garde que celle-ci.
      // renderCategories() rebuild la grille → visuels réinitialisés proprement.
      selectedCats.clear()
      selectedCats.add(cat)
      renderCategories()
    }
  )
}

function toggleSubCat(parentCat, sub, card) {
  const key = parentCat + '/' + sub
  const nudity = isNudity(parentCat)
  // Cas 1 : déjà sélectionnée → retirer
  if (selectedCats.has(key)) {
    selectedCats.delete(key)
    applyCatVisual(card, false, nudity)
    return
  }
  // Cas 2 : rien de sélectionné → ajouter directement
  if (selectedCats.size === 0) {
    selectedCats.add(key)
    applyCatVisual(card, true, nudity)
    return
  }
  // Cas 3 : d'autres packs sélectionnés → demander
  showCatChoiceModal(sub,
    () => {
      selectedCats.add(key)
      applyCatVisual(card, true, nudity)
    },
    () => {
      selectedCats.clear()
      selectedCats.add(key)
      renderCategories(parentCat)
    }
  )
}

// Retourne true si une catégorie racine est verrouillée (Pro-only pour un
// user Free, ou flag locked explicite). Même logique que renderCategories.
function isCatLocked(cat) {
  const catData = categories[cat]
  const explicit = !Array.isArray(catData) && catData && catData.locked
  return explicit || (!currentUserIsPro && isProCategory(cat))
}

function toggleAllCats() {
  // On ignore les catégories verrouillées : sinon `every()` ne peut jamais
  // être true pour un user Free (les lockées sont re-supprimées de
  // selectedCats au render → bascule cassée).
  const selectable = Object.keys(categories).filter(c => !isCatLocked(c))
  if (selectable.length === 0) return
  const all = selectable.every(c => selectedCats.has(c))
  if (all) selectedCats.clear()
  else selectable.forEach(c => selectedCats.add(c))
  renderCategories()
}

function updateAllBtn() {
  const btn = document.getElementById('cat-all'); if (!btn) return
  const selectable = Object.keys(categories).filter(c => !isCatLocked(c))
  const allSelected = selectable.length > 0 && selectable.every(c => selectedCats.has(c))
  btn.style.color = allSelected ? '#2983eb' : '#3a5570'
  btn.textContent = allSelected ? '✓ Tout' : 'Tout sélectionner'
}

function renderSequences(parentPath = null) {
  const wrap = document.getElementById('sequences-wrap'); wrap.innerHTML = ''
  if (Object.keys(sequences).length === 0) {
    wrap.innerHTML = '<div style="font-size:13px;color:#3a5570;text-align:center;padding:20px 0;">Aucune séquence disponible.</div>'; return
  }
  const header = document.createElement('div')
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;'
  if (parentPath) {
    const label = parentPath.split('/').pop()
    header.innerHTML = `<button class="cat-back-btn" onclick="renderSequences(${parentPath.split('/').slice(0,-1).join('/') ? "'"+parentPath.split('/').slice(0,-1).join('/')+"'" : 'null'})"><span class="cat-back-arrow">‹</span> ${label}</button><span style="font-size:12px;color:#3a5570;text-transform:uppercase;letter-spacing:0.8px;">Séquences</span>`
  } else {
    header.innerHTML = `<span style="font-size:12px;color:#3a5570;text-transform:uppercase;letter-spacing:0.8px;">Collections</span>`
  }
  wrap.appendChild(header)
  const grid = document.createElement('div')
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;'
  wrap.appendChild(grid)
  const folders = new Map(); const leafSequences = []
  for (const [seq, data] of Object.entries(sequences)) {
    // PRO users : masquer complètement les séquences du dossier free/
    if (currentUserIsPro && isR2Mode && seq.startsWith('current/free')) continue
    const seqParts = seq.split('/')
    if (parentPath) {
      const parentParts = parentPath.split('/')
      if (!seqParts.slice(0, parentParts.length).join('/').startsWith(parentPath)) continue
      const remaining = seqParts.slice(parentParts.length)
      if (remaining.length === 1) leafSequences.push(seq)
      else if (remaining.length > 1) { const fn = parentPath + '/' + remaining[0]; if (!folders.has(fn)) folders.set(fn, data.paths[0]) }
    } else {
      const tier = seqParts.slice(0, 2).join('/')
      // Cas spécial : une séquence rangée directement dans current/pro/ (ex.
      // current/pro/sequence_1, sans sous-dossier Men/Women/etc.) a length=3.
      // Sans ce garde-fou, elle apparaîtrait comme leaf au root, à côté du
      // folder "pro" — incohérent visuellement et fait fuiter qu'une seq Pro
      // existe sans la cacher derrière le cadenas du folder. On la regroupe
      // toujours sous le folder "current/pro".
      if (seqParts.length === 3 && tier !== 'current/pro') {
        leafSequences.push(seq)
      } else {
        if (!folders.has(tier)) folders.set(tier, data.paths[0])
      }
    }
  }
  // Helpers pour render — extraits pour permettre un ordre custom selon plan
  const renderFolder = (previewUrl, folderPath) => {
    const label = folderPath.split('/').pop()
    const card = buildSeqCard(label, previewUrl, false, false, true)
    card.onclick = () => renderSequences(folderPath)
    const count = Object.keys(sequences).filter(s => s.startsWith(folderPath + '/')).length
    const arrow = document.createElement('div')
    arrow.style.cssText = 'position:absolute;top:8px;left:8px;background:rgba(5,10,18,0.7);border-radius:4px;padding:2px 6px;font-size:10px;color:#8aaccc;'
    arrow.textContent = count + ' séquences →'
    card.appendChild(arrow); grid.appendChild(card)
  }
  const renderLeaf = (seq) => {
    const data = sequences[seq]
    // FREE : seule _freeAllowedSeq est unlocked. Tout le reste = lock + upgrade modal.
    // Les seqs Pro apparaissent via le backend avec {locked:true} — on force le lock
    // même si le client a reçu leur preview (sécu redondante).
    const isLocked = !currentUserIsPro && isR2Mode && (seq !== _freeAllowedSeq || data.locked)
    const isSelected = selectedSeq === seq
    const previewUrl = isR2Mode ? data.paths[0] : 'file://' + data.paths[0]
    const label = seq.split('/').pop()
    const card = buildSeqCard(label, previewUrl, isSelected, isLocked, false, data.paths.length, seq)
    card.onclick = () => {
      if (isLocked) { showUpgradeModal(); return }
      selectedSeq = seq; renderSequences(parentPath); selectSeqPreload(seq)
    }
    grid.appendChild(card)
  }

  // Ordre : pour un user FREE, on remonte la séquence accessible tout en
  // haut (avant les folders) pour qu'il voie immédiatement ce qu'il peut
  // utiliser. Pour un Pro, ordre standard (folders puis leafs).
  const isFreeView = !currentUserIsPro && isR2Mode
  if (isFreeView) {
    const accessibleLeafs = leafSequences.filter(s => s === _freeAllowedSeq && !sequences[s].locked)
    const lockedLeafs = leafSequences.filter(s => !accessibleLeafs.includes(s))
    accessibleLeafs.forEach(renderLeaf)
    folders.forEach(renderFolder)
    lockedLeafs.forEach(renderLeaf)
  } else {
    folders.forEach(renderFolder)
    leafSequences.forEach(renderLeaf)
  }
  if (leafSequences.length > 0 && !selectedSeq) {
    const first = leafSequences.find(s => !(!currentUserIsPro && isR2Mode && s !== _freeAllowedSeq)) || leafSequences[0]
    selectedSeq = first; selectSeqPreload(first)
  }
}

function buildSeqCard(label, previewUrl, isSelected, isLocked, isFolder, frameCount = null, seq = null) {
  const card = document.createElement('div')
  card.style.cssText = `position:relative;border-radius:10px;overflow:hidden;cursor:pointer;border:1.5px solid ${isSelected ? '#2983eb' : '#1e2d40'};background:#131f2e;aspect-ratio:4/3;transition:border-color 0.15s,transform 0.15s;`
  const img = document.createElement('img')
  img.loading = 'lazy'
  img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;opacity:0;transition:opacity 0.3s;'
  if (previewUrl) { img.src = previewUrl; img.onload = () => { img.style.opacity = isSelected ? '1' : '0.45' }; img.onerror = () => { img.style.opacity = '0' } }
  card.appendChild(img)
  const overlay = document.createElement('div')
  overlay.style.cssText = 'position:absolute;inset:0;background:linear-gradient(to top, rgba(5,10,18,0.95) 0%, rgba(5,10,18,0.3) 60%, transparent 100%);display:flex;flex-direction:column;justify-content:flex-end;padding:10px;'
  overlay.appendChild(Object.assign(document.createElement('div'), { textContent: isFolder ? '📁' : (isLocked ? '🔒' : '▶'), style: 'font-size:18px;margin-bottom:4px;' }))
  overlay.appendChild(Object.assign(document.createElement('div'), { textContent: label.replace(/-/g, ' '), style: 'font-size:12px;font-weight:600;color:#fff;line-height:1.2;' }))
  if (frameCount) overlay.appendChild(Object.assign(document.createElement('div'), { textContent: frameCount + ' frames', style: 'font-size:11px;color:#4a6280;margin-top:2px;' }))
  card.appendChild(overlay)
  if (!isFolder && isSelected) {
    const badge = document.createElement('div')
    badge.style.cssText = 'position:absolute;top:8px;right:8px;width:20px;height:20px;border-radius:50%;background:#2983eb;display:flex;align-items:center;justify-content:center;font-size:11px;color:#fff;font-weight:700;'
    badge.textContent = '✓'; card.appendChild(badge)
  }
  if (!isFolder && seq && sequences[seq]) {
    let hoverInterval = null; let previewFrames = []; let previewLoaded = false; let frameIdx = 0
    const paths = sequences[seq].paths.slice(0, 10)
    const loadPreviews = () => {
      if (previewLoaded) return Promise.resolve()
      return Promise.all(paths.map(p => new Promise(resolve => {
        const i = new Image(); const src = isR2Mode ? p : 'file://' + p
        i.onload = () => { previewFrames.push(src); resolve() }; i.onerror = resolve; i.src = src
      }))).then(() => { previewLoaded = true })
    }
    setTimeout(() => loadPreviews(), 200)
    card.addEventListener('mouseenter', async () => {
      card.style.transform = 'translateY(-2px)'; await loadPreviews()
      if (previewFrames.length === 0) return
      frameIdx = 0; img.src = previewFrames[0]; img.style.opacity = '1'; img.style.transition = 'none'
      hoverInterval = setInterval(() => { frameIdx = (frameIdx + 1) % previewFrames.length; img.src = previewFrames[frameIdx] }, 150)
    })
    card.addEventListener('mouseleave', () => {
      card.style.transform = ''; clearInterval(hoverInterval); hoverInterval = null
      img.style.transition = 'opacity 0.3s'; img.src = previewUrl || ''; img.style.opacity = isSelected ? '1' : '0.45'
    })
  } else {
    card.addEventListener('mouseenter', () => { card.style.transform = 'translateY(-2px)' })
    card.addEventListener('mouseleave', () => { card.style.transform = '' })
  }
  return card
}

async function selectSeqPreload(seq) {
  if (preloadCache[seq]) return
  const paths = sequences[seq].paths
  await Promise.all(paths.map(p => new Promise(resolve => {
    const img = new Image(); img.onload = img.onerror = resolve; img.src = isR2Mode ? p : 'file://' + p
  })))
  preloadCache[seq] = true
}

async function selectSeq(seq, el) {
  document.querySelectorAll('.seq-item').forEach(i => i.classList.remove('selected'))
  el.classList.add('selected'); selectedSeq = seq
  if (preloadCache[seq]) return
  const paths = sequences[seq].paths || sequences[seq]
  const check = el.querySelector('.seq-check'); if (check) check.textContent = '...'
  await Promise.all(paths.map(p => new Promise(resolve => {
    const img = new Image(); img.onload = img.onerror = resolve; img.src = isR2Mode ? p : 'file://' + p
  })))
  preloadCache[seq] = true; el.classList.add('ready'); if (check) check.textContent = '✓'
}

// ══ MODES ══
function switchMainMode(mode) {
  // Skip si on est déjà dans ce mode — évite de relancer un render sur tap répété
  if (mainMode === mode) return
  mainMode = mode
  document.getElementById('tab-pose').classList.toggle('active', mode === 'pose')
  document.getElementById('tab-anim').classList.toggle('active', mode === 'anim')
  document.getElementById('tab-favs').classList.toggle('active', mode === 'favs')
  document.getElementById('tab-hist').classList.toggle('active', mode === 'hist')
  document.getElementById('tab-community').classList.toggle('active', mode === 'community')
  document.getElementById('tab-cinema').classList.toggle('active', mode === 'cinema')
  document.getElementById('pose-options').style.display = mode === 'pose' ? 'block' : 'none'
  document.getElementById('anim-options').style.display = mode === 'anim' ? 'block' : 'none'
  document.getElementById('favs-options').style.display = mode === 'favs' ? 'block' : 'none'
  document.getElementById('hist-options').style.display = mode === 'hist' ? 'block' : 'none'
  document.getElementById('community-options').style.display = mode === 'community' ? 'block' : 'none'
  document.getElementById('cinema-options').style.display = mode === 'cinema' ? 'block' : 'none'
  if (mode === 'cinema') {
    initFilmGrid()
    document.getElementById('btn-start').style.display = 'none'
    document.getElementById('btn-cinema-start').style.display = 'block'
  } else {
    document.getElementById('btn-cinema-start').style.display = 'none'
    document.getElementById('btn-start').style.display = (mode === 'favs' || mode === 'hist' || mode === 'community') ? 'none' : 'block'
  }
  if (mode === 'favs') renderFavsConfig()
  if (mode === 'hist') renderHist()
  if (mode === 'community') { renderCommunity(); startCommunityRefresh() }
  if (mode !== 'community') {
    if (communityInterval) { clearInterval(communityInterval); communityInterval = null }
    if (_countdownInterval) { clearInterval(_countdownInterval); _countdownInterval = null }
  }
  // Sync bottom tab bar (mobile) — Démarrer = tout sauf community
  const btabStart = document.getElementById('btab-start')
  const btabCommu = document.getElementById('btab-community')
  if (btabStart && btabCommu) {
    btabStart.classList.toggle('active', mode !== 'community')
    btabCommu.classList.toggle('active', mode === 'community')
  }
}

const preloadCache = {}

const COMMUNITY_EMOJIS = ['🔥', '💪', '🎨', '😍', '👏', '✨']
let reactionsCache = {}
let reactionUsers = {}
let myReactions = {}
let _communityEmail = ''
let _communityUsername = ''

async function loadReactions(postIds) {
  try {
    const res = await window.electronAPI.getReactions(postIds)
    const all = res?.reactions || []
    reactionsCache = {}
    reactionUsers = {}
    myReactions = {}
    const currentUser = _communityEmail
    all.forEach(r => {
      if (!reactionsCache[r.post_id]) reactionsCache[r.post_id] = {}
      if (!reactionUsers[r.post_id]) reactionUsers[r.post_id] = {}
      reactionsCache[r.post_id][r.emoji] = (reactionsCache[r.post_id][r.emoji] || 0) + 1
      if (!reactionUsers[r.post_id][r.emoji]) reactionUsers[r.post_id][r.emoji] = []
      const name = (r.user_email || '').split('@')[0] || 'anonyme'
      reactionUsers[r.post_id][r.emoji].push(name)
      if (r.user_email === currentUser) {
        if (!myReactions[r.post_id]) myReactions[r.post_id] = []
        myReactions[r.post_id].push(r.emoji)
      }
    })
  } catch(e) { /* silent */ }
}

async function toggleReaction(postId, emoji) {
  const btn = document.querySelector(`.community-reactions[data-post="${postId}"] .community-reaction-btn[data-emoji="${emoji}"]`)
  if (btn) btn.classList.toggle('active')
  try {
    const res = await window.electronAPI.toggleReaction(postId, emoji)
    if (!myReactions[postId]) myReactions[postId] = []
    if (!reactionsCache[postId]) reactionsCache[postId] = {}
    if (res.toggled === 'on') {
      myReactions[postId].push(emoji)
      reactionsCache[postId][emoji] = (reactionsCache[postId][emoji] || 0) + 1
    } else {
      myReactions[postId] = myReactions[postId].filter(e => e !== emoji)
      reactionsCache[postId][emoji] = Math.max(0, (reactionsCache[postId][emoji] || 1) - 1)
    }
    renderReactionButtons(postId)
    // Invalide le cache des stats pour déclencher la re-vérif des badges communauté
    _communityStats = null
    checkBadges()
  } catch(e) { if (btn) btn.classList.toggle('active') }
}

function renderReactionButtons(postId) {
  const container = document.querySelector(`.community-reactions[data-post="${postId}"]`)
  if (!container) return
  const mine = myReactions[postId] || []
  const counts = reactionsCache[postId] || {}
  const users = reactionUsers[postId] || {}
  container.querySelectorAll('.community-reaction-btn').forEach(btn => {
    const em = btn.dataset.emoji
    const count = counts[em] || 0
    btn.classList.toggle('active', mine.includes(em))
    const countEl = btn.querySelector('.count')
    if (countEl) countEl.textContent = count || ''
    // Tooltip with usernames
    let tooltip = btn.querySelector('.reaction-tooltip')
    const names = users[em] || []
    if (count > 0 && names.length > 0) {
      if (!tooltip) {
        tooltip = document.createElement('span')
        tooltip.className = 'reaction-tooltip'
        btn.appendChild(tooltip)
      }
      tooltip.textContent = names.slice(0, 8).join(', ') + (names.length > 8 ? '…' : '')
    } else if (tooltip) {
      tooltip.remove()
    }
  })
}

function formatPostDate(ts) {
  const d = new Date(ts)
  const now = new Date()
  const diff = Math.floor((now - d) / 1000)
  if (diff < 3600) return Math.floor(diff / 60) + ' min'
  if (diff < 86400) return Math.floor(diff / 3600) + ' h'
  if (diff < 604800) return Math.floor(diff / 86400) + ' j'
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

// ── Challenges ──
let _activeChallenges = []
let _selectedChallengeFilter = ''

async function loadChallenges() {
  try {
    const res = await window.electronAPI.getChallenges()
    _activeChallenges = res?.challenges || []
  } catch(e) { _activeChallenges = [] }
  renderChallengeBanner()
  renderChallengeFilter()
}

let _dailyChallengeTriggered = false
async function triggerDailyChallenge() {
  if (_dailyChallengeTriggered) return
  _dailyChallengeTriggered = true
  try {
    const sb = window.__gesturoAuth
      ? await window.__gesturoAuth.getSupabase()
      : null
    if (sb) {
      await sb.functions.invoke('daily-challenge')
    } else {
      // Desktop: call via electronAPI helper or direct fetch
      await window.electronAPI.triggerDailyChallenge()
    }
  } catch(e) { /* silent — challenge is optional */ }
}

function renderChallengeBanner() {
  const banner = document.getElementById('challenge-banner')
  if (!_activeChallenges.length) { banner.style.display = 'none'; return }
  banner.style.display = ''
  banner.innerHTML = ''
  _activeChallenges.forEach((c, i) => {
    const card = document.createElement('div')
    card.className = 'challenge-card'
    if (i > 0) card.classList.add('challenge-card-compact')
    card.innerHTML = `
      <div class="challenge-ref">
        <img src="${c.ref_image_url || ''}" alt="Ref">
      </div>
      <div class="challenge-info">
        <div class="challenge-label">CHALLENGE</div>
        <h3>${c.title || ''}</h3>
        <div class="challenge-deadline" data-challenge-id="${c.id}"></div>
        <div class="challenge-participants" data-challenge-id="${c.id}"></div>
        <button class="end-btn end-btn-share" onclick="participateChallenge('${c.id}')">Participer</button>
      </div>
    `
    banner.appendChild(card)
  })
  updateChallengeCountdown()
}

function updateChallengeCountdown() {
  _activeChallenges.forEach(c => {
    const el = document.querySelector(`.challenge-deadline[data-challenge-id="${c.id}"]`)
    if (!el) return
    const dl = new Date(c.deadline)
    const diff = dl - new Date()
    if (diff <= 0) { el.textContent = 'Dernière chance !'; return }
    const days = Math.floor(diff / 86400000)
    const hours = Math.floor((diff % 86400000) / 3600000)
    if (days > 0) el.textContent = days + 'j ' + hours + 'h restants'
    else el.textContent = hours + 'h restantes'
  })
}

function updateChallengeParticipants(allPosts) {
  _activeChallenges.forEach(c => {
    const el = document.querySelector(`.challenge-participants[data-challenge-id="${c.id}"]`)
    if (!el) return
    const count = allPosts.filter(p => p.challenge_id === c.id).length
    el.textContent = count > 0 ? count + ' participant' + (count > 1 ? 's' : '') : ''
  })
}

function renderChallengeFilter() {
  const filter = document.getElementById('challenge-filter')
  const select = document.getElementById('challenge-select')
  if (!_activeChallenges.length) { filter.style.display = 'none'; return }
  filter.style.display = ''
  select.innerHTML = '<option value="">Tous les posts</option>'
  _activeChallenges.forEach(c => {
    const opt = document.createElement('option')
    opt.value = c.id
    opt.textContent = 'Challenge: ' + c.title
    select.appendChild(opt)
  })
}

function filterByChallenge() {
  _selectedChallengeFilter = document.getElementById('challenge-select').value
  renderCommunity()
}

let _challengeSession = false

function participateChallenge(challengeId) {
  const c = challengeId
    ? _activeChallenges.find(ch => ch.id === challengeId)
    : _activeChallenges[0]
  if (!c || !c.ref_image_url) return
  // Build a single-image session with the challenge ref
  sessionEntries = [{ type: 'image', path: c.ref_image_url, category: 'Challenge', isR2: true }]
  currentIndex = 0; sessionLog = []; _challengeSession = true
  // imgCache gardé entre sessions (les URLs R2 ne changent pas, re-download inutile)
  mainMode = 'pose'; currentSubMode = 'class'
  closeEndConfirm()
  document.getElementById('controls').style.display = 'flex'
  showScreen('screen-session'); loadAndShow(0)
}

// ── Upload from Community tab ──
let _communityBlob = null

function openCommunityUpload() {
  const overlay = document.getElementById('community-upload-overlay')
  overlay.style.display = 'flex'
  document.getElementById('community-preview-img').style.display = 'none'
  document.getElementById('community-upload-actions').style.display = 'none'
  document.getElementById('community-upload-status').style.display = 'none'
  document.getElementById('community-upload-label').style.display = 'inline-flex'
  document.getElementById('community-file-input').value = ''
  _communityBlob = null
  // Show scan button on mobile only
  const scanBtn = document.getElementById('community-scan-btn')
  if (scanBtn) scanBtn.style.display = (_isMobile && (window.__isAndroid || window.__isIOS)) ? 'inline-flex' : 'none'
  const desc = document.querySelector('#community-upload-overlay .share-drawing-box p')
  if (desc && _activeChallenges.length) {
    desc.textContent = 'Challenge en cours : ' + _activeChallenges[0].title + ' — ton dessin sera inscrit !'
  } else if (desc) {
    desc.textContent = 'Prends en photo ton croquis pour le montrer à la communauté !'
  }
}

// ── Scan via document scanner plugin (iOS / Android) ──
async function scanCommunityDrawing() {
  if (!window.electronAPI?.scanDocument) { alert('Scan non disponible sur cet appareil.'); return }
  const res = await window.electronAPI.scanDocument()
  if (!res || !res.dataUrl) return
  // Load the scanned image into the existing flow
  const img = new Image()
  img.onload = function() {
    const canvas = document.createElement('canvas')
    const maxW = 1200
    let w = img.width, h = img.height
    if (w > maxW) { h = Math.round(h * maxW / w); w = maxW }
    canvas.width = w; canvas.height = h
    canvas.getContext('2d').drawImage(img, 0, 0, w, h)
    canvas.toBlob(function(blob) {
      _communityBlob = blob
      const preview = document.getElementById('community-preview-img')
      preview.src = URL.createObjectURL(blob)
      preview.style.display = 'block'
      document.getElementById('community-upload-label').style.display = 'none'
      document.getElementById('community-scan-btn').style.display = 'none'
      document.getElementById('community-upload-actions').style.display = 'flex'
    }, 'image/jpeg', 0.9)
  }
  img.src = res.dataUrl
}

async function scanShareDrawing() {
  if (!window.electronAPI?.scanDocument) { alert('Scan non disponible sur cet appareil.'); return }
  const res = await window.electronAPI.scanDocument()
  if (!res || !res.dataUrl) return
  const img = new Image()
  img.onload = function() {
    const canvas = document.createElement('canvas')
    const maxW = 1200
    let w = img.width, h = img.height
    if (w > maxW) { h = Math.round(h * maxW / w); w = maxW }
    canvas.width = w; canvas.height = h
    canvas.getContext('2d').drawImage(img, 0, 0, w, h)
    canvas.toBlob(function(blob) {
      _shareBlob = blob
      const preview = document.getElementById('share-preview-img')
      preview.src = URL.createObjectURL(blob)
      preview.style.display = 'block'
      document.getElementById('share-upload-label').style.display = 'none'
      document.getElementById('share-scan-btn').style.display = 'none'
      document.getElementById('share-actions').style.display = 'flex'
    }, 'image/jpeg', 0.9)
  }
  img.src = res.dataUrl
}

function closeCommunityUpload() {
  document.getElementById('community-upload-overlay').style.display = 'none'
}

function handleCommunityFile(input) {
  const file = input.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = function(e) {
    const img = new Image()
    img.onload = function() {
      const canvas = document.createElement('canvas')
      const maxW = 1200
      let w = img.width, h = img.height
      if (w > maxW) { h = Math.round(h * maxW / w); w = maxW }
      canvas.width = w; canvas.height = h
      canvas.getContext('2d').drawImage(img, 0, 0, w, h)
      canvas.toBlob(function(blob) {
        _communityBlob = blob
        const preview = document.getElementById('community-preview-img')
        preview.src = URL.createObjectURL(blob)
        preview.style.display = 'block'
        document.getElementById('community-upload-label').style.display = 'none'
        document.getElementById('community-upload-actions').style.display = 'flex'
      }, 'image/jpeg', 0.8)
    }
    img.src = e.target.result
  }
  reader.readAsDataURL(file)
}

function _blobToBase64(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result.split(',')[1])
    reader.readAsDataURL(blob)
  })
}
const _isMobile = !window.electronAPI?.pickFolder || typeof Capacitor !== 'undefined'
let _uploading = false

async function confirmCommunityUpload() {
  if (!_communityBlob || _uploading) return
  _uploading = true
  const status = document.getElementById('community-upload-status')
  status.style.display = 'block'
  status.style.color = '#6a8aaa'
  status.textContent = 'Envoi en cours...'
  document.getElementById('community-upload-actions').style.display = 'none'
  try {
    const postData = {
      refImageUrl: null,
      username: _communityUsername || (_communityEmail ? _communityEmail.split('@')[0] : 'anonyme'),
    }
    if (_isMobile) postData.imageBase64 = await _blobToBase64(_communityBlob)
    const res = await window.electronAPI.submitCommunityPost(postData)
    if (res.error) throw new Error(res.error)
    if (!res.uploaded && res.uploadUrl) {
      await fetch(res.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        body: _communityBlob,
      })
      // Desktop: run auto-moderation after upload
      if (res.needsModeration && res.postId) {
        status.textContent = 'Vérification du contenu...'
        const modRes = await window.electronAPI.moderateCommunityPost(res.postId)
        if (modRes && !modRes.ok) throw new Error(modRes.reason || 'Image refusée par la modération automatique.')
      }
    }
    if (_activeChallenges.length && res.postId) {
      try { await window.electronAPI.tagPostToChallenge(res.postId, _activeChallenges[0].id) } catch(e) {}
    }
    status.textContent = 'Publié !'
    status.style.color = '#2ecc71'
    _communityStats = null; checkBadges()
    setTimeout(() => { _uploading = false; closeCommunityUpload(); renderCommunity() }, 1500)
  } catch(e) {
    _uploading = false
    status.textContent = 'Erreur : ' + (e.message || 'échec')
    status.style.color = '#e74c3c'
    document.getElementById('community-upload-actions').style.display = 'flex'
  }
}

// ── Share drawing (Recap screen) ──
let _lastRefUrl = ''
let _activeChallenge = null
function setLastRefUrl(url) { _lastRefUrl = url }

// Ref de la pose sélectionnée par l'user pour le partage (étape "choisis
// la pose correspondant à ton dessin"). Reset à chaque nouveau partage.
let _selectedShareRef = null

// Ouvre le partage. Étape 1 : sélection de la pose de référence (parmi
// celles de la session qui vient de se terminer). Étape 2 : upload du
// dessin. Si un challenge est actif, on skip la sélection (la ref vient
// du challenge).
function openShareDrawing() {
  _selectedShareRef = null
  // Challenge actif → ref imposée par le challenge, on skip la sélection
  if (_activeChallenges.length) {
    _openShareUploadOverlay()
    return
  }
  // Sinon, on affiche le sélecteur de pose
  openSharePoseSelector()
}

// Étape 1 du partage : grille des poses de la session pour que l'user
// choisisse laquelle correspond à son dessin. On lit directement depuis
// #recap-grid (source unique, marche pour pose et anim sans différencier).
function openSharePoseSelector() {
  const recapItems = document.querySelectorAll('#recap-grid .recap-item')
  const poses = Array.from(recapItems)
    .map((item, i) => {
      const img = item.querySelector('img')
      // Frames cinema ont la classe cinema-frame (ratio 16/9), le reste
      // est en 3/4. On propage pour que la miniature de sélection garde
      // le bon format.
      const isCinema = item.classList.contains('cinema-frame')
      return { src: img ? img.src : '', index: i, isCinema }
    })
    .filter(p => p.src && !p.src.endsWith('#') && p.src !== window.location.href)

  // Pas de poses exploitables → passer direct à l'upload sans ref
  if (poses.length === 0) {
    _openShareUploadOverlay()
    return
  }

  let overlay = document.getElementById('share-pose-selector')
  if (overlay) overlay.remove()
  overlay = document.createElement('div')
  overlay.id = 'share-pose-selector'
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(5,10,18,0.9);z-index:1000;display:flex;align-items:center;justify-content:center;padding:24px;'

  const box = document.createElement('div')
  box.className = 'share-drawing-box'
  box.style.cssText = 'max-width:640px;width:100%;max-height:90vh;display:flex;flex-direction:column;gap:14px;padding:28px;overflow:hidden;'
  box.innerHTML =
    '<button class="share-close" id="sps-close" aria-label="Fermer">×</button>' +
    '<h3 style="margin:0;text-align:center;">Choisis la pose correspondante</h3>' +
    '<p style="margin:0;text-align:center;">Sélectionne la photo qui a servi de référence à ton dessin.</p>' +
    '<div id="sps-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;overflow-y:auto;padding:4px;"></div>' +
    '<button id="sps-skip" style="background:transparent;border:none;color:#6a8aaa;font-size:13px;cursor:pointer;padding:8px;text-decoration:underline;">Partager sans référence</button>'

  overlay.appendChild(box)
  document.body.appendChild(overlay)

  const grid = document.getElementById('sps-grid')
  poses.forEach(pose => {
    const item = document.createElement('div')
    const ratio = pose.isCinema ? '16/9' : '3/4'
    const label = pose.isCinema ? 'Frame ' : 'Pose '
    item.style.cssText = 'position:relative;aspect-ratio:' + ratio + ';background:#131f2e;border:1.5px solid transparent;border-radius:8px;overflow:hidden;cursor:pointer;transition:border-color 0.15s, transform 0.1s;'
    item.innerHTML = '<img src="' + pose.src + '" style="width:100%;height:100%;object-fit:cover;display:block;"><div style="position:absolute;bottom:4px;left:4px;background:rgba(10,21,32,0.85);border-radius:4px;padding:2px 6px;font-size:10px;color:#c8d6e5;">' + label + (pose.index + 1) + '</div>'
    item.onmouseover = () => { item.style.borderColor = '#2983eb'; item.style.transform = 'scale(1.02)' }
    item.onmouseout = () => { item.style.borderColor = 'transparent'; item.style.transform = 'none' }
    item.onclick = () => {
      _selectedShareRef = pose.src
      overlay.remove()
      _openShareUploadOverlay()
    }
    grid.appendChild(item)
  })

  document.getElementById('sps-close').onclick = () => overlay.remove()
  document.getElementById('sps-skip').onclick = () => {
    _selectedShareRef = null
    overlay.remove()
    _openShareUploadOverlay()
  }
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove() })
}

// Étape 2 : overlay d'upload du dessin (ancien corps de openShareDrawing).
function _openShareUploadOverlay() {
  document.getElementById('share-drawing-overlay').style.display = 'flex'
  document.getElementById('share-preview-img').style.display = 'none'
  document.getElementById('share-actions').style.display = 'none'
  document.getElementById('share-status').style.display = 'none'
  document.getElementById('share-upload-label').style.display = 'inline-flex'
  document.getElementById('share-file-input').value = ''
  // Show scan button on mobile only
  const scanBtn = document.getElementById('share-scan-btn')
  if (scanBtn) scanBtn.style.display = (_isMobile && (window.__isAndroid || window.__isIOS)) ? 'inline-flex' : 'none'
  // Update message if challenge is active
  const desc = document.querySelector('#share-drawing-overlay .share-drawing-box p')
  if (desc && _activeChallenges.length) {
    desc.textContent = 'Challenge en cours : ' + _activeChallenges[0].title + ' — ton dessin sera automatiquement inscrit !'
  } else if (desc) {
    desc.textContent = 'Prends en photo ton croquis pour le montrer à la communauté !'
  }
}

function closeShareDrawing() {
  document.getElementById('share-drawing-overlay').style.display = 'none'
}

let _shareBlob = null
function handleShareFile(input) {
  const file = input.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = function(e) {
    const img = new Image()
    img.onload = function() {
      // Compress: max 1200px, JPEG 80%
      const canvas = document.getElementById('share-preview-canvas')
      const maxW = 1200
      let w = img.width, h = img.height
      if (w > maxW) { h = Math.round(h * maxW / w); w = maxW }
      canvas.width = w; canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, w, h)
      canvas.toBlob(function(blob) {
        _shareBlob = blob
        const preview = document.getElementById('share-preview-img')
        preview.src = URL.createObjectURL(blob)
        preview.style.display = 'block'
        document.getElementById('share-upload-label').style.display = 'none'
        document.getElementById('share-actions').style.display = 'flex'
      }, 'image/jpeg', 0.8)
    }
    img.src = e.target.result
  }
  reader.readAsDataURL(file)
}

async function confirmShareDrawing() {
  if (!_shareBlob || _uploading) return
  _uploading = true
  const status = document.getElementById('share-status')
  status.style.display = 'block'
  status.textContent = 'Envoi en cours...'
  document.getElementById('share-actions').style.display = 'none'
  try {
    const postData = {
      // Priorité : pose choisie explicitement par l'user dans la modale
      // de sélection, sinon fallback sur _lastRefUrl (dernière pose vue).
      refImageUrl: _selectedShareRef || _lastRefUrl || null,
      username: _communityUsername || (_communityEmail ? _communityEmail.split('@')[0] : 'anonyme'),
    }
    if (_isMobile) postData.imageBase64 = await _blobToBase64(_shareBlob)
    const res = await window.electronAPI.submitCommunityPost(postData)
    if (res.error) throw new Error(res.error)
    if (!res.uploaded && res.uploadUrl) {
      await fetch(res.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        body: _shareBlob,
      })
      // Desktop: run auto-moderation after upload
      if (res.needsModeration && res.postId) {
        status.textContent = 'Vérification du contenu...'
        const modRes = await window.electronAPI.moderateCommunityPost(res.postId)
        if (modRes && !modRes.ok) throw new Error(modRes.reason || 'Image refusée par la modération automatique.')
      }
    }
    if (_activeChallenges.length && res.postId) {
      try { await window.electronAPI.tagPostToChallenge(res.postId, _activeChallenges[0].id) } catch(e) { /* silent */ }
    }
    status.textContent = 'Publié ! Ton dessin est visible dans la Communauté.'
    status.style.color = '#2ecc71'
    _communityStats = null; checkBadges()
    setTimeout(() => { _uploading = false; closeShareDrawing() }, 2000)
  } catch(e) {
    _uploading = false
    status.textContent = 'Erreur : ' + (e.message || 'échec upload')
    status.style.color = '#e74c3c'
    document.getElementById('share-actions').style.display = 'flex'
  }
}

// ── Community compare view (clic sur un post community) ──
let _ccCurrentPost = null

function openCommunityCompare(post) {
  if (!post) return
  _ccCurrentPost = post
  const overlay = document.getElementById('community-compare')
  if (!overlay) return
  const drawingUrl = post.image_url || post.media_url
  const refUrl = post.ref_image_url
  document.getElementById('cc-drawing').src = drawingUrl || ''
  const refImg = document.getElementById('cc-ref')
  const refWrap = document.getElementById('cc-ref-wrap')
  if (refUrl) {
    refImg.src = refUrl
    refWrap.style.display = ''
    overlay.classList.remove('cc-single')
  } else {
    refImg.src = ''
    refWrap.style.display = 'none'
    overlay.classList.add('cc-single')
  }
  document.getElementById('cc-user').textContent = post.username || 'anonyme'
  document.getElementById('cc-date').textContent = formatPostDate(post.timestamp || post.created_at)
  // Reactions (visual only, clickable to toggle)
  const reactionsEl = document.getElementById('cc-reactions')
  reactionsEl.innerHTML = ''
  reactionsEl.dataset.post = post.id
  const mine = myReactions[post.id] || []
  const counts = reactionsCache[post.id] || {}
  COMMUNITY_EMOJIS.forEach(em => {
    const btn = document.createElement('button')
    const count = counts[em] || 0
    btn.className = 'community-reaction-btn' + (mine.includes(em) ? ' active' : '')
    btn.dataset.emoji = em
    btn.innerHTML = em + '<span class="count">' + (count || '') + '</span>'
    btn.onclick = () => toggleReaction(post.id, em)
    reactionsEl.appendChild(btn)
  })
  // Show/hide draw button based on ref availability
  document.getElementById('cc-draw-btn').style.display = refUrl ? 'block' : 'none'
  overlay.style.display = 'flex'
  document.addEventListener('keydown', _ccEscHandler)
}

function closeCommunityCompare() {
  const overlay = document.getElementById('community-compare')
  if (overlay) overlay.style.display = 'none'
  document.removeEventListener('keydown', _ccEscHandler)
  _ccCurrentPost = null
}

function _ccEscHandler(e) { if (e.key === 'Escape') closeCommunityCompare() }

function drawFromRefUrl(refUrl) {
  if (!refUrl) return
  // Same pattern as participateChallenge: single-image session with the ref
  sessionEntries = [{ type: 'image', path: refUrl, category: 'Communauté', isR2: true }]
  currentIndex = 0; sessionLog = []; _challengeSession = true
  // imgCache gardé entre sessions (les URLs R2 ne changent pas, re-download inutile)
  mainMode = 'pose'; currentSubMode = 'class'
  closeEndConfirm()
  document.getElementById('controls').style.display = 'flex'
  showScreen('screen-session'); loadAndShow(0)
}

function drawFromCompare() {
  if (!_ccCurrentPost || !_ccCurrentPost.ref_image_url) return
  const refUrl = _ccCurrentPost.ref_image_url
  closeCommunityCompare()
  drawFromRefUrl(refUrl)
}

async function shareFromCompare() {
  if (!_ccCurrentPost) return
  const btn = document.getElementById('cc-share-btn')
  const origText = btn.textContent
  btn.textContent = '⏳ Chargement...'
  btn.disabled = true

  const imgUrl = _ccCurrentPost.image_url
  const shareText = 'Dessin réalisé avec Gesturo ✏️ gesturo.art\n#gesturo #gesturedrawing #art #sketch'

  try {
    if (window.electronAPI?.shareImage) {
      const res = await window.electronAPI.shareImage({ imageUrl: imgUrl, text: shareText })
      if (res.ok) {
        btn.textContent = '✅ Partagé !'
        setTimeout(() => { btn.textContent = origText; btn.disabled = false }, 2000)
        return
      }
      if (res.error) {
        btn.textContent = '❌ ' + res.error
        setTimeout(() => { btn.textContent = origText; btn.disabled = false }, 4000)
        return
      }
    } else {
      await navigator.clipboard?.writeText(shareText)
      showAlertModal('Texte copié ! Enregistre l\'image et colle le texte sur Instagram.')
    }
  } catch (e) {
    btn.textContent = '❌ Erreur'
    setTimeout(() => { btn.textContent = origText; btn.disabled = false }, 3000)
    return
  }

  btn.textContent = origText
  btn.disabled = false
}

function buildPostCard(post, i) {
  const card = document.createElement('div')
  card.className = 'community-post'
  card.style.animationDelay = (i * 60) + 'ms'

  // Image
  const img = document.createElement('img')
  img.className = 'community-post-img'
  img.src = post.image_url || post.media_url
  img.alt = post.username || 'Post'
  img.loading = 'lazy'
  if (post.source === 'community') {
    img.onclick = () => openCommunityCompare(post)
  } else if (post.permalink) {
    img.onclick = () => window.electronAPI.openExternal(post.permalink)
  }
  card.appendChild(img)

  // Badge
  if (post.source === 'tagged' || post.source === 'community') {
    const badge = document.createElement('div')
    badge.className = 'community-post-badge'
    badge.textContent = post.source === 'community' ? 'Dessin' : 'Communauté'
    card.appendChild(badge)
  }

  // Info bar
  const info = document.createElement('div')
  info.className = 'community-post-info'

  const header = document.createElement('div')
  header.className = 'community-post-header'

  const user = document.createElement('span')
  user.className = 'community-post-user'
  user.textContent = post.source === 'community' ? (post.username || 'anonyme') : ('@' + (post.username || 'gesturo.art'))
  if (post.permalink) user.onclick = () => window.electronAPI.openExternal('https://www.instagram.com/' + (post.username || 'gesturo.art'))

  const date = document.createElement('span')
  date.className = 'community-post-date'
  date.textContent = formatPostDate(post.timestamp || post.created_at)

  header.appendChild(user)
  header.appendChild(date)
  info.appendChild(header)

  // Likes (IG only)
  if (post.like_count !== undefined) {
    const likes = document.createElement('div')
    likes.className = 'community-post-likes'
    likes.textContent = '❤️ ' + (post.like_count || 0)
    info.appendChild(likes)
  }

  card.appendChild(info)

  // Ref image + "Dessiner cette ref" (community posts only)
  if (post.source === 'community' && post.ref_image_url) {
    const refRow = document.createElement('div')
    refRow.className = 'community-post-ref'
    const refThumb = document.createElement('img')
    refThumb.src = post.ref_image_url
    refThumb.alt = 'Ref'
    refThumb.className = 'community-ref-thumb'
    refRow.appendChild(refThumb)
    const refLabel = document.createElement('span')
    refLabel.className = 'community-ref-label'
    refLabel.textContent = 'Réf utilisée'
    refRow.appendChild(refLabel)
    const refBtn = document.createElement('button')
    refBtn.className = 'community-ref-btn'
    refBtn.textContent = 'Dessiner cette ref'
    refBtn.onclick = (e) => { e.stopPropagation(); drawFromRefUrl(post.ref_image_url) }
    refRow.appendChild(refBtn)
    card.appendChild(refRow)
  }

  // Emoji reactions
  const reactions = document.createElement('div')
  reactions.className = 'community-reactions'
  reactions.dataset.post = post.id
  const mine = myReactions[post.id] || []
  const counts = reactionsCache[post.id] || {}
  const users = reactionUsers[post.id] || {}
  COMMUNITY_EMOJIS.forEach(em => {
    const btn = document.createElement('button')
    const count = counts[em] || 0
    btn.className = 'community-reaction-btn' + (mine.includes(em) ? ' active' : '')
    btn.dataset.emoji = em
    btn.innerHTML = em + '<span class="count">' + (count || '') + '</span>'
    const names = users[em] || []
    if (count > 0 && names.length > 0) {
      const tooltip = document.createElement('span')
      tooltip.className = 'reaction-tooltip'
      tooltip.textContent = names.slice(0, 8).join(', ') + (names.length > 8 ? '…' : '')
      btn.appendChild(tooltip)
    }
    btn.onclick = () => toggleReaction(post.id, em)
    reactions.appendChild(btn)
  })
  card.appendChild(reactions)

  return card
}

let _communityToken = 0
async function renderCommunity() {
  const token = ++_communityToken
  const feed = document.getElementById('community-feed')
  const empty = document.getElementById('community-empty')
  feed.innerHTML = ''; empty.style.display = 'block'; empty.textContent = 'Chargement...'
  try {
    // Fetch IG posts + community posts + challenges in parallel
    const [igPosts, communityRes] = await Promise.all([
      window.electronAPI.getInstagramPosts().catch(() => []),
      window.electronAPI.getCommunityPosts().catch(() => ({ posts: [] })),
    ])
    if (token !== _communityToken) return

    // Load challenges (once, cached in _activeChallenges)
    // If none exist, trigger daily-challenge to auto-create one
    if (!_activeChallenges.length) {
      await loadChallenges()
      if (!_activeChallenges.length) {
        try { await triggerDailyChallenge(); await loadChallenges() } catch(e) { /* silent */ }
      }
    }
    if (token !== _communityToken) return

    empty.style.display = 'none'

    // Normalize IG posts
    const allPosts = []
    const seen = new Set()
    ;(igPosts || []).forEach(post => {
      if (post.media_type !== 'IMAGE' && post.media_type !== 'CAROUSEL_ALBUM') return
      if (seen.has(post.id)) return; seen.add(post.id)
      allPosts.push({ ...post, _sort: new Date(post.timestamp).getTime() })
    })

    // Normalize community posts
    ;(communityRes.posts || []).forEach(post => {
      allPosts.push({
        id: post.id,
        image_url: post.image_url,
        username: post.username,
        created_at: post.created_at,
        ref_image_url: post.ref_image_url,
        challenge_id: post.challenge_id || null,
        source: 'community',
        _sort: new Date(post.created_at).getTime(),
      })
    })

    // Update participants count in banner
    updateChallengeParticipants(allPosts)

    // Filter by challenge if selected
    let filtered = allPosts
    const hero = document.getElementById('challenge-hero')
    if (_selectedChallengeFilter) {
      filtered = allPosts.filter(p => p.challenge_id === _selectedChallengeFilter)
      const ch = _activeChallenges.find(c => c.id === _selectedChallengeFilter)
      if (ch && hero) {
        hero.style.display = ''
        hero.innerHTML = '<div class="challenge-hero-card">'
          + '<img class="challenge-hero-img" src="' + ch.ref_image_url + '" alt="Ref">'
          + '<div class="challenge-hero-overlay">'
          + '<div class="challenge-label">CHALLENGE</div>'
          + '<h2>' + ch.title + '</h2>'
          + '<div class="challenge-hero-count">' + filtered.length + ' dessin' + (filtered.length > 1 ? 's' : '') + '</div>'
          + '</div></div>'
      }
    } else if (hero) {
      hero.style.display = 'none'
      hero.innerHTML = ''
    }

    if (filtered.length === 0) { empty.style.display = 'block'; empty.textContent = _selectedChallengeFilter ? 'Aucun dessin pour ce challenge.' : 'Aucune photo pour le moment.'; return }

    // Sort by date descending
    filtered.sort((a, b) => b._sort - a._sort)

    // Load reactions
    await loadReactions(filtered.map(p => p.id))
    if (token !== _communityToken) return
    feed.innerHTML = ''

    // If active challenge and no filter, split into challenge/other sections
    const activeChId = !_selectedChallengeFilter && _activeChallenges.length ? _activeChallenges[0].id : null
    if (activeChId) {
      const challengePosts = filtered.filter(p => p.challenge_id === activeChId)
      const otherPosts = filtered.filter(p => p.challenge_id !== activeChId)
      let idx = 0
      if (challengePosts.length) {
        const sep1 = document.createElement('div')
        sep1.className = 'feed-separator'
        sep1.innerHTML = '<span>Dessins du challenge · ' + challengePosts.length + ' participant' + (challengePosts.length > 1 ? 's' : '') + '</span>'
        feed.appendChild(sep1)
        challengePosts.forEach(p => feed.appendChild(buildPostCard(p, idx++)))
      }
      if (otherPosts.length) {
        const sep2 = document.createElement('div')
        sep2.className = 'feed-separator'
        sep2.innerHTML = '<span>Autres dessins</span>'
        feed.appendChild(sep2)
        otherPosts.forEach(p => feed.appendChild(buildPostCard(p, idx++)))
      }
    } else {
      filtered.forEach((post, i) => feed.appendChild(buildPostCard(post, i)))
    }
  } catch(e) {
    if (token !== _communityToken) return
    empty.style.display = 'block'; empty.textContent = 'Erreur de chargement.'
  }
}

let communityInterval = null
let _countdownInterval = null
let _communityTab = 'feed'

function startCommunityRefresh() {
  if (communityInterval) clearInterval(communityInterval)
  communityInterval = setInterval(() => { if (mainMode === 'community') { if (_communityTab === 'feed') renderCommunity() } }, 60 * 1000)
  // Live countdown update every second
  if (_countdownInterval) clearInterval(_countdownInterval)
  _countdownInterval = setInterval(updateChallengeCountdown, 1000)
}

function switchCommunityTab(tab) {
  // Re-clic sur le tab déjà actif → refresh la vue (comme Instagram / Twitter).
  // Sinon (1er clic sur un autre tab) : switch normal.
  if (_communityTab === tab) {
    if (tab === 'feed') renderCommunity()
    else if (tab === 'mine') renderMyPosts()
    else if (tab === 'leaderboard') renderLeaderboard()
    return
  }
  _communityTab = tab
  document.getElementById('ctab-feed').classList.toggle('active', tab === 'feed')
  document.getElementById('ctab-mine').classList.toggle('active', tab === 'mine')
  document.getElementById('ctab-leaderboard').classList.toggle('active', tab === 'leaderboard')
  document.getElementById('community-feed').style.display = tab === 'feed' ? '' : 'none'
  document.getElementById('community-mine').style.display = tab === 'mine' ? '' : 'none'
  document.getElementById('community-leaderboard').style.display = tab === 'leaderboard' ? '' : 'none'
  document.getElementById('community-empty').style.display = 'none'
  if (tab === 'feed') renderCommunity()
  else if (tab === 'mine') renderMyPosts()
  else if (tab === 'leaderboard') renderLeaderboard()
}

let _myPostsToken = 0
async function renderMyPosts() {
  const token = ++_myPostsToken
  const grid = document.getElementById('community-mine')
  const empty = document.getElementById('community-empty')
  const oldStats = grid.parentNode.querySelector('.my-posts-stats')
  if (oldStats) oldStats.remove()
  grid.innerHTML = ''; empty.style.display = 'block'; empty.textContent = 'Chargement...'
  try {
    const res = await window.electronAPI.getCommunityPosts()
    if (token !== _myPostsToken) return
    const myPosts = (res.posts || []).filter(p => p.user_email === _communityEmail)
    empty.style.display = 'none'
    if (myPosts.length === 0) {
      grid.innerHTML = '<div class="mine-empty">Tu n\'as pas encore partage de dessin.<br>Fais une session et partage depuis le Recap !</div>'
      return
    }

    await loadReactions(myPosts.map(p => p.id))
    if (token !== _myPostsToken) return
    grid.innerHTML = ''
    const existingStats = grid.parentNode.querySelector('.my-posts-stats')
    if (existingStats) existingStats.remove()

    // Stats header
    let totalReactions = 0
    myPosts.forEach(p => {
      const counts = reactionsCache[p.id] || {}
      Object.values(counts).forEach(c => { totalReactions += c })
    })
    const statsEl = document.createElement('div')
    statsEl.className = 'my-posts-stats'
    statsEl.innerHTML = '<span>📝 ' + myPosts.length + ' dessin' + (myPosts.length > 1 ? 's' : '') + '</span>'
      + '<span>💬 ' + totalReactions + ' reaction' + (totalReactions > 1 ? 's' : '') + ' reçue' + (totalReactions > 1 ? 's' : '') + '</span>'
    grid.parentNode.insertBefore(statsEl, grid)

    myPosts.forEach((post, i) => {
      const card = buildPostCard({
        id: post.id,
        image_url: post.image_url,
        username: post.username,
        created_at: post.created_at,
        source: 'community',
      }, i)

      // Add delete button
      const del = document.createElement('button')
      del.className = 'community-post-delete'
      del.textContent = '×'
      del.title = 'Supprimer'
      del.onclick = (e) => {
        e.stopPropagation()
        showConfirmModal('Supprimer ce dessin ?', async () => {
          try {
            await window.electronAPI.deleteCommunityPost(post.id)
            renderMyPosts()
          } catch(err) { /* silent */ }
        }, { confirmText: 'Supprimer', danger: true })
      }
      card.appendChild(del)

      grid.appendChild(card)
    })
  } catch(e) {
    if (token !== _myPostsToken) return
    empty.style.display = 'block'; empty.textContent = 'Erreur de chargement.'
  }
}

const LEADERBOARD_MEDALS = ['🥇', '🥈', '🥉']

let _leaderboardToken = 0
async function renderLeaderboard() {
  const token = ++_leaderboardToken
  const container = document.getElementById('community-leaderboard')
  const empty = document.getElementById('community-empty')
  container.innerHTML = ''; empty.style.display = 'block'; empty.textContent = 'Chargement...'
  try {
    const res = await window.electronAPI.getCommunityLeaderboard()
    // Race guard : si un autre renderLeaderboard a été lancé entre temps, on abandonne
    if (token !== _leaderboardToken) return
    const rawList = res.leaderboard || []
    // Dédupe défensif par username (ceinture + bretelles)
    const seen = new Set()
    const list = rawList.filter(e => {
      const key = (e.username || '').toLowerCase()
      if (!key || seen.has(key)) return false
      seen.add(key); return true
    })
    empty.style.display = 'none'
    if (list.length === 0) {
      container.innerHTML = '<div class="mine-empty">Pas encore de classement.<br>Partage tes dessins pour apparaitre ici !</div>'
      return
    }
    const table = document.createElement('div')
    table.className = 'leaderboard-list'
    list.forEach((entry, i) => {
      const row = document.createElement('div')
      row.className = 'leaderboard-row' + (i < 3 ? ' leaderboard-top' : '')
      row.style.animationDelay = (i * 50) + 'ms'

      const rank = document.createElement('span')
      rank.className = 'leaderboard-rank'
      rank.textContent = i < 3 ? LEADERBOARD_MEDALS[i] : '#' + (i + 1)

      const name = document.createElement('span')
      name.className = 'leaderboard-name'
      name.textContent = entry.username

      const stats = document.createElement('span')
      stats.className = 'leaderboard-stats'
      stats.innerHTML = '<span class="lb-posts">' + entry.posts + ' post' + (entry.posts > 1 ? 's' : '') + '</span>'
        + '<span class="lb-reactions">' + entry.reactions + ' reaction' + (entry.reactions > 1 ? 's' : '') + '</span>'

      row.appendChild(rank)
      row.appendChild(name)
      row.appendChild(stats)
      table.appendChild(row)
    })
    // Dernière vérif avant append : race guard
    if (token !== _leaderboardToken) return
    container.innerHTML = ''
    container.appendChild(table)
  } catch(e) {
    if (token !== _leaderboardToken) return
    empty.style.display = 'block'; empty.textContent = 'Erreur de chargement.'
  }
}

function selectSubMode(mode) {
  currentSubMode = mode
  document.querySelectorAll('.sub-mode-card').forEach(c => c.classList.remove('selected'))
  document.querySelector('[data-mode="' + mode + '"]').classList.add('selected')
  document.getElementById('custom-mode-options').style.display = mode === 'custom' ? 'block' : 'none'
  document.getElementById('custom-count-options').style.display = mode === 'custom' ? 'block' : 'none'
}

document.getElementById('chips').addEventListener('click', function(e) {
  const chip = e.target.closest('.chip'); if (!chip) return
  document.querySelectorAll('#chips .chip').forEach(c => c.classList.remove('selected'))
  chip.classList.add('selected')
  document.getElementById('custom-row').style.display = chip.dataset.val === 'custom' ? 'flex' : 'none'
})

document.getElementById('study-chips').addEventListener('click', function(e) {
  const chip = e.target.closest('.chip'); if (!chip) return
  document.querySelectorAll('#study-chips .chip').forEach(c => c.classList.remove('selected'))
  chip.classList.add('selected')
  document.getElementById('study-custom-row').style.display = chip.dataset.val === 'custom-study' ? 'flex' : 'none'
})

function updateFps() { document.getElementById('fps-val').textContent = document.getElementById('fps-slider').value + ' fps' }
function getSelectedDuration() { const chip = document.querySelector('#chips .chip.selected'); if (!chip) return 30; if (chip.dataset.val === 'custom') return Math.max(5, parseInt(document.getElementById('custom-sec').value) || 30); return parseInt(chip.dataset.val) }
function getStudyDuration() { const chip = document.querySelector('#study-chips .chip.selected'); if (!chip) return 30; if (chip.dataset.val === 'custom-study') return Math.max(5, parseInt(document.getElementById('study-custom-sec').value) || 30); return parseInt(chip.dataset.val) }

// ══ DÉMARRER SESSION ══
async function startSession() {
  if (mainMode === 'anim') { startAnimSession(); return }
  const pending = allEntries.filter(e => e.type === 'pdf-pending')
  for (const e of pending) {
    try {
      const buf = await window.electronAPI.readFileAsBuffer(e.path)
      const pdfDoc = await pdfjsLib.getDocument({ data: buf }).promise
      const pages = []
      for (let p = 1; p <= pdfDoc.numPages; p++) pages.push({ type: 'pdf', path: e.path, category: e.category, pageNum: p, pdfDoc })
      const ai = allEntries.indexOf(e); if (ai !== -1) allEntries.splice(ai, 1, ...pages)
      if (categories[e.category]) { const ci = categories[e.category].indexOf(e); if (ci !== -1) categories[e.category].splice(ci, 1, ...pages) }
    } catch(err) {  }
  }
  let pool = allEntries.filter(e => {
    if (selectedCats.has(e.category)) return true
    if (e.subcategory && selectedCats.has(e.category + '/' + e.subcategory)) return true
    return false
  })
  if (pool.length === 0) { showAlertModal('Sélectionne au moins une catégorie pour démarrer.'); return }
  let imgPool = pool.filter(e => e.type === 'image')
  const pdfPool = pool.filter(e => e.type === 'pdf-pending' || e.type === 'pdf')
  pool = [...imgPool, ...pdfPool]; pool.sort(() => Math.random() - 0.5)
  let total
  if (currentSubMode === 'progressive') {
    progressiveQueue = []
    for (const ph of PROGRESSIVE_PHASES) for (let i = 0; i < ph.count; i++) progressiveQueue.push(ph.duration)
    total = progressiveQueue.length
  } else {
    total = Math.max(1, parseInt(document.getElementById('session-count').value) || 10)
    progressiveQueue = []
  }
  sessionEntries = pool.slice(0, Math.min(total, pool.length))
  while (sessionEntries.length < total) sessionEntries = [...sessionEntries, ...pool].slice(0, total)
  const pendingInSession = sessionEntries.filter(e => e.type === 'pdf-pending')
  if (pendingInSession.length > 0) {
    document.getElementById('session-info').textContent = 'Chargement des PDF...'
    showScreen('screen-session')
    const resolved = []
    for (const e of pendingInSession) {
      try {
        const buf = await window.electronAPI.readFileAsBuffer(e.path)
        const pdfDoc = await pdfjsLib.getDocument({ data: buf }).promise
        const pages = []
        for (let p = 1; p <= pdfDoc.numPages; p++) pages.push({ type: 'pdf', path: e.path, category: e.category, pageNum: p, pdfDoc })
        resolved.push({ original: e, pages })
        const ai = allEntries.indexOf(e); if (ai !== -1) allEntries.splice(ai, 1, ...pages)
        const ci = categories[e.category]?.indexOf(e); if (ci !== -1 && ci !== undefined) categories[e.category].splice(ci, 1, ...pages)
      } catch(err) {  }
    }
    for (const { original, pages } of resolved) {
      const si = sessionEntries.indexOf(original); if (si !== -1) sessionEntries.splice(si, 1, pages[0])
    }
  }
  currentIndex = 0; sessionLog = []
  // imgCache gardé entre sessions (les URLs R2 ne changent pas, re-download inutile)
  if (_bgPreloadTimer) { clearTimeout(_bgPreloadTimer); _bgPreloadTimer = null }
  _bgPreloadIdx = 0
  closeEndConfirm()
  document.getElementById('controls').style.display = 'flex'
  showScreen('screen-session')
  document.getElementById('photo-placeholder').style.display = 'block'
  document.getElementById('photo-placeholder').textContent = 'Préparation...'
  document.getElementById('photo-img').style.display = 'none'
  await preloadInitial()
  startBackgroundPreload()
  loadAndShow(0)
}

// ══ POSE : AFFICHAGE ══
const imgCache = new Map()
const IMG_CACHE_MAX = 100
const IMG_PRELOAD_INITIAL = 30
const IMG_PRELOAD_BATCH = 20
let _bgPreloadIdx = 0
let _bgPreloadTimer = null

async function getImageSrc(entry) { if (entry.isR2) return entry.path; return 'file://' + entry.path }

function preloadOneImage(entry) {
  return new Promise((resolve) => {
    if (!entry || entry.type === 'pdf') { resolve(); return }
    const key = entry.path
    if (imgCache.has(key)) { resolve(); return }
    if (entry.isR2) {
      const im = new Image()
      im.onload = () => { imgCache.set(key, entry.path); if (imgCache.size > IMG_CACHE_MAX) { imgCache.delete(imgCache.keys().next().value) } resolve() }
      im.onerror = () => resolve()
      im.src = entry.path
    } else {
      window.electronAPI.readFileAsBase64(entry.path)
        .then(dataUrl => { imgCache.set(key, dataUrl); if (imgCache.size > IMG_CACHE_MAX) { imgCache.delete(imgCache.keys().next().value) } resolve() })
        .catch(() => resolve())
    }
  })
}

async function preloadInitial() {
  const count = Math.min(IMG_PRELOAD_INITIAL, sessionEntries.length)
  const promises = []
  for (let i = 0; i < count; i++) promises.push(preloadOneImage(sessionEntries[i]))
  await Promise.all(promises)
  _bgPreloadIdx = count
}

function startBackgroundPreload() {
  if (_bgPreloadTimer) clearTimeout(_bgPreloadTimer)
  _bgPreloadTimer = null
  if (_bgPreloadIdx >= sessionEntries.length) return
  const end = Math.min(_bgPreloadIdx + IMG_PRELOAD_BATCH, sessionEntries.length)
  const promises = []
  for (let i = _bgPreloadIdx; i < end; i++) promises.push(preloadOneImage(sessionEntries[i]))
  _bgPreloadIdx = end
  Promise.all(promises).then(() => {
    if (_bgPreloadIdx < sessionEntries.length) _bgPreloadTimer = setTimeout(startBackgroundPreload, 500)
  })
}

function preloadNext(idx) {
  for (let k = 1; k <= 3; k++) preloadOneImage(sessionEntries[idx + k])
}

async function loadAndShow(idx) {
  clearInterval(ticker); ticker = null; loading = true
  document.getElementById('btn-pause').disabled = true
  document.getElementById('btn-next').disabled = true
  document.getElementById('btn-prev').disabled = idx === 0
  document.getElementById('timer-display').textContent = '--:--'
  document.getElementById('timer-display').className = ''
  document.getElementById('prog-bar').style.transition = 'none'
  document.getElementById('prog-bar').style.width = '100%'
  const arcR = document.getElementById('countdown-arc')
  if (arcR) { arcR.style.transition = 'none'; arcR.style.strokeDashoffset = '0'; arcR.className = 'arc' }
  document.getElementById('session-info').textContent = 'Pose ' + (idx + 1) + ' / ' + sessionEntries.length
  closeEndConfirm()
  document.getElementById('controls').style.display = 'flex'
  const badge = document.getElementById('phase-badge')
  if (currentSubMode === 'progressive' && progressiveQueue[idx] !== undefined) {
    const ph = PROGRESSIVE_PHASES.find(p => p.duration === progressiveQueue[idx])
    badge.textContent = ph ? ph.label : ''; badge.style.display = 'block'
  } else { badge.style.display = 'none' }
  const entry = sessionEntries[idx]
  const img = document.getElementById('photo-img'), canvas = document.getElementById('pdf-canvas')
  const ph = document.getElementById('photo-placeholder')
  img.style.display = 'none'; canvas.style.display = 'none'; ph.style.display = 'block'; ph.textContent = 'Chargement...'
  try {
    if (entry.type === 'pdf') {
      const page = await entry.pdfDoc.getPage(entry.pageNum)
      const vp0 = page.getViewport({ scale: 1 })
      const area = document.getElementById('photo-area')
      const scale = Math.min(area.clientWidth / vp0.width, area.clientHeight / vp0.height) * 0.98
      const vp = page.getViewport({ scale })
      canvas.width = vp.width; canvas.height = vp.height
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise
      ph.style.display = 'none'; canvas.style.display = 'block'; onPoseReady(entry)
    } else {
      const dataUrl = await getImageSrc(entry)
      img.onload = () => { if (loading) { ph.style.display = 'none'; img.style.display = 'block'; onPoseReady(entry) } }
      img.onerror = () => {
        if (!loading) return
        // Image introuvable (404) — skip auto vers la suivante
        if (idx + 1 < sessionEntries.length) { loading = false; loadAndShow(idx + 1); return }
        ph.textContent = 'Image introuvable'; onPoseReady(entry)
      }
      img.src = dataUrl
    }
    preloadNext(idx)
  } catch(err) { ph.textContent = 'Erreur : ' + (err.message || err); onPoseReady(entry) }
}

function onPoseReady(entry) {
  loading = false
  document.getElementById('btn-pause').disabled = false
  currentRotation = flipModeEnabled ? 180 : 0; currentFlipH = false
  requestAnimationFrame(() => applyTransform()); resetGrid()
  if (_challengeSession) {
    // Challenge = durée illimitée, pas de timer
    timerDuration = 0
    logPoseEntry(entry, 0)
    document.getElementById('btn-next').disabled = true
    document.getElementById('btn-pause').disabled = true
    document.getElementById('timer-display').textContent = '∞'
    document.getElementById('timer-display').className = ''
    document.getElementById('prog-wrap').style.display = 'none'
    document.getElementById('countdown-circle').style.display = 'none'
    document.getElementById('mode-label').textContent = 'Challenge — prends ton temps'
    updatePoseStarBtn()
    return
  }
  timerDuration = currentSubMode === 'progressive' && progressiveQueue[currentIndex] ? progressiveQueue[currentIndex] : getSelectedDuration()
  logPoseEntry(entry, timerDuration)
  document.getElementById('btn-next').disabled = false
  document.getElementById('prog-wrap').style.display = ''
  document.getElementById('countdown-circle').style.display = ''
  timeLeft = timerDuration; paused = false
  document.getElementById('btn-pause').textContent = 'Pause'
  const d = timerDuration
  document.getElementById('mode-label').textContent = d < 60 ? d + ' sec' : (d / 60) + ' min'
  document.getElementById('prog-bar').style.transition = 'width 0.8s linear'
  const arcEl = document.getElementById('countdown-arc')
  if (arcEl) arcEl.style.transition = 'stroke-dashoffset 0.85s linear, stroke 0.3s'
  updateTimerUI(); ticker = setInterval(tick, 1000)
  updatePoseStarBtn()
}

function logPoseEntry(entry, duration) {
  if (sessionLog[currentIndex]) return
  const img = document.getElementById('photo-img'), canvas = document.getElementById('pdf-canvas')
  let thumb = null
  if (entry.type === 'pdf' && canvas.style.display !== 'none') thumb = { data: canvas.toDataURL('image/jpeg', 1) }
  else thumb = { data: entry.isR2 ? entry.path : 'file://' + entry.path }
  sessionLog[currentIndex] = { entry, duration, thumbnail: thumb, rotation: currentRotation, flipH: currentFlipH }
}

// ══ POSE : TIMER ══
function tick() {
  if (paused || loading) return
  timeLeft = Math.max(0, timeLeft - 1); updateTimerUI()
  if (timeLeft === 5) soundWarning()
  if (timeLeft === 0) { soundNext(); advance() }
}
function updateTimerUI() {
  const m = Math.floor(timeLeft / 60), s = timeLeft % 60
  const el = document.getElementById('timer-display')
  el.textContent = m + ':' + String(s).padStart(2, '0')
  const warning = timeLeft <= 5 && timeLeft > 0
  el.className = warning ? 'warning' : ''
  const pct = timerDuration > 0 ? Math.round((timeLeft / timerDuration) * 100) : 0
  document.getElementById('prog-bar').style.width = pct + '%'
  const arc = document.getElementById('countdown-arc')
  if (arc) {
    arc.style.strokeDashoffset = timerDuration > 0 ? 125.66 * (1 - timeLeft / timerDuration) : 0
    arc.className = 'arc' + (warning ? ' warning' : '')
  }
}
function togglePause() { paused = !paused; document.getElementById('btn-pause').textContent = paused ? 'Reprendre' : 'Pause' }
function nextPhoto() { advance() }
function prevPhoto() { if (currentIndex === 0) return; clearInterval(ticker); ticker = null; currentIndex--; loadAndShow(currentIndex) }
function advance() { clearInterval(ticker); ticker = null; currentIndex++; if (currentIndex >= sessionEntries.length) { finishSession(); return }; loadAndShow(currentIndex) }
function askEnd() { paused = true; document.getElementById('btn-pause').textContent = 'Reprendre'; openEndConfirm('pose') }

// ── Modale commune "Terminer la session ?" ──
let _endConfirmMode = null
function openEndConfirm(mode) {
  _endConfirmMode = mode
  document.getElementById('end-confirm-modal').classList.add('open')
}
function closeEndConfirm() {
  document.getElementById('end-confirm-modal').classList.remove('open')
  _endConfirmMode = null
}
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('end-confirm-yes').addEventListener('click', () => {
    const mode = _endConfirmMode
    closeEndConfirm()
    if (mode === 'pose') finishSession()
    else if (mode === 'anim') askEndAnim()
    else if (mode === 'cinema') endCinemaSession()
  })
  document.getElementById('end-confirm-cancel').addEventListener('click', () => {
    const wasPose = _endConfirmMode === 'pose'
    closeEndConfirm()
    if (wasPose) { paused = false; document.getElementById('btn-pause').textContent = 'Pause' }
  })
})

// ══ ANIMATION SESSION ══
let animLoopCount = 0
let currentAnimMode = 'mix'

function selectAnimMode(mode) {
  currentAnimMode = mode
  document.querySelectorAll('[data-amode]').forEach(c => c.classList.remove('selected'))
  document.querySelector('[data-amode="' + mode + '"]').classList.add('selected')
  document.getElementById('mix-loops-card').style.display = mode === 'mix' ? 'block' : 'none'
}

let loopCountVal = 3
function changeLoops(delta) { loopCountVal = Math.min(10, Math.max(1, loopCountVal + delta)); document.getElementById('loop-count-val').textContent = loopCountVal }
function getLoopTarget() { return loopCountVal }

async function startAnimSession() {
  if (!selectedSeq || !sequences[selectedSeq]) return
  const animScreen = document.getElementById('screen-anim')
  if (animScreen) animScreen.classList.remove('controls-hidden')
  const paths = sequences[selectedSeq].paths
  const btn = document.getElementById('btn-start'); btn.disabled = true
  animFrames = paths.map(p => ({ path: p, dataUrl: isR2Mode ? p : 'file://' + p }))
  animIndex = 0; animStudyMode = false; animLoopCount = 0
  if (!preloadCache[selectedSeq]) {
    await Promise.all(paths.map(p => new Promise(resolve => {
      const img = new Image(); img.onload = img.onerror = resolve; img.src = isR2Mode ? p : 'file://' + p
    })))
    preloadCache[selectedSeq] = true
  }
  btn.disabled = false
  document.getElementById('anim-seq-name').textContent = selectedSeq + '  ·  ' + animFrames.length + ' frames'
  document.getElementById('anim-mode-badge').className = 'anim-mode-badge loop'
  document.getElementById('anim-mode-badge').textContent = 'Boucle 1 / ' + getLoopTarget()
  document.getElementById('anim-mode-badge').style.display = ''
  document.getElementById('anim-frame-info').style.display = ''
  document.getElementById('study-timer-wrap').style.display = 'none'
  document.getElementById('btn-study').style.display = 'none'
  document.getElementById('btn-loop-again').style.display = 'none'
  document.getElementById('btn-anim-pause').style.display = 'inline-flex'
  document.getElementById('btn-anim-prev').style.display = 'none'
  document.getElementById('btn-anim-next').style.display = 'none'
  document.getElementById('anim-overlay').classList.add('hidden')
  document.getElementById('timeline-wrap').style.visibility = 'visible'
  buildTimeline(); showScreen('screen-anim'); showFrame(0)
  if (currentAnimMode === 'study') enterStudyMode(); else startLoop()
}

function showFrame(idx) {
  if (!animFrames[idx]) { setTimeout(() => showFrame(idx), 50); return }
  animIndex = idx
  document.getElementById('anim-img').src = animFrames[idx].dataUrl
  document.getElementById('anim-frame-info').textContent = 'Image ' + (idx + 1) + ' / ' + animFrames.length
  document.querySelectorAll('.thumb-item').forEach((t, i) => t.classList.toggle('active', i === idx))
  const active = document.querySelector('.thumb-item.active')
  if (active) active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  updateAnimStarBtn()
}

function playOnce() {
  if (animInterval) clearInterval(animInterval)
  const fps = parseInt(document.getElementById('fps-slider').value) || 8
  const delay = Math.round(1000 / fps)
  animLooping = true; showFrame(0)
  document.getElementById('btn-loop-again').style.display = 'none'
  document.getElementById('anim-mode-badge').className = 'anim-mode-badge loop'
  document.getElementById('anim-mode-badge').textContent = 'Aperçu'
  animInterval = setInterval(() => {
    const next = animIndex + 1
    if (next >= animFrames.length) {
      clearInterval(animInterval); animLooping = false; showFrame(0)
      document.getElementById('btn-loop-again').style.display = 'inline-flex'
      document.getElementById('anim-mode-badge').className = 'anim-mode-badge study'
      document.getElementById('anim-mode-badge').textContent = 'Étude — Image 1 / ' + animFrames.length
      startStudyTimer(); return
    }
    showFrame(next)
  }, delay)
}

function startLoop() {
  if (animInterval) clearInterval(animInterval)
  const fps = parseInt(document.getElementById('fps-slider').value) || 8
  const delay = Math.round(1000 / fps)
  animLooping = true
  document.getElementById('anim-overlay').classList.add('hidden')
  document.getElementById('anim-play-btn').textContent = '⏸'
  document.getElementById('btn-anim-pause').style.display = 'inline-flex'
  document.getElementById('btn-anim-pause').textContent = 'Pause'
  document.getElementById('btn-loop-again').style.display = 'none'
  document.getElementById('anim-mode-badge').className = 'anim-mode-badge loop'
  document.getElementById('anim-mode-badge').textContent = 'Boucle ' + (animLoopCount + 1) + ' / ' + getLoopTarget()
  animInterval = setInterval(() => {
    const next = animIndex + 1
    if (next >= animFrames.length) {
      animLoopCount++
      if (animLoopCount >= getLoopTarget() && currentAnimMode === 'mix') {
        clearInterval(animInterval); animLooping = false; soundNext()
        setTimeout(() => enterStudyMode(), 500); return
      } else if (animLoopCount >= getLoopTarget()) animLoopCount = 0
      document.getElementById('anim-mode-badge').textContent = 'Boucle ' + (animLoopCount + 1) + ' / ' + getLoopTarget()
      showFrame(0)
    } else showFrame(next)
  }, delay)
}

function toggleAnimLoop() {
  if (animStudyMode) {
    if (studyTicker) { clearInterval(studyTicker); studyTicker = null; document.getElementById('btn-anim-pause').textContent = 'Reprendre' }
    else { resumeStudyTimer(); document.getElementById('btn-anim-pause').textContent = 'Pause' }
    return
  }
  if (animLooping) {
    clearInterval(animInterval); animLooping = false
    document.getElementById('anim-play-btn').textContent = '▶'
    document.getElementById('btn-anim-pause').textContent = 'Reprendre'
  } else startLoop()
}

let animStudyLog = []

function enterStudyMode() {
  clearInterval(animInterval); animLooping = false; animStudyMode = true; animStudyLog = []
  showFrame(0)
  document.getElementById('anim-overlay').classList.add('hidden')
  document.getElementById('anim-mode-badge').className = 'anim-mode-badge study'
  document.getElementById('anim-mode-badge').textContent = 'Étude — Image 1 / ' + animFrames.length
  document.getElementById('btn-study').style.display = 'none'
  document.getElementById('btn-loop-again').style.display = 'inline-flex'
  document.getElementById('btn-anim-pause').style.display = 'inline-flex'
  document.getElementById('btn-anim-pause').textContent = 'Pause'
  document.getElementById('btn-anim-prev').style.display = 'inline-flex'
  document.getElementById('btn-anim-next').style.display = 'inline-flex'
  document.getElementById('btn-anim-prev').disabled = true
  document.getElementById('btn-anim-next').disabled = animFrames.length <= 1
  document.getElementById('study-timer-wrap').style.display = 'flex'
  startStudyTimer()
}

function startStudyTimer() {
  clearInterval(studyTicker)
  studyDuration = getStudyDuration(); studyTimeLeft = studyDuration; updateStudyTimer()
  studyTicker = setInterval(() => {
    studyTimeLeft = Math.max(0, studyTimeLeft - 1); updateStudyTimer()
    if (studyTimeLeft === 5) soundWarning()
    if (studyTimeLeft === 0) { soundNext(); animNextFrame() }
    if (animStudyMode) document.getElementById('anim-mode-badge').textContent = 'Étude — Frame ' + (animIndex + 1) + ' / ' + animFrames.length
  }, 1000)
}

function resumeStudyTimer() {
  clearInterval(studyTicker)
  studyTicker = setInterval(() => {
    studyTimeLeft = Math.max(0, studyTimeLeft - 1); updateStudyTimer()
    if (studyTimeLeft === 5) soundWarning()
    if (studyTimeLeft === 0) { soundNext(); animNextFrame() }
    if (animStudyMode) document.getElementById('anim-mode-badge').textContent = 'Étude — Frame ' + (animIndex + 1) + ' / ' + animFrames.length
  }, 1000)
}

function updateStudyTimer() {
  const m = Math.floor(studyTimeLeft / 60), s = studyTimeLeft % 60
  const el = document.getElementById('study-timer')
  const timeStr = m + ':' + String(s).padStart(2, '0')
  el.textContent = timeStr
  const isWarning = studyTimeLeft <= 5 && studyTimeLeft > 0
  el.className = isWarning ? 'warning' : ''
  const pct = studyDuration > 0 ? Math.round((studyTimeLeft / studyDuration) * 100) : 0
  document.getElementById('study-prog-bar').style.width = pct + '%'
  // Sync floating timer (mobile/tablet)
  const ft = document.getElementById('anim-float-timer-text')
  const fb = document.getElementById('anim-float-timer-bar')
  if (ft) { ft.textContent = timeStr; ft.className = 'float-timer-text' + (isWarning ? ' warning' : '') }
  if (fb) fb.style.width = pct + '%'
}

function animNextFrame() {
  clearInterval(studyTicker)
  if (animStudyMode && animFrames[animIndex]) {
    animStudyLog.push({ src: animFrames[animIndex].dataUrl, duration: studyDuration, frameNum: animIndex })
  }
  if (animIndex >= animFrames.length - 1) { if (animStudyMode) { soundNext(); finishAnimSession() }; return }
  showFrame(animIndex + 1)
  document.getElementById('btn-anim-prev').disabled = animIndex === 0
  document.getElementById('btn-anim-next').disabled = animIndex >= animFrames.length - 1
  document.getElementById('anim-mode-badge').textContent = 'Étude — Frame ' + (animIndex + 1) + ' / ' + animFrames.length
  if (animStudyMode) startStudyTimer()
}

function animPrevFrame() {
  if (animIndex <= 0) return
  showFrame(animIndex - 1)
  document.getElementById('btn-anim-prev').disabled = animIndex === 0
  document.getElementById('btn-anim-next').disabled = animIndex >= animFrames.length - 1
  if (animStudyMode) startStudyTimer()
}

function buildTimeline() {
  const oldInner = document.getElementById('timeline-inner')
  // Clone-and-replace to remove all previously attached listeners
  const inner = oldInner.cloneNode(false)
  oldInner.parentNode.replaceChild(inner, oldInner)
  inner.innerHTML = ''
  animFrames.forEach((frame, i) => {
    const item = document.createElement('div')
    item.className = 'thumb-item' + (i === 0 ? ' active' : ''); item.dataset.idx = i
    const img = document.createElement('img'); if (frame) img.src = frame.dataUrl; img.loading = 'lazy'
    item.appendChild(img)
    const num = document.createElement('div'); num.className = 'thumb-num'; num.textContent = i + 1; item.appendChild(num)
    item.onclick = () => { showFrame(i); if (animStudyMode) startStudyTimer() }
    item.addEventListener('mouseenter', () => { if (!animLooping && !animStudyMode) showFrame(i) })
    inner.appendChild(item)
  })
  let isDragging = false
  inner.addEventListener('mousedown', (e) => { isDragging = true; slideToMouse(e) })
  inner.addEventListener('mousemove', (e) => { if (isDragging) slideToMouse(e) })
  inner.addEventListener('mouseup', () => { isDragging = false })
  inner.addEventListener('mouseleave', () => { isDragging = false })
}

function slideToMouse(e) {
  const item = e.target.closest('.thumb-item'); if (!item) return
  const idx = parseInt(item.dataset.idx); if (!isNaN(idx)) { showFrame(idx); if (animStudyMode) startStudyTimer() }
}

// Shared helper — builds recap grid items for both Pose and Animation sessions.
// Each entry in `logs` must provide: { src, label, favLabel, duration, rotation? }
function buildRecapGrid(logs) {
  const grid = document.getElementById('recap-grid'); grid.innerHTML = ''
  logs.forEach((log, i) => {
    const item = document.createElement('div'); item.className = 'recap-item'
    const img = document.createElement('img')
    if (log.src) img.src = log.src
    if (log.imgStyle) img.style.cssText = log.imgStyle
    if (log.rotation) img.style.transform = 'rotate(' + log.rotation + 'deg)'
    item.appendChild(img)
    const num = document.createElement('div'); num.className = 'recap-num'; num.textContent = log.label; item.appendChild(num)
    const dur = document.createElement('div'); dur.className = 'recap-duration'; const d = log.duration; dur.textContent = d < 60 ? d + 's' : (d / 60) + 'min'; item.appendChild(dur)
    if (log.src) {
      item.addEventListener('click', () => openLightbox(log.src, i, log.duration, log.rotation || 0))
      const star = document.createElement('button')
      star.className = 'recap-star' + (isFaved(log.src) ? ' faved' : ''); star.textContent = isFaved(log.src) ? '★' : '☆'; star.title = 'Favori'
      star.onclick = (e) => { e.stopPropagation(); if (isFaved(log.src)) { removeFav(log.src); star.textContent = '☆'; star.classList.remove('faved') } else { addFav(log.src, log.favLabel); star.textContent = '★'; star.classList.add('faved') }; star.classList.add('bump'); setTimeout(() => star.classList.remove('bump'), 250) }
      item.appendChild(star)
    }
    grid.appendChild(item)
  })
  document.getElementById('recap-title').textContent = 'Session terminée'
  document.getElementById('stat-poses-label').textContent = 'poses'
  document.getElementById('stat-time-label').textContent = 'min'
}

function finishAnimSession() {
  clearInterval(animInterval); clearInterval(studyTicker)
  const logs = animStudyLog.filter(Boolean)
  const totalMins = Math.round(logs.reduce((a, l) => a + l.duration, 0) / 60)
  document.getElementById('stat-poses').textContent = logs.length
  document.getElementById('stat-time').textContent = totalMins || 1
  logSession({ type: 'anim', poses: logs.length, minutes: totalMins || 1, seq: selectedSeq || '' })
  buildRecapGrid(logs.map((log, i) => ({
    src: log.src, label: 'F' + (log.frameNum + 1), favLabel: 'Frame ' + (log.frameNum + 1),
    duration: log.duration, imgStyle: 'width:100%;height:100%;object-fit:cover;display:block;'
  })))
  showScreen('screen-end')
}

function askEndAnim() {
  clearInterval(animInterval); clearInterval(studyTicker)
  if (animStudyMode && animStudyLog.length > 0) {
    if (animFrames[animIndex] && !animStudyLog.find(l => l.frameNum === animIndex)) {
      animStudyLog.push({ src: animFrames[animIndex].dataUrl, duration: studyDuration - studyTimeLeft, frameNum: animIndex })
    }
    finishAnimSession()
  } else showScreen('screen-config')
}

// ══ RÉCAP POSE ══
function finishSession() {
  clearInterval(ticker); ticker = null
  if (_bgPreloadTimer) { clearTimeout(_bgPreloadTimer); _bgPreloadTimer = null }
  const logs = sessionLog.filter(Boolean)
  const totalMins = Math.round(logs.reduce((a, l) => a + l.duration, 0) / 60)
  document.getElementById('stat-poses').textContent = logs.length
  document.getElementById('stat-time').textContent = totalMins || 1
  logSession({ type: 'pose', poses: logs.length, minutes: totalMins || 1, subMode: currentSubMode, cats: Array.from(selectedCats).filter(c => c !== 'Sans catégorie').join(', ') })
  buildRecapGrid(logs.map((log, i) => ({
    src: log.thumbnail?.data || null, label: i + 1, favLabel: 'Pose ' + (i + 1),
    duration: log.duration, rotation: log.rotation || 0
  })))
  // Store last ref for community share
  if (logs.length > 0 && logs[logs.length - 1].thumbnail?.data) setLastRefUrl(logs[logs.length - 1].thumbnail.data)
  showScreen('screen-end')
  // Auto-open share overlay after a challenge session
  if (_challengeSession) {
    _challengeSession = false
    setTimeout(() => openShareDrawing(), 400)
  }
  // Pop-up Discord (1 fois sur 3)
  if (Math.random() < 0.33) {
    setTimeout(() => {
      const existing = document.getElementById('discord-popup'); if (existing) return
      const popup = document.createElement('div'); popup.id = 'discord-popup'
      popup.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#1e1e1e;border:0.5px solid #333;border-radius:12px;padding:16px 20px;max-width:280px;z-index:9999;box-shadow:0 8px 32px rgba(0,0,0,0.5);'
      popup.innerHTML = `<div style="font-size:13px;color:#888;margin-bottom:6px">🐛 Un bug ? Une idée ?</div><div style="font-size:14px;color:#fff;font-weight:500;margin-bottom:12px">Rejoins la communauté Gesturo</div><div style="display:flex;gap:8px"><a href="#" onclick="event.preventDefault(); window.electronAPI.openExternal('https://discord.gg/f9pf3vmgg2')" style="flex:1;background:#5865F2;color:#fff;border:none;border-radius:8px;padding:8px 12px;font-size:13px;font-weight:500;cursor:pointer;text-decoration:none;text-align:center">💬 Discord</a><button onclick="document.getElementById('discord-popup').remove()" style="background:#2e2e2e;color:#888;border:none;border-radius:8px;padding:8px 12px;font-size:13px;cursor:pointer">✕</button></div>`
      document.body.appendChild(popup)
      setTimeout(() => { const p = document.getElementById('discord-popup'); if(p) p.remove() }, 8000)
    }, 1500)
  }
}

function replaySession() {
  if (mainMode === 'anim') {
    animStudyLog = []; animLoopCount = 0; animIndex = 0; animStudyMode = false
    buildTimeline(); showScreen('screen-anim'); showFrame(0)
    if (currentAnimMode === 'study') enterStudyMode(); else startLoop()
  } else if (mainMode === 'cinema') {
    startCinemaSession()
  } else {
    sessionEntries.sort(() => Math.random() - 0.5)
    currentIndex = 0; sessionLog = []
    showScreen('screen-session'); loadAndShow(0)
  }
}

// ══ LIGHTBOX ══
function openLightbox(src, index, duration) {
  const lb = document.getElementById('lightbox')
  lb.querySelector('img').src = src
  const d = duration
  document.getElementById('lightbox-info').textContent = 'Pose ' + (index + 1) + (d ? '  ·  ' + (d < 60 ? d + ' sec' : (d / 60) + ' min') : '')
  lb.classList.add('open')
  document.addEventListener('keydown', onLbKey)
}
function closeLightbox() {
  document.getElementById('lightbox').classList.remove('open')
  document.getElementById('lb-fav-remove').style.display = 'none'
  lbFavSrc = null
  document.removeEventListener('keydown', onLbKey)
}
function onLbKey(e) { if (e.key === 'Escape') closeLightbox() }

// ══ FAVORIS ══
const FAV_KEY = 'gd4_favorites'

// Suffixe les clés localStorage par l'email du compte courant pour qu'un
// switch de compte sur la même machine ne mélange pas les données. Si
// aucun email connu (avant auth), on retombe sur la clé brute pour ne
// pas casser le boot. Migration auto dans les loaders : si la clé scopée
// n'existe pas mais la clé brute oui, on copie une fois.
function _scopedKey(base) {
  const email = (typeof _communityEmail === 'string' ? _communityEmail : '').toLowerCase()
  return email ? base + ':' + email : base
}
function _readScoped(base) {
  const sk = _scopedKey(base)
  let raw = localStorage.getItem(sk)
  if (raw === null && sk !== base) {
    // Migration one-shot : on récupère l'ancienne clé brute (pré-scope) et
    // on l'attribue au compte courant (1er user qui se connecte hérite des
    // datas anonymes locales). Les comptes suivants partent vides.
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
// Permet à l'user de retrouver son historique sur n'importe quelle machine.
async function syncHistFromServer() {
  try {
    if (!window.electronAPI?.getSessions) return
    const remote = await window.electronAPI.getSessions()
    if (!Array.isArray(remote)) return
    _writeScoped(HIST_KEY, JSON.stringify(remote))
    // Re-render la week-bar avec les données fraîches
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
    const lbl = document.createElement('div'); lbl.style.cssText = 'position:absolute;bottom:6px;left:6px;background:rgba(0,0,0,0.7);border-radius:4px;padding:2px 6px;font-size:11px;color:#f0c040;'; lbl.textContent = '★ ' + (i + 1); item.appendChild(lbl)
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

function renderWeekBar() {
  if (!document.getElementById('week-streak')) return
  const all = loadHist(); const days = document.querySelectorAll('.week-day')
  // Tout en HEURE LOCALE (cohérent avec utcDayKey/computeStreak).
  const now = new Date()
  const todayLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const sessionDays = new Set(all.map(s => utcDayKey(s.ts)))
  // Ordre inversé : case 0 (gauche) = aujourd'hui, case N-1 (droite) = il y
  // a N-1 jours. Les jours actifs récents se retrouvent ainsi à gauche
  // (lecture naturelle de gauche à droite + progression du streak visible).
  days.forEach((el, i) => {
    const d = new Date(todayLocal); d.setDate(todayLocal.getDate() - i)
    const key = utcDayKey(d.getTime())
    const todayKey = utcDayKey(todayLocal.getTime())
    const isToday = key === todayKey; const isFuture = d > todayLocal; const done = sessionDays.has(key)
    el.className = 'week-day'
    if (isFuture) el.classList.add('future'); else if (done) el.classList.add('done')
    if (isToday) el.classList.add('today')
    el.title = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
  })
  const streak = computeStreak(all); const streakEl = document.getElementById('week-streak')
  streakEl.textContent = streak + ' j'; streakEl.className = streak === 0 ? 'zero' : ''
}

// ══ HISTORIQUE ══
const HIST_KEY = 'gd4_history'; let histPeriod = 'week'
function loadHist() { try { return JSON.parse(_readScoped(HIST_KEY) || '[]') } catch { return [] } }
function saveHist(h) { _writeScoped(HIST_KEY, JSON.stringify(h)) }

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
  histStreakEl.textContent = all.length === 0 ? '…' : localStreak
  if (window.electronAPI?.getStreak) {
    window.electronAPI.getStreak().then(r => {
      const streak = Math.max(r.streak || 0, localStreak)
      histStreakEl.textContent = streak
      const streakEl = document.getElementById('week-streak')
      if (streakEl) { streakEl.textContent = streak + ' j'; streakEl.className = streak === 0 ? 'zero' : '' }
    }).catch(() => {
      // Fallback: show local streak if server fetch fails
      histStreakEl.textContent = localStreak
    })
  } else {
    histStreakEl.textContent = localStreak
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

function renderHistList() {
  const all = loadHist(); const now = Date.now()
  const cutoff = histPeriod === 'week' ? now - 7 * 86400000 : histPeriod === 'month' ? now - 30 * 86400000 : 0
  const filtered = all.filter(s => s.ts >= cutoff).reverse()
  const list = document.getElementById('hist-sessions-list'); const empty = document.getElementById('hist-empty')
  list.innerHTML = ''
  if (filtered.length === 0) { empty.style.display = 'block'; return }
  empty.style.display = 'none'
  filtered.forEach(s => {
    const row = document.createElement('div'); row.className = 'hist-session-row'
    const dot = document.createElement('div'); dot.className = 'hist-session-dot' + (s.type === 'anim' ? ' anim' : '')
    const info = document.createElement('div'); info.className = 'hist-session-info'
    const typeLabel = s.type === 'anim' ? 'Animation' + (s.seq ? ' — ' + s.seq : '') : s.type === 'cinema' ? '🎬 Cinéma' + (s.film ? ' — ' + s.film : '') : 'Poses' + (s.subMode === 'progressive' ? ' (progressif)' : '')
    const catsLabel = s.cats ? '<span style="color:#666"> · ' + s.cats + '</span>' : ''
    info.innerHTML = typeLabel + catsLabel + '<div class="hist-session-meta">' + (s.poses || 0) + ' frames · ' + (s.minutes || 0) + ' min</div>'
    const time = document.createElement('div'); time.className = 'hist-session-time'; time.textContent = formatHistDate(s.ts)
    row.appendChild(dot); row.appendChild(info); row.appendChild(time); list.appendChild(row)
  })
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

// Clé jour en HEURE LOCALE (perspective utilisateur). Avant on utilisait UTC,
// ce qui causait des bugs de streak : une session faite le mercredi à 1h CEST
// était enregistrée à mardi 23h UTC → comptée comme un jour différent.
// Le fuseau local est ce que l'user attend ("ma journée commence à minuit").
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
  // On compte en HEURE LOCALE (cohérent avec utcDayKey). Avant on faisait
  // setUTCDate + toISOString → bug si fuseau != UTC.
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
function toggleOptions() { document.getElementById('options-dropdown').classList.toggle('open') }

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
  if (!e.target.closest('#options-btn') && !e.target.closest('#options-dropdown')) document.getElementById('options-dropdown').classList.remove('open')
})
function confirmResetHistory() {
  document.getElementById('options-dropdown').classList.remove('open')
  showConfirmModal('Réinitialiser tout l\'historique ? Cette action est irréversible.', () => {
    localStorage.removeItem(HIST_KEY); renderWeekBar()
    if (document.getElementById('hist-options').style.display !== 'none') renderHist()
  }, { confirmText: 'Réinitialiser', danger: true })
}
function handleLogout() {
  document.getElementById('options-dropdown').classList.remove('open')
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
  const hist = JSON.parse(localStorage.getItem('gd4_history') || '[]')
  const totalPoses = hist.reduce((a, s) => a + (s.poses || 0), 0)
  document.getElementById('profile-poses').textContent = totalPoses
  const badges = Object.keys(JSON.parse(localStorage.getItem('gd4_badges') || '{}')).length
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
  window.addEventListener('mouseup', (e) => {
    if (!dragging) return
    dragging = false
    const dx = e.clientX - mouseStartX
    if (Math.abs(dx) > 60) {
      if (dx < 0) goTo(current + 1)
      else goTo(current - 1)
    }
  })

  goTo(0)
}

function closeOnboarding() {
  const overlay = document.getElementById('onboarding-overlay')
  if (!overlay) return
  if (overlay._keyHandler) document.removeEventListener('keydown', overlay._keyHandler)
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
  document.getElementById('options-dropdown').classList.remove('open')
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
  const speed30 = hist.filter(s => s.type === 'pose' && s.subMode !== 'progressive').length
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

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { applyMuteUi(); applyWaterUi() })
} else {
  applyMuteUi(); applyWaterUi()
}
