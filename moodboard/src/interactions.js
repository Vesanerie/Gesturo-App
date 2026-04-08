// Mouse interaction: pan, marquee selection, drag/resize/rotate, snap-to-edge.

function onCanvasMouseDown(e) {
  const isCanvas = e.target === canvas || e.target === wrap || e.target === gridBg || e.target === selRect
  if (!isCanvas && !isPanActive()) return

  if (e.button === 1 || (e.button === 0 && e.altKey) || e.button === 2 || (e.button === 0 && isPanActive())) {
    isPanning = true
    panStart = { x: e.clientX - panX, y: e.clientY - panY }
    wrap.classList.add('panning')
    e.preventDefault()
    return
  }

  if (e.button === 0) {
    if (photos.length === 0) {
      pickImages()
      return
    }
    deselectAll()
    const pos = screenToCanvas(e.clientX, e.clientY)
    selectionState = { startX: pos.x, startY: pos.y }
    selRect.style.display = 'block'
    selRect.style.left = pos.x + 'px'
    selRect.style.top = pos.y + 'px'
    selRect.style.width = '0px'
    selRect.style.height = '0px'
  }
}

document.addEventListener('mousemove', e => {
  if (isPanning) {
    panX = e.clientX - panStart.x
    panY = e.clientY - panStart.y
    applyView()
    updateMinimap()
    return
  }

  if (selectionState) {
    const pos = screenToCanvas(e.clientX, e.clientY)
    const x = Math.min(pos.x, selectionState.startX)
    const y = Math.min(pos.y, selectionState.startY)
    const w = Math.abs(pos.x - selectionState.startX)
    const h = Math.abs(pos.y - selectionState.startY)
    selRect.style.left = x + 'px'
    selRect.style.top = y + 'px'
    selRect.style.width = w + 'px'
    selRect.style.height = h + 'px'
    selectionState.x = x; selectionState.y = y
    selectionState.w = w; selectionState.h = h
    return
  }

  if (dragState) {
    const pos = screenToCanvas(e.clientX, e.clientY)
    const p = dragState.photo
    let targetX = pos.x - dragState.offX
    let targetY = pos.y - dragState.offY
    const dx = targetX - p.x
    const dy = targetY - p.y
    if (dragState.isMulti) {
      multiSelected.forEach(mp => { mp.x += dx; mp.y += dy; updatePhotoEl(mp) })
      clearSnapGuides()
    } else {
      p.x = targetX; p.y = targetY
      if (!e.altKey) {
        const snap = computeSnap(p)
        p.x += snap.dx; p.y += snap.dy
        showSnapGuides(snap.guides)
      } else {
        clearSnapGuides()
      }
      updatePhotoEl(p)
    }
    updateMinimap()
    return
  }

  if (resizeState) {
    const pos = screenToCanvas(e.clientX, e.clientY)
    const p = resizeState.photo
    const dx = pos.x - resizeState.startPos.x
    const dy = pos.y - resizeState.startPos.y
    const aspect = resizeState.origW / resizeState.origH
    const free = p.type === 'note'
    let nw = resizeState.origW, nh = resizeState.origH
    let nx = resizeState.origX, ny = resizeState.origY
    const c = resizeState.corner
    if (free) {
      if (c.includes('r')) nw = Math.max(60, resizeState.origW + dx)
      if (c.includes('l')) { nw = Math.max(60, resizeState.origW - dx); nx = resizeState.origX + resizeState.origW - nw }
      if (c.includes('b')) nh = Math.max(40, resizeState.origH + dy)
      if (c.includes('t')) { nh = Math.max(40, resizeState.origH - dy); ny = resizeState.origY + resizeState.origH - nh }
    } else if (c === 'br') { nw = Math.max(60, resizeState.origW + dx); nh = nw / aspect }
    else if (c === 'bl') { nw = Math.max(60, resizeState.origW - dx); nh = nw / aspect; nx = resizeState.origX + resizeState.origW - nw }
    else if (c === 'tr') { nh = Math.max(40, resizeState.origH - dy); nw = nh * aspect; ny = resizeState.origY + resizeState.origH - nh }
    else if (c === 'tl') { nh = Math.max(40, resizeState.origH - dy); nw = nh * aspect; nx = resizeState.origX + resizeState.origW - nw; ny = resizeState.origY + resizeState.origH - nh }
    p.w = nw; p.h = nh; p.x = nx; p.y = ny
    updatePhotoEl(p)
    return
  }

  if (rotateState) {
    const p = rotateState.photo
    const pos = screenToCanvas(e.clientX, e.clientY)
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2
    const angle = Math.atan2(pos.y - cy, pos.x - cx) * (180 / Math.PI) + 90
    p.rotation = angle - rotateState.startAngle + rotateState.origRot
    if (e.shiftKey) p.rotation = Math.round(p.rotation / 15) * 15
    updatePhotoEl(p)
  }
})

