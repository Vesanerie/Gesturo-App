// ══════════════════════════════════════════════════════════════════
// OEUVRE DU JOUR — page contemplative
// ══════════════════════════════════════════════════════════════════

let _oeuvreData = null   // { current, archives }
let _oeuvreLoaded = false
let _oeuvreDetailsOpen = false
let _oeuvreArchivesOpen = false
let _oeuvreCardOpen = false
let _oeuvreBreathingOpen = false
let _oeuvreLongPressTimer = null

// ── Helpers ──

function _oeuvreFormatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const days = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi']
  const months = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre']
  return days[d.getDay()] + ' ' + d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear()
}

function _oeuvreShortDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear()
}

// ── Fetch ──

async function loadOeuvre() {
  if (_oeuvreLoaded) return
  _oeuvreLoaded = true
  try {
    const res = await window.electronAPI.getFeaturedPost()
    _oeuvreData = res || { current: null, archives: [] }
  } catch (e) {
    _oeuvreData = _oeuvreLoadCache()
  }
  if (_oeuvreData && _oeuvreData.current) {
    _oeuvreSaveCache(_oeuvreData.current)
  }
  _oeuvreRender()
}

function _oeuvreSaveCache(post) {
  try {
    localStorage.setItem('oeuvre_cache', JSON.stringify({
      post: post,
      ts: Date.now()
    }))
  } catch (e) { /* quota */ }
}

function _oeuvreLoadCache() {
  try {
    const raw = localStorage.getItem('oeuvre_cache')
    if (!raw) return null
    const cached = JSON.parse(raw)
    return { current: cached.post, archives: [] }
  } catch (e) { return null }
}

// ── Render ──

function _oeuvreRender() {
  const screen = document.getElementById('screen-oeuvre')
  if (!screen) return

  const dateEl = screen.querySelector('.oeuvre-date')
  const imgEl = screen.querySelector('.oeuvre-image')
  const titleEl = screen.querySelector('.oeuvre-title')
  const captionEl = screen.querySelector('.oeuvre-caption')
  const hintEl = screen.querySelector('.oeuvre-hint')
  const emptyEl = screen.querySelector('.oeuvre-empty')
  const infoEl = screen.querySelector('.oeuvre-info')
  const wrapEl = screen.querySelector('.oeuvre-image-wrap')

  if (!_oeuvreData || !_oeuvreData.current) {
    if (wrapEl) wrapEl.style.display = 'none'
    if (infoEl) infoEl.style.display = 'none'
    if (hintEl) hintEl.style.display = 'none'
    if (emptyEl) { emptyEl.style.display = 'block'; emptyEl.textContent = 'Aucune oeuvre mise en avant aujourd\'hui' }
    if (dateEl) dateEl.textContent = _oeuvreFormatDate(new Date().toISOString())
    return
  }

  const post = _oeuvreData.current
  if (emptyEl) emptyEl.style.display = 'none'
  if (wrapEl) wrapEl.style.display = 'flex'
  if (infoEl) infoEl.style.display = 'block'
  if (hintEl) hintEl.style.display = 'block'

  if (dateEl) dateEl.textContent = _oeuvreFormatDate(post.created_at)
  if (imgEl) {
    imgEl.src = post.image_url || ''
    imgEl.alt = post.display_name || 'Oeuvre du jour'
  }
  if (titleEl) titleEl.textContent = post.display_name || post.username || 'Artiste'
  if (captionEl) captionEl.textContent = post.caption || ''

  // Details panel
  _oeuvreRenderDetails(post)
  // Archives
  _oeuvreRenderArchives()
  // Card
  _oeuvreRenderCard(post)
}

function _oeuvreRenderDetails(post) {
  const panel = document.getElementById('oeuvre-details')
  if (!panel) return
  const body = panel.querySelector('.oeuvre-details-body')
  if (!body) return

  let html = ''
  if (post.technique) {
    html += '<div class="oeuvre-detail-row"><span class="oeuvre-detail-label">Technique</span><span class="oeuvre-detail-value">' + _escHtml(post.technique) + '</span></div>'
  }
  if (post.time_spent) {
    html += '<div class="oeuvre-detail-row"><span class="oeuvre-detail-label">Temps</span><span class="oeuvre-detail-value">' + _escHtml(post.time_spent) + '</span></div>'
  }
  if (post.inspirations) {
    html += '<div class="oeuvre-detail-row"><span class="oeuvre-detail-label">Inspirations</span><span class="oeuvre-detail-value">' + _escHtml(post.inspirations) + '</span></div>'
  }
  if (post.prep_sketches && post.prep_sketches.length > 0) {
    html += '<div class="oeuvre-detail-row"><span class="oeuvre-detail-label">Croquis</span></div>'
    html += '<div class="oeuvre-sketches">'
    post.prep_sketches.forEach(function(url) {
      html += '<img class="oeuvre-sketch-thumb" src="' + _escAttr(url) + '" alt="Croquis">'
    })
    html += '</div>'
  }
  if (!html) {
    html = '<div class="oeuvre-detail-row"><span class="oeuvre-detail-value" style="color:#4a5870;">Pas de details supplementaires</span></div>'
  }
  body.innerHTML = html
}

