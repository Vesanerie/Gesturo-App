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
        renderWeekBar()
        maybeShowOnboarding()
        maybeAskForUsername()
      }
    })
  }
  renderWeekBar()
  document.getElementById('options-btn').style.display = 'flex'
  document.getElementById('discord-btn').style.display = 'flex'
  document.getElementById('profile-btn').style.display = 'flex'

  // ── Logo icon dans la sidebar tablet (injecté avant le ::before pseudo) ──
  const tabs = document.querySelector('#screen-config .mode-tabs')
  if (tabs) {
    const logo = document.createElement('img')
    logo.src = 'assets/icon.png'
    logo.className = 'sidebar-logo-icon'
    tabs.prepend(logo)
  }

  // ── Auto-update UI ──
  if (window.electronAPI?.onUpdateStatus) {
    window.electronAPI.onUpdateStatus(({ status, version, message }) => {
      let banner = document.getElementById('update-banner')
      if (status === 'downloading') {
        if (!banner) {
          banner = document.createElement('div')
          banner.id = 'update-banner'
          banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:linear-gradient(135deg,#1a2040,#2a3050);color:#fff;display:flex;align-items:center;justify-content:center;gap:12px;padding:10px 16px;font-size:13px;font-family:inherit;box-shadow:0 2px 12px rgba(0,0,0,0.3);'
          banner.innerHTML = '<span>Mise \u00e0 jour v' + version + ' en cours de t\u00e9l\u00e9chargement\u2026</span>'
          document.body.appendChild(banner)
        }
      } else if (status === 'ready') {
        if (!banner) {
          banner = document.createElement('div')
          banner.id = 'update-banner'
          document.body.appendChild(banner)
        }
        banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:linear-gradient(135deg,#1a2040,#2a3050);color:#fff;display:flex;align-items:center;justify-content:center;gap:12px;padding:10px 16px;font-size:13px;font-family:inherit;box-shadow:0 2px 12px rgba(0,0,0,0.3);'
        banner.innerHTML = '<span>Gesturo v' + version + ' est pr\u00eat !</span>'
          + '<button onclick="window.electronAPI.installUpdate()" style="background:#e8a088;color:#111;border:none;border-radius:6px;padding:6px 16px;font-weight:600;cursor:pointer;font-size:13px;">Installer et relancer</button>'
          + '<button onclick="this.parentElement.remove()" style="background:transparent;color:#fff;border:1px solid rgba(255,255,255,0.3);border-radius:6px;padding:6px 12px;cursor:pointer;font-size:12px;">Plus tard</button>'
      } else if (status === 'error') {
        if (banner) {
          banner.innerHTML = '<span>Erreur de mise \u00e0 jour : ' + (message || 'inconnue') + '</span>'
            + '<button onclick="this.parentElement.remove()" style="background:transparent;color:#fff;border:1px solid rgba(255,255,255,0.3);border-radius:6px;padding:6px 12px;cursor:pointer;font-size:12px;">Fermer</button>'
        }
      }
    })
  }

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
          <div class="auth-logo"><img src="assets/icon.png" class="auth-logo-icon" alt="Gesturo"><span class="auth-logo-text">Gestur<span class="gesturo-o">o</span><span class="auth-logo-dot">.</span></span></div>
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
          if (result?.needsConfirmation) { msg.textContent = 'Vérifie tes emails pour confirmer ton compte !'; msg.style.color = '#a8d090'; return }
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
        msg.textContent = 'Envoi du lien...'; msg.style.color = '#4a5870'
        window.electronAPI.authResetPassword(email).then(result => {
          if (result?.success) { msg.textContent = 'Lien envoyé ! Vérifie tes emails.'; msg.style.color = '#a8d090' }
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
          badge.style.background = 'linear-gradient(135deg, rgba(232,160,136,0.15), rgba(184,160,216,0.15))'
          badge.style.border = '0.5px solid #b8a0d8'
          badge.style.color = '#b8a0d8'
        } else {
          badge.textContent = 'FREE'
          badge.style.background = 'rgba(255,255,255,0.05)'
          badge.style.border = '0.5px solid #333'
          badge.style.color = '#555'
        }
      }
      loadR2(isPro)
      // Widget deep link handlers (iOS)
      if (window.electronAPI.onDailyPoseDeepLink) {
        window.electronAPI.onDailyPoseDeepLink(() => _handleDailyPoseDeepLink())
      }
      if (window.electronAPI.onChallengeDeepLink) {
        window.electronAPI.onChallengeDeepLink((challengeId) => {
          // Wait for challenges to load, then participate
          const tryParticipate = () => {
            if (typeof participateChallenge === 'function') {
              participateChallenge(challengeId || '')
            }
          }
          setTimeout(tryParticipate, 1000)
        })
      }
      syncFavsFromServer()
      syncHistFromServer()
      syncBadgesFromServer().then(() => checkBadges())
      loadAnnouncement()
      checkMaintenanceMode()
      pingUserActivity()
      loadFeatureFlagsFromServer()
      // Poll announcements toutes les 5 min + quand l'app revient au focus (debounced)
      setInterval(loadAnnouncement, 5 * 60 * 1000)
      let _announceFocusTimer = null
      window.addEventListener('focus', () => {
        clearTimeout(_announceFocusTimer)
        _announceFocusTimer = setTimeout(loadAnnouncement, 500)
      })
    })
    window.electronAPI.onAutoLoad(f => { isR2Mode = false; loadFolder(f) })
  }
  initAutoLoad()
})

