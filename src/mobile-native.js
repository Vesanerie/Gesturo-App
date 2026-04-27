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
  const communityFeed = document.getElementById('community-feed')
  const communityOptions = document.getElementById('community-options')
  if (communityOptions) {
    let ptrStartY = 0, ptrActive = false
    const ptrEl = document.createElement('div')
    ptrEl.className = 'ptr-indicator'
    ptrEl.innerHTML = '<div class="ptr-spinner"></div> Actualiser'
    communityOptions.prepend(ptrEl)

    communityOptions.addEventListener('touchstart', (e) => {
      if (window.innerWidth > 1399) return
      if (communityOptions.scrollTop > 5) return
      ptrStartY = e.touches[0].clientY
      ptrActive = true
    }, { passive: true })

    communityOptions.addEventListener('touchmove', (e) => {
      if (!ptrActive) return
      const dy = e.touches[0].clientY - ptrStartY
      if (dy > 10 && communityOptions.scrollTop <= 0) {
        ptrEl.classList.add('pulling')
      }
    }, { passive: true })

    communityOptions.addEventListener('touchend', () => {
      if (!ptrActive) return
      ptrActive = false
      if (ptrEl.classList.contains('pulling')) {
        hapticMedium()
        if (typeof renderCommunity === 'function') renderCommunity(true)
        setTimeout(() => ptrEl.classList.remove('pulling'), 600)
      }
    }, { passive: true })
  }
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