document.addEventListener('mouseup', () => {
  if (isPanning) {
    isPanning = false
    wrap.classList.remove('panning')
  }

  if (selectionState) {
    const { x, y, w, h } = selectionState
    if (w > 5 && h > 5) {
      multiSelected = photos.filter(p =>
        p.x + p.w > x && p.x < x + w &&
        p.y + p.h > y && p.y < y + h
      )
      multiSelected.forEach(p => {
        const el = document.getElementById('photo-' + p.id)
        if (el) el.classList.add('selected')
      })
      if (multiSelected.length === 1) {
        selected = multiSelected[0]
      }
      updateAlignToolbar()
    }
    selRect.style.display = 'none'
    selectionState = null
  }

  dragState = null
  resizeState = null
  rotateState = null
})

document.addEventListener('contextmenu', e => e.preventDefault())

function onPhotoMouseDown(e, p) {
  if (isPanActive()) {
    onCanvasMouseDown(e)
    return
  }
  const t = e.target
  if (t.tagName === 'INPUT' || t.closest('.pc-opacity') ||
      t.classList.contains('pc-btn') || t.classList.contains('resize-handle') ||
      t.classList.contains('rotate-handle') || t.classList.contains('pc-sep') ||
      t.classList.contains('connect-line')) return
  e.stopPropagation()

  const isAlreadyInMulti = multiSelected.includes(p)

  if (!isAlreadyInMulti) {
    selectPhoto(p)
  }

  if (p.locked) return
  bringToTop(p)
  const pos = screenToCanvas(e.clientX, e.clientY)
  dragState = {
    photo: p,
    offX: pos.x - p.x,
    offY: pos.y - p.y,
    isMulti: isAlreadyInMulti && multiSelected.length > 1
  }
}

function onResizeMouseDown(e, p, corner) {
  e.stopPropagation(); e.preventDefault()
  const pos = screenToCanvas(e.clientX, e.clientY)
  resizeState = { photo: p, corner, startPos: pos, origW: p.w, origH: p.h, origX: p.x, origY: p.y }
}

function onRotateMouseDown(e, p) {
  e.stopPropagation(); e.preventDefault()
  const pos = screenToCanvas(e.clientX, e.clientY)
  const cx = p.x + p.w / 2, cy = p.y + p.h / 2
  const startAngle = Math.atan2(pos.y - cy, pos.x - cx) * (180 / Math.PI) + 90
  rotateState = { photo: p, startAngle, origRot: p.rotation || 0 }
}

function selectPhoto(p) {
  deselectAll(); selected = p
  const el = document.getElementById('photo-' + p.id)
  if (el) el.classList.add('selected')
  updateAlignToolbar()
}

function deselectAll() {
  selected = null; multiSelected = []
  document.querySelectorAll('.photo-item.selected').forEach(el => el.classList.remove('selected'))
  updateAlignToolbar()
}

// Snap-to-edge while dragging a single photo
function computeSnap(p) {
  const guides = { h: [], v: [] }
  const others = photos.filter(o => o.id !== p.id && !multiSelected.includes(o))
  const edges = (o) => ({
    left: o.x, right: o.x + o.w, cx: o.x + o.w / 2,
    top: o.y, bottom: o.y + o.h, cy: o.y + o.h / 2,
  })
  const pe = edges(p)
  let dx = 0, dy = 0
  let bestX = SNAP_THRESHOLD / zoom, bestY = SNAP_THRESHOLD / zoom
  for (const o of others) {
    const oe = edges(o)
    ;[['left', 'left'], ['right', 'right'], ['cx', 'cx'], ['left', 'right'], ['right', 'left']].forEach(([a, b]) => {
      const d = oe[b] - pe[a]
      if (Math.abs(d) < bestX) { bestX = Math.abs(d); dx = d; guides.v.push(oe[b]) }
    })
    ;[['top', 'top'], ['bottom', 'bottom'], ['cy', 'cy'], ['top', 'bottom'], ['bottom', 'top']].forEach(([a, b]) => {
      const d = oe[b] - pe[a]
      if (Math.abs(d) < bestY) { bestY = Math.abs(d); dy = d; guides.h.push(oe[b]) }
    })
  }
  return { dx, dy, guides }
}

function showSnapGuides(guides) {
  clearSnapGuides()
  guides.v.forEach(x => {
    const g = document.createElement('div')
    g.className = 'snap-guide v'
    g.style.left = x + 'px'; g.style.top = '0'; g.style.height = '6000px'
    canvas.appendChild(g)
  })
  guides.h.forEach(y => {
    const g = document.createElement('div')
    g.className = 'snap-guide h'
    g.style.top = y + 'px'; g.style.left = '0'; g.style.width = '6000px'
    canvas.appendChild(g)
  })
}

function clearSnapGuides() {
  document.querySelectorAll('.snap-guide').forEach(el => el.remove())
}