function adminSetSource(source) {
  const r2 = document.getElementById('btn-source-r2')
  const local = document.getElementById('btn-source-local')
  if (source === 'r2') {
    if (r2) r2.style.cssText += ';background:#182034;border-color:#b8a0d8;color:#b8a0d8'
    if (local) { local.style.background = ''; local.style.borderColor = ''; local.style.color = '' }
    window.electronAPI.adminSwitchSource({ useLocal: false })
  } else {
    if (local) local.style.cssText += ';background:#182034;border-color:#b8a0d8;color:#b8a0d8'
    if (r2) { r2.style.background = ''; r2.style.borderColor = ''; r2.style.color = '' }
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
    // Clear les preview intervals des cards séquence animation
    const seqWrap = document.getElementById('sequences-wrap')
    if (seqWrap) seqWrap.querySelectorAll('div').forEach(card => {
      if (card._previewInterval) { clearInterval(card._previewInterval); card._previewInterval = null }
    })
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
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('active')
    s.classList.remove('screen-enter')
  })
  const screen = document.getElementById(id)
  if (screen) {
    screen.classList.add('active')
    // Transition fade sur mobile/tablet
    if (oldId && oldId !== id) {
      screen.classList.add('screen-enter')
      screen.addEventListener('animationend', () => screen.classList.remove('screen-enter'), { once: true })
    }
  }
  const visible = id === 'screen-config'
  // Cacher la pile de sélection quand on quitte l'écran Config
  const pile = document.getElementById('selection-pile')
  const miniBar = document.getElementById('pile-mini-bar')
  const screenConfig = document.getElementById('screen-config')
  if (!visible) {
    if (pile) pile.classList.add('pile-hidden')
    if (miniBar) miniBar.classList.add('pile-hidden')
    if (screenConfig) screenConfig.classList.remove('has-pile')
  } else if (mainMode === 'pose') {
    renderSelectionPile()
  }
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
  const img = document.getElementById('photo-img')
  const pdf = document.getElementById('pdf-canvas')
  if (img) { img.style.transform = transform; img.style.filter = filter }
  if (pdf) { pdf.style.transform = transform; pdf.style.filter = filter }
}

