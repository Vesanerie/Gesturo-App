// Photo and text item creation, DOM mirror, and mutations.
// `photos` array is the source of truth — DOM elements are mirrored from it.

async function pickImages() {
  if (!window.electronAPI) return
  const files = await window.electronAPI.pickImages()
  for (const f of files) addPhotoFromPath(f.path, f.name)
}

async function addPhotoFromPath(filePath, name) {
  const dataUrl = await window.electronAPI.readFileAsDataUrl(filePath)
  addPhoto(dataUrl, name)
}

function addPhoto(src, name) {
  const img = new Image()
  img.onload = () => {
    // Auto-compress if data URL > ~2 MB
    if (src.startsWith('data:') && src.length > 2_700_000) {
      const max = 2000
      let tw = img.naturalWidth, th = img.naturalHeight
      if (tw > max || th > max) {
        const r = Math.min(max / tw, max / th)
        tw = Math.round(tw * r); th = Math.round(th * r)
      }
      const cv = document.createElement('canvas')
      cv.width = tw; cv.height = th
      cv.getContext('2d').drawImage(img, 0, 0, tw, th)
      src = cv.toDataURL('image/jpeg', 0.85)
      showToast('Image compressée')
    }
    const maxW = 340, maxH = 340
    let w = img.naturalWidth, h = img.naturalHeight
    if (w > maxW) { h = h * maxW / w; w = maxW }
    if (h > maxH) { w = w * maxH / h; h = maxH }
    const wR = wrap.getBoundingClientRect()
    const cx = (wR.width / 2 - panX) / zoom
    const cy = (wR.height / 2 - panY) / zoom
    const scatter = () => (Math.random() - 0.5) * 240
    const p = {
      id: ++idCounter, src, name,
      x: cx - w / 2 + scatter(), y: cy - h / 2 + scatter(),
      w, h, rotation: (Math.random() - 0.5) * 8,
      zIndex: idCounter, flipped: false
    }
    photos.push(p); createPhotoEl(p); updateCount()
    document.getElementById('empty-state').style.display = 'none'
    snapshot(); scheduleSave(); updateMinimap()
  }
  img.src = src
}

function createPhotoEl(p) {
  if (p.type === 'text') return createTextEl(p)
  if (p.type === 'note') return createNoteEl(p)
  const el = document.createElement('div')
  el.className = 'photo-item'; el.id = 'photo-' + p.id
  el.innerHTML = `
    <div class="connect-line"></div>
    <div class="photo-controls">
      <button class="pc-btn" title="Miroir" onclick="flipPhoto(${p.id})">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M8 8L4 12l4 4M16 8l4 4-4 4"/></svg>
      </button>
      <button class="pc-btn" title="Rotation 90°" onclick="rotatePhoto(${p.id})">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>
      </button>
      <button class="pc-btn" title="Style de cadre" onclick="cycleFrameStyle(${p.id})">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><rect x="7" y="7" width="10" height="10"/></svg>
      </button>
      <button class="pc-btn" title="Recadrer" onclick="startCrop(${p.id})">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/></svg>
      </button>
      <button class="pc-btn ${p.locked ? 'active' : ''}" title="Verrouiller" onclick="toggleLock(${p.id})">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">${p.locked ? '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>' : '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0"/>'}</svg>
      </button>
      <div class="pc-sep"></div>
      <div class="pc-opacity" title="Opacité">
        <input type="range" min="10" max="100" value="${Math.round((p.opacity != null ? p.opacity : 1) * 100)}" oninput="setOpacity(${p.id}, this.value)">
      </div>
      <div class="pc-sep"></div>
      <button class="pc-btn" title="Dupliquer" onclick="duplicatePhoto(${p.id})">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      </button>
      <div class="pc-sep"></div>
      <button class="pc-btn danger" title="Supprimer" onclick="deletePhoto(${p.id})">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
      </button>
    </div>
    <div class="photo-frame" style="width:${p.w}px;height:${p.h}px">
      <img src="${p.src}" draggable="false">
    </div>
    <div class="lock-badge">🔒</div>
    <div class="resize-handle rh-tl" data-corner="tl"></div>
    <div class="resize-handle rh-tr" data-corner="tr"></div>
    <div class="resize-handle rh-bl" data-corner="bl"></div>
    <div class="resize-handle rh-br" data-corner="br"></div>
    <div class="rotate-handle" title="Tourner (Shift = 15°)">↻</div>
  `
  el.addEventListener('mousedown', e => onPhotoMouseDown(e, p))
  el.querySelectorAll('.resize-handle').forEach(rh => {
    rh.addEventListener('mousedown', e => onResizeMouseDown(e, p, rh.dataset.corner))
  })
  el.querySelector('.rotate-handle').addEventListener('mousedown', e => onRotateMouseDown(e, p))
  canvas.appendChild(el); updatePhotoEl(p)
  if (typeof applyFrameStyle === 'function') applyFrameStyle(p)
}