function _oeuvreRenderArchives() {
  const grid = document.querySelector('.oeuvre-archives-grid')
  if (!grid) return
  const archives = (_oeuvreData && _oeuvreData.archives) || []
  if (archives.length === 0) {
    grid.innerHTML = '<div style="text-align:center;color:#4a5870;font-size:13px;padding:40px 0;">Pas encore d\'archives</div>'
    return
  }
  let html = ''
  archives.forEach(function(a) {
    html += '<div class="oeuvre-archive-card" data-id="' + a.id + '">'
    html += '<img src="' + _escAttr(a.image_url) + '" alt="' + _escAttr(a.display_name || '') + '" loading="lazy">'
    html += '<div class="archive-date">' + _oeuvreShortDate(a.created_at) + '</div>'
    html += '</div>'
  })
  grid.innerHTML = html

  grid.querySelectorAll('.oeuvre-archive-card').forEach(function(card) {
    card.addEventListener('click', function() {
      const id = card.dataset.id
      const post = archives.find(function(a) { return String(a.id) === id })
      if (post) _oeuvreShowArchivePost(post)
    })
  })
}

function _oeuvreShowArchivePost(post) {
  _oeuvreCloseArchives()
  // Temporarily display this post
  const screen = document.getElementById('screen-oeuvre')
  if (!screen) return
  const dateEl = screen.querySelector('.oeuvre-date')
  const imgEl = screen.querySelector('.oeuvre-image')
  const titleEl = screen.querySelector('.oeuvre-title')
  const captionEl = screen.querySelector('.oeuvre-caption')
  const wrapEl = screen.querySelector('.oeuvre-image-wrap')
  const infoEl = screen.querySelector('.oeuvre-info')
  const emptyEl = screen.querySelector('.oeuvre-empty')
  if (emptyEl) emptyEl.style.display = 'none'
  if (wrapEl) wrapEl.style.display = 'flex'
  if (infoEl) infoEl.style.display = 'block'
  if (dateEl) dateEl.textContent = _oeuvreFormatDate(post.created_at)
  if (imgEl) { imgEl.src = post.image_url || ''; imgEl.alt = post.display_name || '' }
  if (titleEl) titleEl.textContent = post.display_name || post.username || 'Artiste'
  if (captionEl) captionEl.textContent = post.caption || ''
}

function _oeuvreRenderCard(post) {
  const card = document.querySelector('.oeuvre-collect-card')
  if (!card) return
  const imgEl = card.querySelector('.oeuvre-card-image img')
  const artistEl = card.querySelector('.oeuvre-card-artist')
  const dateEl = card.querySelector('.oeuvre-card-date')
  const numEl = card.querySelector('.oeuvre-card-number')

  if (imgEl) imgEl.src = post.image_url || ''
  if (artistEl) artistEl.textContent = post.display_name || post.username || 'Artiste'
  if (dateEl) dateEl.textContent = _oeuvreFormatDate(post.created_at)
  if (numEl) numEl.textContent = '#' + (post.id || '?')
}

// ── Gestures ──

function _oeuvreOpenDetails() {
  if (_oeuvreDetailsOpen) return
  _oeuvreDetailsOpen = true
  const panel = document.getElementById('oeuvre-details')
  if (panel) panel.classList.add('open')
}

function _oeuvreCloseDetails() {
  _oeuvreDetailsOpen = false
  const panel = document.getElementById('oeuvre-details')
  if (panel) panel.classList.remove('open')
}

function _oeuvreOpenArchives() {
  if (_oeuvreArchivesOpen) return
  _oeuvreArchivesOpen = true
  const el = document.getElementById('oeuvre-archives')
  if (el) el.classList.add('open')
}

function _oeuvreCloseArchives() {
  _oeuvreArchivesOpen = false
  const el = document.getElementById('oeuvre-archives')
  if (el) el.classList.remove('open')
}

function _oeuvreOpenCard() {
  if (_oeuvreCardOpen || !_oeuvreData || !_oeuvreData.current) return
  _oeuvreCardOpen = true
  const el = document.getElementById('oeuvre-card-overlay')
  if (el) el.classList.add('open')
}

function _oeuvreCloseCard() {
  _oeuvreCardOpen = false
  const el = document.getElementById('oeuvre-card-overlay')
  if (el) el.classList.remove('open')
}

function _oeuvreOpenBreathing() {
  if (_oeuvreBreathingOpen || !_oeuvreData || !_oeuvreData.current) return
  _oeuvreBreathingOpen = true
  const el = document.getElementById('oeuvre-breathing')
  if (!el) return
  const img = el.querySelector('img')
  if (img) img.src = _oeuvreData.current.image_url || ''
  el.classList.add('open')
}

function _oeuvreCloseBreathing() {
  _oeuvreBreathingOpen = false
  const el = document.getElementById('oeuvre-breathing')
  if (el) el.classList.remove('open')
}

