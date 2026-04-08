// Canvas tools: text annotations, auto-grid, lock, align/distribute, crop.

function addTextItem(text) {
  if (!currentProject) return
  const wR = wrap.getBoundingClientRect()
  const cx = (wR.width / 2 - panX) / zoom
  const cy = (wR.height / 2 - panY) / zoom
  const p = {
    id: ++idCounter,
    type: 'text',
    text: text || 'Texte',
    x: cx - 60, y: cy - 20,
    w: 120, h: 40,
    rotation: 0,
    zIndex: idCounter,
    fontSize: 24,
  }
  photos.push(p); createPhotoEl(p); updateCount()
  document.getElementById('empty-state').style.display = 'none'
  snapshot(); scheduleSave()
  selectPhoto(p)
  updateMinimap()
}

function autoGridLayout() {
  if (photos.length === 0) return
  const imgs = photos.filter(p => p.type !== 'text')
  if (imgs.length === 0) return
  const cols = Math.ceil(Math.sqrt(imgs.length))
  const gap = 20
  const cellW = 300
  // Masonry: each column keeps its own running Y cursor; the next image
  // goes into the column with the smallest current Y so heights stay balanced.
  const colY = new Array(cols).fill(0)
  imgs.forEach(p => {
    const aspect = p.w / p.h
    p.w = cellW
    p.h = cellW / aspect
    p.rotation = 0
    let target = 0
    for (let c = 1; c < cols; c++) if (colY[c] < colY[target]) target = c
    p.x = target * (cellW + gap)
    p.y = colY[target]
    colY[target] += p.h + gap
    updatePhotoEl(p)
  })
  snapshot(); scheduleSave()
  fitAll()
  showToast('Photos arrangées en grille')
}

function toggleLock(id) {
  const p = photos.find(ph => ph.id === id); if (!p) return
  p.locked = !p.locked
  updatePhotoEl(p)
  const el = document.getElementById('photo-' + p.id)
  if (el) {
    const lockBtn = el.querySelector('.pc-btn[title="Verrouiller"]')
    if (lockBtn) {
      lockBtn.classList.toggle('active', p.locked)
      lockBtn.querySelector('svg').innerHTML = p.locked
        ? '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'
        : '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0"/>'
    }
  }
  snapshot(); scheduleSave()
  showToast(p.locked ? 'Photo verrouillée' : 'Photo déverrouillée')
}

function alignSelection(mode) {
  if (multiSelected.length < 2) return
  const movable = multiSelected.filter(p => !p.locked)
  if (movable.length < 2) return
  const gap = 16
  const isHorizontal = mode === 'left' || mode === 'right' || mode === 'hcenter'
  // Use the bounding box of the selection to anchor the line + starting offset
  const minX = Math.min(...movable.map(p => p.x))
  const maxX = Math.max(...movable.map(p => p.x + p.w))
  const minY = Math.min(...movable.map(p => p.y))
  const maxY = Math.max(...movable.map(p => p.y + p.h))

  if (isHorizontal) {
    // Stack vertically without overlap, in current visual order (top → bottom)
    const ordered = [...movable].sort((a, b) => a.y - b.y)
    let cursorY = minY
    ordered.forEach(p => {
      if (mode === 'left') p.x = minX
      else if (mode === 'right') p.x = maxX - p.w
      else p.x = (minX + maxX) / 2 - p.w / 2
      p.y = cursorY
      cursorY += p.h + gap
      updatePhotoEl(p)
    })
  } else {
    // Stack horizontally without overlap, in current visual order (left → right)
    const ordered = [...movable].sort((a, b) => a.x - b.x)
    let cursorX = minX
    ordered.forEach(p => {
      if (mode === 'top') p.y = minY
      else if (mode === 'bottom') p.y = maxY - p.h
      else p.y = (minY + maxY) / 2 - p.h / 2
      p.x = cursorX
      cursorX += p.w + gap
      updatePhotoEl(p)
    })
  }
  snapshot(); scheduleSave(); updateMinimap()
  showToast('Aligné sans chevauchement')
}

function distributeSelection(axis) {
  if (multiSelected.length < 3) { showToast('Sélectionne au moins 3 photos'); return }
  const movable = multiSelected.filter(p => !p.locked).slice()
  if (movable.length < 3) return
  if (axis === 'h') {
    movable.sort((a, b) => a.x - b.x)
    const first = movable[0], last = movable[movable.length - 1]
    const totalW = movable.reduce((s, p) => s + p.w, 0)
    const span = (last.x + last.w) - first.x
    const gap = (span - totalW) / (movable.length - 1)
    let cursor = first.x
    movable.forEach(p => { p.x = cursor; cursor += p.w + gap; updatePhotoEl(p) })
  } else {
    movable.sort((a, b) => a.y - b.y)
    const first = movable[0], last = movable[movable.length - 1]
    const totalH = movable.reduce((s, p) => s + p.h, 0)
    const span = (last.y + last.h) - first.y
    const gap = (span - totalH) / (movable.length - 1)
    let cursor = first.y
    movable.forEach(p => { p.y = cursor; cursor += p.h + gap; updatePhotoEl(p) })
  }
  snapshot(); scheduleSave(); updateMinimap()
  showToast('Distribué')
}

