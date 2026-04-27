// ══ MOBILE NATIVE UX ══
// Splash screen, swipe gestures, status bar.
// No-op on desktop Electron (guarded by Capacitor check).
;(function () {
  const isMobile = window.Capacitor || window.innerWidth < 1400

  // ── SPLASH SCREEN ──
  // Fade out après un court délai pour laisser le temps à l'app de charger.
  const splash = document.getElementById('splash-screen')
  if (splash) {
    const hideSplash = () => {
      splash.classList.add('fade-out')
      setTimeout(() => { splash.style.display = 'none' }, 500)
    }
    // Attendre que le DOM soit prêt + un petit délai pour le rendu
    if (document.readyState === 'complete') {
      setTimeout(hideSplash, 800)
    } else {
      window.addEventListener('load', () => setTimeout(hideSplash, 800))
    }
  }

  // ── STATUS BAR ──
  // Configure la status bar iOS via Capacitor plugin.
  if (window.Capacitor && window.Capacitor.Plugins) {
    const StatusBar = window.Capacitor.Plugins.StatusBar
    if (StatusBar) {
      try {
        StatusBar.setStyle({ style: 'DARK' }).catch(() => {})
        StatusBar.setBackgroundColor({ color: '#0a0e18' }).catch(() => {})
      } catch (e) { /* silent */ }
    }
  }

  // ── SWIPE ENTRE POSES (session) ──
  // Swipe left = next, swipe right = prev. Seulement sur #photo-area.
  const photoArea = document.getElementById('photo-area')
  if (photoArea) {
    let startX = 0, startY = 0, tracking = false

    photoArea.addEventListener('touchstart', (e) => {
      if (window.innerWidth > 1399) return
      const screen = document.getElementById('screen-session')
      if (!screen || !screen.classList.contains('active')) return
      const t = e.touches[0]
      // Ne pas capturer si on est sur le bord gauche (réservé au swipe back)
      if (t.clientX < 35) return
      startX = t.clientX
      startY = t.clientY
      tracking = true
    }, { passive: true })

    photoArea.addEventListener('touchend', (e) => {
      if (!tracking) return
      tracking = false
      const t = e.changedTouches[0]
      const dx = t.clientX - startX
      const dy = t.clientY - startY
      // Minimum 60px horizontal, et plus horizontal que vertical
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return
      // Vérifier qu'on est bien en session
      if (typeof loading !== 'undefined' && loading) return
      if (dx < 0 && typeof nextPhoto === 'function') {
        hapticLight()
        nextPhoto()
      } else if (dx > 0 && typeof prevPhoto === 'function') {
        hapticLight()
        prevPhoto()
      }
    }, { passive: true })
  }

  // ── SWIPE BACK (bord gauche → retour au menu) ──
  // Depuis les écrans session, anim, cinema, end.
  // Swipe depuis le bord gauche (< 30px) vers la droite.
  let edgeStartX = 0, edgeStartY = 0, edgeTracking = false
  const hint = document.createElement('div')
  hint.className = 'swipe-back-hint'
  document.body.appendChild(hint)

  document.addEventListener('touchstart', (e) => {
    if (window.innerWidth > 1399) return
    const t = e.touches[0]
    // Seulement si on commence depuis le bord gauche
    if (t.clientX > 30) return
    const activeScreen = document.querySelector('.screen.active')
    if (!activeScreen) return
    const id = activeScreen.id
    // Seulement sur les écrans qui ont un "retour"
    if (!['screen-session', 'screen-anim', 'screen-cinema', 'screen-end'].includes(id)) return
    edgeStartX = t.clientX
    edgeStartY = t.clientY
    edgeTracking = true
    hint.classList.add('visible')
  }, { passive: true })

  document.addEventListener('touchmove', (e) => {
    if (!edgeTracking) return
    const t = e.touches[0]
    const dx = t.clientX - edgeStartX
    if (dx > 20) {
      hint.style.opacity = Math.min(1, dx / 100)
      hint.style.width = Math.min(8, 3 + dx / 30) + 'px'
    }
  }, { passive: true })

  document.addEventListener('touchend', (e) => {
    if (!edgeTracking) return
    edgeTracking = false
    hint.classList.remove('visible')
    hint.style.opacity = ''
    hint.style.width = ''
    const t = e.changedTouches[0]
    const dx = t.clientX - edgeStartX
    const dy = t.clientY - edgeStartY
    // Minimum 80px horizontal, plus horizontal que vertical
    if (dx < 80 || Math.abs(dx) < Math.abs(dy) * 1.2) return
    hapticLight()
    const activeScreen = document.querySelector('.screen.active')
    if (!activeScreen) return
    const id = activeScreen.id
    if (id === 'screen-end') {
      if (typeof showScreen === 'function') showScreen('screen-config')
    } else if (id === 'screen-session') {
      if (typeof askEnd === 'function') askEnd()
    } else if (id === 'screen-anim') {
      if (typeof openEndConfirm === 'function') openEndConfirm('anim')
    } else if (id === 'screen-cinema') {
      if (typeof openEndConfirm === 'function') openEndConfirm('cinema')
    }
  }, { passive: true })

  // ── PULL-TO-REFRESH sur la communauté ──
  // Détecte un swipe-down quand on est en haut du scroll.
  // Pas d'indicateur visuel propre — renderCommunity gère déjà le "Chargement...".
  const screenConfig = document.getElementById('screen-config')
  if (screenConfig) {
    let ptrStartY = 0, ptrActive = false

    screenConfig.addEventListener('touchstart', (e) => {
      if (window.innerWidth > 1399) return
      if (typeof mainMode !== 'undefined' && mainMode !== 'community') return
      if (screenConfig.scrollTop > 10) return
      ptrStartY = e.touches[0].clientY
      ptrActive = true
    }, { passive: true })

    screenConfig.addEventListener('touchend', (e) => {
      if (!ptrActive) return
      ptrActive = false
      const dy = e.changedTouches[0].clientY - ptrStartY
      if (dy > 80) {
        hapticMedium()
        if (typeof renderCommunity === 'function') renderCommunity(true)
      }
    }, { passive: true })
  }
})()