function toggleBW() {
  currentBW = !currentBW
  const btn = document.getElementById('bw-btn')
  if (btn) {
    btn.style.color = currentBW ? '#fff' : ''
    btn.style.background = currentBW ? 'rgba(255,255,255,0.15)' : ''
    btn.style.borderColor = currentBW ? 'rgba(255,255,255,0.4)' : ''
  }
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
    // la premiere sequence non-lockée alphabetiquement. Deterministe → meme choix
    // entre runs. Pour PRO on laisse null (pas de restriction).
    if (!isPro) {
      const freeSeqs = Object.keys(sequences).filter(s => !sequences[s].locked).sort()
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

    // Widget iOS — push daily pose data to App Group
    _updateWidgetDailyPose(isPro)
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

// ── Widget iOS : "Pose du jour" ──
// Seeded random based on date → same pose all day, changes at midnight.
function _dailyPoseSeed() {
  const d = new Date()
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()
}
function _seededRandom(seed) {
  let s = seed
  return function () { s = (s * 16807 + 0) % 2147483647; return s / 2147483647 }
}

let _dailyPoseEntry = null

async function _updateWidgetDailyPose(isPro) {
  if (!window.__isIOS || !window.electronAPI?.updateWidgetData) return

  // Try to get active challenge first
  let challenge = null
  try {
    const res = await window.electronAPI.getChallenges()
    const challenges = res?.challenges || []
    if (challenges.length) challenge = challenges[0]
  } catch (e) {}

  // Fallback to random pose if no challenge
  let imageURL = '', title = '', subtitle = '', challengeId = ''
  if (challenge) {
    imageURL = challenge.ref_image_url || ''
    title = challenge.title || 'Challenge du jour'
    subtitle = challenge.category || ''
    challengeId = challenge.id || ''
  } else if (allEntries.length) {
    const rng = _seededRandom(_dailyPoseSeed())
    const eligible = isPro ? allEntries : allEntries.filter(e => e.category === 'poses-dynamiques')
    if (eligible.length) {
      const entry = eligible[Math.floor(rng() * eligible.length)]
      _dailyPoseEntry = entry
      imageURL = entry.path
      title = 'Pose du jour'
      subtitle = entry.category
    }
  }
  if (!imageURL && !title) return

  let streak = 0
  try { const s = await window.electronAPI.getStreak(); streak = s?.streak || 0 } catch (e) {}

  const now = new Date()
  const date = now.getFullYear() + '-' +
    String(now.getMonth() + 1).padStart(2, '0') + '-' +
    String(now.getDate()).padStart(2, '0')

  window.electronAPI.updateWidgetData({ imageURL, title, subtitle, challengeId, streak, date })
}

// Deep link from widget tap → open session with daily pose
function _handleDailyPoseDeepLink() {
  if (!_dailyPoseEntry && allEntries.length) {
    // Recalculate if not set yet (cold start)
    const rng = _seededRandom(_dailyPoseSeed())
    const eligible = currentUserIsPro ? allEntries : allEntries.filter(e => e.category === 'poses-dynamiques')
    if (eligible.length) {
      const idx = Math.floor(rng() * eligible.length)
      _dailyPoseEntry = eligible[idx]
    }
  }
  if (!_dailyPoseEntry) return
  // Same pattern as participateChallenge() — single-image session
  sessionEntries = [{ type: 'image', path: _dailyPoseEntry.path, category: _dailyPoseEntry.category, isR2: true }]
  currentIndex = 0; sessionLog = []; _challengeSession = false
  mainMode = 'pose'; currentSubMode = 'class'
  if (typeof closeEndConfirm === 'function') closeEndConfirm()
  document.getElementById('controls').style.display = 'flex'
  showScreen('screen-session'); loadAndShow(0)
}

async function pickFolder() {
  const folder = await window.electronAPI.pickFolder()
  if (!folder) return
  await loadFolder(folder)
}

function _initAppListeners() {
  document.getElementById('discord-btn').addEventListener('click', function(e) { e.preventDefault(); window.electronAPI.openExternal('https://discord.gg/f9pf3vmgg2') })
  document.getElementById('btn-source-r2').addEventListener('click', function() { adminSetSource('r2') })
  document.getElementById('btn-source-local').addEventListener('click', function() { adminSetSource('local') })
  document.getElementById('btn-pick-folder').addEventListener('click', pickFolder)
  document.getElementById('flip-toggle').addEventListener('click', toggleFlipMode)
  document.getElementById('bw-btn').addEventListener('click', toggleBW)
  document.getElementById('btn-flip-h').addEventListener('click', flipH)
  document.getElementById('btn-rotate-left').addEventListener('click', rotateLeft)
  document.getElementById('btn-rotate-right').addEventListener('click', rotateRight)
  document.getElementById('btn-new-session').addEventListener('click', function() { showScreen('screen-config'); if (mainMode === 'cinema') switchMainMode('cinema') })
  document.getElementById('btn-moodboard-back').addEventListener('click', closeMoodboard)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initAppListeners)
} else {
  _initAppListeners()
}
