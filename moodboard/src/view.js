// Canvas view transform (zoom/pan), helpers, and drop overlay.

function applyView() {
  canvas.style.transform = `translate(${panX}px,${panY}px) scale(${zoom})`
  document.getElementById('zoom-display').textContent = Math.round(zoom * 100) + '%'
  if (gridVisible) {
    const big = 128 * zoom, small = 32 * zoom
    wrap.style.backgroundSize = `${big}px ${big}px, ${small}px ${small}px`
    wrap.style.backgroundPosition = `${panX}px ${panY}px, ${panX}px ${panY}px`
  }
  if (currentProject) scheduleSave()
}

function zoomBy(delta, cx, cy) {
  const wR = wrap.getBoundingClientRect()
  const ox = cx !== undefined ? cx : wR.width / 2
  const oy = cy !== undefined ? cy : wR.height / 2
  const newZoom = Math.max(0.04, Math.min(5, zoom + delta * zoom))
  const ratio = newZoom / zoom
  panX = ox - ratio * (ox - panX)
  panY = oy - ratio * (oy - panY)
  zoom = newZoom; applyView()
}

function resetZoom() { zoom = 1; panX = 0; panY = 0; applyView() }

function fitAll() {
  if (photos.length === 0) { resetZoom(); return }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  photos.forEach(p => {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x + p.w); maxY = Math.max(maxY, p.y + p.h)
  })
  const m = 80, wR = wrap.getBoundingClientRect()
  const fw = wR.width - m * 2, fh = wR.height - m * 2
  const cw = maxX - minX || 1, ch = maxY - minY || 1
  zoom = Math.min(5, Math.max(0.04, Math.min(fw / cw, fh / ch)))
  panX = m + (fw - cw * zoom) / 2 - minX * zoom
  panY = m + (fh - ch * zoom) / 2 - minY * zoom
  applyView()
}

function onWheel(e) {
  e.preventDefault()
  const wR = wrap.getBoundingClientRect()
  zoomBy(e.deltaY < 0 ? 0.1 : -0.1, e.clientX - wR.left, e.clientY - wR.top)
}

function screenToCanvas(sx, sy) {
  const wR = wrap.getBoundingClientRect()
  return { x: (sx - wR.left - panX) / zoom, y: (sy - wR.top - panY) / zoom }
}

function isPanActive() { return panTool || spaceHeld }

function togglePanTool() {
  panTool = !panTool
  document.getElementById('btn-pan').classList.toggle('active', panTool)
  wrap.classList.toggle('pan-mode', isPanActive())
}

function toggleGrid() {
  gridVisible = !gridVisible
  wrap.classList.toggle('grid-on', gridVisible)
  document.getElementById('btn-grid').classList.toggle('active', gridVisible)
  applyView()
}

// Drop overlay handlers (file drag from Finder)
function onDragOver(e) { e.preventDefault() }
function onDragEnter(e) { e.preventDefault(); document.getElementById('drop-overlay').classList.add('visible') }
function onDragLeave(e) {
  if (!wrap.contains(e.relatedTarget)) document.getElementById('drop-overlay').classList.remove('visible')
}
function onDrop(e) {
  e.preventDefault()
  document.getElementById('drop-overlay').classList.remove('visible')
  Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/')).forEach(f => {
    const reader = new FileReader()
    reader.onload = ev => addPhoto(ev.target.result, f.name)
    reader.readAsDataURL(f)
  })
}