// ══ TIMER SHAKE (à 0 secondes) ══
// Le CSS gère le pulse via .warning. On ajoute .shake quand timeLeft atteint 0.
;(function () {
  const origTick = window.tick
  if (typeof origTick === 'function') {
    window.tick = function () {
      origTick.apply(this, arguments)
      if (typeof timeLeft !== 'undefined' && timeLeft === 0) {
        const el = document.getElementById('timer-display')
        if (el) {
          el.classList.add('shake')
          hapticMedium()
          setTimeout(() => el.classList.remove('shake'), 500)
        }
      }
    }
  }
})()

// ══ SWIPE ENTRE ONGLETS (config screen) ══
// Swipe horizontal sur le contenu pour changer de mode.
;(function () {
  const screen = document.getElementById('screen-config')
  if (!screen) return
  const MODES = ['pose', 'anim', 'cinema', 'favs']
  let swStartX = 0, swStartY = 0, swActive = false

  screen.addEventListener('touchstart', (e) => {
    if (window.innerWidth > 1399) return
    if (!screen.classList.contains('active')) return
    // Ne pas capturer sur les inputs, sliders, etc.
    if (e.target.closest('input, select, textarea, button, .mode-tab, .bottom-tab')) return
    swStartX = e.touches[0].clientX
    swStartY = e.touches[0].clientY
    swActive = true
  }, { passive: true })

  screen.addEventListener('touchend', (e) => {
    if (!swActive) return
    swActive = false
    const dx = e.changedTouches[0].clientX - swStartX
    const dy = e.changedTouches[0].clientY - swStartY
    if (Math.abs(dx) < 80 || Math.abs(dx) < Math.abs(dy) * 1.5) return
    if (typeof mainMode === 'undefined' || typeof switchMainMode !== 'function') return
    const idx = MODES.indexOf(mainMode)
    if (idx === -1) return
    if (dx < 0 && idx < MODES.length - 1) {
      hapticLight()
      switchMainMode(MODES[idx + 1])
    } else if (dx > 0 && idx > 0) {
      hapticLight()
      switchMainMode(MODES[idx - 1])
    }
  }, { passive: true })
})()

// ══ LONG PRESS — peek preview catégorie ══
;(function () {
  let pressTimer = null
  let peekOverlay = null

  function showPeek(catKey) {
    if (typeof categories === 'undefined') return
    const catData = categories[catKey]
    if (!catData) return
    const entries = Array.isArray(catData) ? catData : (catData.entries || [])
    if (entries.length === 0) return

    hapticMedium()
    peekOverlay = document.createElement('div')
    peekOverlay.className = 'peek-overlay'

    const card = document.createElement('div')
    card.className = 'peek-card'

    const grid = document.createElement('div')
    grid.className = 'peek-images'
    // Montrer 6 images aléatoires
    const shuffled = [...entries].sort(() => Math.random() - 0.5).slice(0, 6)
    shuffled.forEach(entry => {
      const img = document.createElement('img')
      img.src = entry.path || ''
      img.loading = 'eager'
      img.onerror = () => { img.style.background = '#182034' }
      grid.appendChild(img)
    })
    card.appendChild(grid)

    const info = document.createElement('div')
    info.className = 'peek-info'
    const name = document.createElement('span')
    name.className = 'peek-name'
    name.textContent = typeof getCatLabel === 'function' ? getCatLabel(catKey) : catKey
    const count = document.createElement('span')
    count.className = 'peek-count'
    count.textContent = entries.length + ' poses'
    info.appendChild(name)
    info.appendChild(count)
    card.appendChild(info)

    peekOverlay.appendChild(card)
    document.body.appendChild(peekOverlay)

    // Fermer au touch/click
    peekOverlay.addEventListener('click', closePeek)
    peekOverlay.addEventListener('touchend', closePeek)
  }

  function closePeek() {
    if (peekOverlay) {
      peekOverlay.remove()
      peekOverlay = null
    }
  }

  // Écouter les long press sur les category cards
  document.addEventListener('touchstart', (e) => {
    if (window.innerWidth > 1399) return
    const card = e.target.closest('[data-cat]')
    if (!card || card.classList.contains('cat-locked')) return
    pressTimer = setTimeout(() => {
      showPeek(card.dataset.cat)
    }, 500)
  }, { passive: true })

  document.addEventListener('touchend', () => {
    clearTimeout(pressTimer)
  }, { passive: true })

  document.addEventListener('touchmove', () => {
    clearTimeout(pressTimer)
  }, { passive: true })
})()

// ══ TOAST SYSTEM ══
// Usage: showToast('Message', 'success'|'error'|'info')
let _toastTimer = null
function showToast(message, type) {
  type = type || 'info'
  let el = document.getElementById('gesturo-toast')
  if (!el) {
    el = document.createElement('div')
    el.id = 'gesturo-toast'
    el.className = 'toast'
    document.body.appendChild(el)
  }
  clearTimeout(_toastTimer)
  el.textContent = message
  el.className = 'toast toast-' + type
  requestAnimationFrame(() => {
    el.classList.add('toast-visible')
  })
  _toastTimer = setTimeout(() => {
    el.classList.remove('toast-visible')
  }, 2500)
}