// ── Swipe detection ──

let _oeuvreTouchStartX = 0
let _oeuvreTouchStartY = 0
let _oeuvreTouchStartTime = 0

function _oeuvreOnTouchStart(e) {
  if (_oeuvreDetailsOpen || _oeuvreArchivesOpen || _oeuvreCardOpen || _oeuvreBreathingOpen) return
  const t = e.touches[0]
  _oeuvreTouchStartX = t.clientX
  _oeuvreTouchStartY = t.clientY
  _oeuvreTouchStartTime = Date.now()

  // Long press
  _oeuvreLongPressTimer = setTimeout(function() {
    _oeuvreOpenBreathing()
  }, 600)
}

function _oeuvreOnTouchMove(e) {
  if (_oeuvreLongPressTimer) {
    const t = e.touches[0]
    const dx = Math.abs(t.clientX - _oeuvreTouchStartX)
    const dy = Math.abs(t.clientY - _oeuvreTouchStartY)
    if (dx > 10 || dy > 10) {
      clearTimeout(_oeuvreLongPressTimer)
      _oeuvreLongPressTimer = null
    }
  }
}

function _oeuvreOnTouchEnd(e) {
  if (_oeuvreLongPressTimer) {
    clearTimeout(_oeuvreLongPressTimer)
    _oeuvreLongPressTimer = null
  }
  if (_oeuvreBreathingOpen || _oeuvreDetailsOpen || _oeuvreArchivesOpen || _oeuvreCardOpen) return
  if (!e.changedTouches || !e.changedTouches[0]) return

  const t = e.changedTouches[0]
  const dx = t.clientX - _oeuvreTouchStartX
  const dy = t.clientY - _oeuvreTouchStartY
  const elapsed = Date.now() - _oeuvreTouchStartTime
  const absDx = Math.abs(dx)
  const absDy = Math.abs(dy)

  // Minimum swipe distance
  if (elapsed > 500) return
  if (absDx < 40 && absDy < 40) return

  if (absDy > absDx) {
    // Vertical swipe
    if (dy < -40) _oeuvreOpenDetails()    // Swipe up → details
    if (dy > 40) _oeuvreOpenArchives()    // Swipe down → archives
  } else {
    // Horizontal swipe
    if (dx < -40) _oeuvreOpenCard()       // Swipe left → carte
  }
}

// ── Escape helpers ──

function _escHtml(s) {
  var d = document.createElement('div')
  d.textContent = s
  return d.innerHTML
}

function _escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ── Sub-tabs ──

let _oeuvreTab = 'jour'

function _switchOeuvreTab(tab) {
  if (_oeuvreTab === tab) return
  _oeuvreTab = tab
  document.getElementById('otab-jour').classList.toggle('active', tab === 'jour')
  document.getElementById('otab-mine').classList.toggle('active', tab === 'mine')
  document.getElementById('oeuvre-jour-view').style.display = tab === 'jour' ? '' : 'none'
  document.getElementById('oeuvre-mine-view').style.display = tab === 'mine' ? '' : 'none'
  if (tab === 'mine') {
    renderMyPosts('oeuvre-mine-grid', 'oeuvre-mine-empty')
  }
}

// ── Init ──

function _initOeuvreListeners() {
  var screen = document.getElementById('screen-oeuvre')
  if (!screen) return

  // Sub-tabs
  document.getElementById('otab-jour').addEventListener('click', function() { _switchOeuvreTab('jour') })
  document.getElementById('otab-mine').addEventListener('click', function() { _switchOeuvreTab('mine') })

  // Touch gestures on main screen area
  var mainArea = screen.querySelector('.oeuvre-main')
  if (mainArea) {
    mainArea.addEventListener('touchstart', _oeuvreOnTouchStart, { passive: true })
    mainArea.addEventListener('touchmove', _oeuvreOnTouchMove, { passive: true })
    mainArea.addEventListener('touchend', _oeuvreOnTouchEnd)
  }

  // Close details on handle tap or swipe down
  var details = document.getElementById('oeuvre-details')
  if (details) {
    var handle = details.querySelector('.oeuvre-details-handle')
    if (handle) handle.addEventListener('click', _oeuvreCloseDetails)
  }

  // Archives back button
  var archBack = document.querySelector('.oeuvre-archives-back')
  if (archBack) archBack.addEventListener('click', function() {
    _oeuvreCloseArchives()
    // Restore current post
    if (_oeuvreData && _oeuvreData.current) _oeuvreRender()
  })

  // Card overlay close on tap
  var cardOverlay = document.getElementById('oeuvre-card-overlay')
  if (cardOverlay) cardOverlay.addEventListener('click', _oeuvreCloseCard)

  // Breathing close on tap
  var breathing = document.getElementById('oeuvre-breathing')
  if (breathing) breathing.addEventListener('click', _oeuvreCloseBreathing)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initOeuvreListeners)
} else {
  _initOeuvreListeners()
}
