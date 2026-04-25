// ── Animation ── (extrait de app.js)

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
