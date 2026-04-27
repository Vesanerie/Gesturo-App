
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

async function getImageSrc(entry) {
  if (entry.isR2) {
    if (window.__offlinePacks) {
      const local = window.__offlinePacks.resolveLocal(entry.path)
      if (local) return local
    }
    return entry.path
  }
  return 'file://' + entry.path
}

function preloadOneImage(entry) {
  return new Promise((resolve) => {
    if (!entry || entry.type === 'pdf') { resolve(); return }
    const key = entry.path
    if (imgCache.has(key)) { resolve(); return }
    if (entry.isR2) {
      const src = (window.__offlinePacks && window.__offlinePacks.resolveLocal(entry.path)) || entry.path
      const im = new Image()
      im.onload = () => { imgCache.set(key, src); if (imgCache.size > IMG_CACHE_MAX) { imgCache.delete(imgCache.keys().next().value) } resolve() }
      im.onerror = () => resolve()
      im.src = src
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
  else thumb = { data: entry.isR2 ? ((window.__offlinePacks && window.__offlinePacks.resolveLocal(entry.path)) || entry.path) : 'file://' + entry.path }
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