function createTextEl(p) {
  const el = document.createElement('div')
  el.className = 'text-item photo-item'; el.id = 'photo-' + p.id
  el.style.fontSize = (p.fontSize || 24) + 'px'
  el.style.color = p.textColor || ''
  el.style.fontWeight = p.bold ? '700' : ''
  el.textContent = p.text || 'Texte'
  // Floating text controls
  const ctrl = document.createElement('div')
  ctrl.className = 'text-controls'
  ctrl.innerHTML = `
    <button class="pc-btn" title="Plus petit" data-act="smaller">A−</button>
    <button class="pc-btn" title="Plus grand" data-act="bigger">A+</button>
    <div class="pc-sep"></div>
    <button class="pc-btn" title="Gras" data-act="bold"><b>B</b></button>
    <div class="pc-sep"></div>
    <span class="tc-colors"></span>
  `
  const colors = ['#ffffff', '#1a1a1a', '#ff6b6b', '#ffd93d', '#6bd968', '#4ec9d4', '#6b8cff', '#b46bff']
  const cwrap = ctrl.querySelector('.tc-colors')
  colors.forEach(c => {
    const sw = document.createElement('span')
    sw.className = 'tc-swatch'; sw.style.background = c
    sw.onclick = (ev) => { ev.stopPropagation(); p.textColor = c; el.style.color = c; snapshot(); scheduleSave() }
    cwrap.appendChild(sw)
  })
  ctrl.querySelector('[data-act="smaller"]').onclick = (ev) => {
    ev.stopPropagation()
    p.fontSize = Math.max(8, (p.fontSize || 24) - 2)
    el.style.fontSize = p.fontSize + 'px'; measureTextItem(p); snapshot(); scheduleSave()
  }
  ctrl.querySelector('[data-act="bigger"]').onclick = (ev) => {
    ev.stopPropagation()
    p.fontSize = Math.min(200, (p.fontSize || 24) + 2)
    el.style.fontSize = p.fontSize + 'px'; measureTextItem(p); snapshot(); scheduleSave()
  }
  ctrl.querySelector('[data-act="bold"]').onclick = (ev) => {
    ev.stopPropagation()
    p.bold = !p.bold
    el.style.fontWeight = p.bold ? '700' : ''
    measureTextItem(p); snapshot(); scheduleSave()
  }
  el.appendChild(ctrl)
  el.addEventListener('mousedown', e => onPhotoMouseDown(e, p))
  el.addEventListener('dblclick', e => {
    e.stopPropagation()
    el.setAttribute('contenteditable', 'true')
    el.focus()
    const range = document.createRange()
    range.selectNodeContents(el)
    const sel = window.getSelection()
    sel.removeAllRanges(); sel.addRange(range)
  })
  el.addEventListener('blur', () => {
    el.removeAttribute('contenteditable')
    p.text = el.textContent
    const r = el.getBoundingClientRect()
    p.w = r.width / zoom; p.h = r.height / zoom
    snapshot(); scheduleSave()
  })
  canvas.appendChild(el); updatePhotoEl(p)
  measureTextItem(p)
}

function measureTextItem(p) {
  const el = document.getElementById('photo-' + p.id); if (!el) return
  const r = el.getBoundingClientRect()
  if (r.width && r.height) { p.w = r.width / zoom; p.h = r.height / zoom }
}