function updateAlignToolbar() {
  document.getElementById('align-group').classList.toggle('visible', multiSelected.length >= 2)
}

// ─── Crop tool ─────────────────────────────────────────────

function startCrop(id) {
  const p = photos.find(ph => ph.id === id); if (!p || p.type === 'text') return
  endCrop()
  const el = document.getElementById('photo-' + p.id)
  if (!el) return
  const frame = el.querySelector('.photo-frame')
  if (!frame) return
  const mask = document.createElement('div')
  mask.className = 'crop-mask'
  const box = document.createElement('div')
  box.className = 'crop-box'
  const inset = 0.1
  box.style.left = (p.w * inset) + 'px'
  box.style.top = (p.h * inset) + 'px'
  box.style.width = (p.w * (1 - inset * 2)) + 'px'
  box.style.height = (p.h * (1 - inset * 2)) + 'px'
  box.innerHTML = '<div class="ch ch-tl" data-c="tl"></div><div class="ch ch-tr" data-c="tr"></div><div class="ch ch-bl" data-c="bl"></div><div class="ch ch-br" data-c="br"></div>'
  const actions = document.createElement('div')
  actions.className = 'crop-actions'
  actions.innerHTML = '<button class="pc-btn" id="crop-ok">✓</button><button class="pc-btn danger" id="crop-cancel">✕</button>'
  frame.appendChild(mask)
  frame.appendChild(box)
  frame.appendChild(actions)

  cropState = { photo: p, box, mask, actions, frame }

  // Drag the box
  box.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('ch')) return
    e.stopPropagation()
    const startX = e.clientX, startY = e.clientY
    const ox = parseFloat(box.style.left), oy = parseFloat(box.style.top)
    const move = (ev) => {
      const dx = (ev.clientX - startX) / zoom
      const dy = (ev.clientY - startY) / zoom
      box.style.left = Math.max(0, Math.min(p.w - parseFloat(box.style.width), ox + dx)) + 'px'
      box.style.top = Math.max(0, Math.min(p.h - parseFloat(box.style.height), oy + dy)) + 'px'
    }
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up) }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  })
  // Resize handles
  box.querySelectorAll('.ch').forEach(h => {
    h.addEventListener('mousedown', (e) => {
      e.stopPropagation()
      const corner = h.dataset.c
      const startX = e.clientX, startY = e.clientY
      const ox = parseFloat(box.style.left), oy = parseFloat(box.style.top)
      const ow = parseFloat(box.style.width), oh = parseFloat(box.style.height)
      const move = (ev) => {
        const dx = (ev.clientX - startX) / zoom
        const dy = (ev.clientY - startY) / zoom
        let nx = ox, ny = oy, nw = ow, nh = oh
        if (corner.includes('r')) nw = Math.max(20, ow + dx)
        if (corner.includes('l')) { nw = Math.max(20, ow - dx); nx = ox + (ow - nw) }
        if (corner.includes('b')) nh = Math.max(20, oh + dy)
        if (corner.includes('t')) { nh = Math.max(20, oh - dy); ny = oy + (oh - nh) }
        nx = Math.max(0, Math.min(p.w - nw, nx))
        ny = Math.max(0, Math.min(p.h - nh, ny))
        nw = Math.min(nw, p.w - nx)
        nh = Math.min(nh, p.h - ny)
        box.style.left = nx + 'px'; box.style.top = ny + 'px'
        box.style.width = nw + 'px'; box.style.height = nh + 'px'
      }
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up) }
      document.addEventListener('mousemove', move)
      document.addEventListener('mouseup', up)
    })
  })
  document.getElementById('crop-ok').onclick = (e) => { e.stopPropagation(); applyCrop() }
  document.getElementById('crop-cancel').onclick = (e) => { e.stopPropagation(); endCrop() }
}

function endCrop() {
  if (!cropState) return
  cropState.box.remove(); cropState.mask.remove(); cropState.actions.remove()
  cropState = null
}

async function applyCrop() {
  if (!cropState) return
  const { photo: p, box } = cropState
  const cx = parseFloat(box.style.left)
  const cy = parseFloat(box.style.top)
  const cw = parseFloat(box.style.width)
  const ch = parseFloat(box.style.height)
  try {
    const img = await loadImg(p.src)
    const ratio = img.naturalWidth / p.w
    const sx = cx * ratio, sy = cy * ratio
    const sw = cw * ratio, sh = ch * ratio
    const c = document.createElement('canvas')
    c.width = sw; c.height = sh
    c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
    p.src = c.toDataURL('image/png')
    p.x += cx
    p.y += cy
    p.w = cw
    p.h = ch
    endCrop()
    const el = document.getElementById('photo-' + p.id)
    if (el) el.remove()
    createPhotoEl(p)
    selectPhoto(p)
    snapshot(); scheduleSave(); updateMinimap()
    showToast('Recadré')
  } catch (err) {
    console.error(err)
    showToast('Erreur de recadrage')
    endCrop()
  }
}