function updatePhotoEl(p) {
  const el = document.getElementById('photo-' + p.id); if (!el) return
  el.style.left = p.x + 'px'; el.style.top = p.y + 'px'
  el.style.transform = `rotate(${p.rotation || 0}deg)`
  el.style.zIndex = p.zIndex
  el.style.opacity = p.opacity != null ? p.opacity : 1
  el.classList.toggle('locked', !!p.locked)
  if (p.type === 'text') {
    el.style.fontSize = (p.fontSize || 24) + 'px'
    el.style.color = p.textColor || ''
    el.style.fontWeight = p.bold ? '700' : ''
    if (el.getAttribute('contenteditable') !== 'true') {
      const ctrl = el.querySelector('.text-controls')
      el.textContent = p.text || 'Texte'
      if (ctrl) el.appendChild(ctrl)
    }
    return
  }
  if (p.type === 'note') {
    el.style.width = p.w + 'px'; el.style.height = p.h + 'px'
    el.style.fontSize = (p.fontSize || 14) + 'px'
    el.style.background = p.color || '#ffe066'
    const span = el.querySelector('.note-text')
    if (span && span.getAttribute('contenteditable') !== 'true') span.textContent = p.text || 'Note'
    return
  }
  const frame = el.querySelector('.photo-frame')
  if (frame) {
    frame.style.width = p.w + 'px'; frame.style.height = p.h + 'px'
    el.querySelector('img').style.transform = p.flipped ? 'scaleX(-1)' : ''
  }
}

function setOpacity(id, val) {
  const p = photos.find(ph => ph.id === id); if (!p) return
  p.opacity = val / 100
  const el = document.getElementById('photo-' + p.id)
  if (el) el.style.opacity = p.opacity
  scheduleSave()
}

function bringToTop(p) {
  const maxZ = photos.reduce((m, ph) => Math.max(m, ph.zIndex), 0)
  p.zIndex = maxZ + 1; updatePhotoEl(p)
}

function bringForward(id) {
  const p = photos.find(ph => ph.id === id); if (!p) return
  p.zIndex++; updatePhotoEl(p)
}

function sendBackward(id) {
  const p = photos.find(ph => ph.id === id); if (!p) return
  p.zIndex = Math.max(1, p.zIndex - 1); updatePhotoEl(p)
}

function flipPhoto(id) {
  const p = photos.find(ph => ph.id === id); if (!p) return
  p.flipped = !p.flipped; updatePhotoEl(p)
}

function rotatePhoto(id) {
  const p = photos.find(ph => ph.id === id); if (!p) return
  p.rotation = ((p.rotation || 0) + 90) % 360; updatePhotoEl(p)
}

function duplicatePhoto(id) {
  const p = photos.find(ph => ph.id === id); if (!p) return
  const np = { ...p, id: ++idCounter, x: p.x + 24, y: p.y + 24, zIndex: idCounter }
  photos.push(np); createPhotoEl(np); selectPhoto(np); updateCount()
  snapshot(); scheduleSave(); updateMinimap()
}

function deletePhoto(id) {
  const idx = photos.findIndex(p => p.id === id); if (idx === -1) return
  const el = document.getElementById('photo-' + id)
  if (el) { el.style.opacity = '0'; el.style.transition = 'opacity 0.15s'; setTimeout(() => el.remove(), 150) }
  photos.splice(idx, 1)
  if (selected && selected.id === id) selected = null
  multiSelected = multiSelected.filter(p => p.id !== id)
  updateCount()
  if (photos.length === 0) document.getElementById('empty-state').style.display = 'block'
  scheduleSave()
}

function clearAll() {
  if (photos.length === 0) return
  if (!confirm('Vider tout le moodboard ?')) return
  photos.forEach(p => { const el = document.getElementById('photo-' + p.id); if (el) el.remove() })
  photos = []; selected = null; multiSelected = []; updateCount()
  document.getElementById('empty-state').style.display = 'block'
  snapshot(); scheduleSave(); updateMinimap()
}

function updateCount() {
  const n = photos.length
  document.getElementById('tb-count').textContent = n
}
