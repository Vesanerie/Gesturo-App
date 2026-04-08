// Bottom-right minimap with viewport indicator and click-to-pan.

function toggleMinimap() {
  minimapVisible = !minimapVisible
  document.getElementById('minimap').classList.toggle('visible', minimapVisible)
  if (minimapVisible) updateMinimap()
}

let _mmRaf = 0
function updateMinimap() {
  if (!minimapVisible) return
  if (_mmRaf) return
  _mmRaf = requestAnimationFrame(() => { _mmRaf = 0; _drawMinimap() })
}
function _drawMinimap() {
  if (!minimapVisible) return
  const mm = document.getElementById('minimap-canvas')
  const ctx = mm.getContext('2d')
  const W = mm.width, H = mm.height
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = '#0a0a0a'
  ctx.fillRect(0, 0, W, H)
  if (photos.length === 0) return
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  photos.forEach(p => {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x + p.w); maxY = Math.max(maxY, p.y + p.h)
  })
  const wR = wrap.getBoundingClientRect()
  const vx1 = -panX / zoom, vy1 = -panY / zoom
  const vx2 = vx1 + wR.width / zoom, vy2 = vy1 + wR.height / zoom
  minX = Math.min(minX, vx1); minY = Math.min(minY, vy1)
  maxX = Math.max(maxX, vx2); maxY = Math.max(maxY, vy2)
  const bw = maxX - minX || 1, bh = maxY - minY || 1
  const scale = Math.min(W / bw, H / bh) * 0.9
  const ox = (W - bw * scale) / 2 - minX * scale
  const oy = (H - bh * scale) / 2 - minY * scale
  photos.forEach(p => {
    ctx.fillStyle = p.type === 'text' ? '#4ec9d4' : '#666'
    ctx.fillRect(ox + p.x * scale, oy + p.y * scale, Math.max(1, p.w * scale), Math.max(1, p.h * scale))
  })
  const vp = document.getElementById('minimap-viewport')
  vp.style.left = (ox + vx1 * scale) + 'px'
  vp.style.top = (oy + vy1 * scale) + 'px'
  vp.style.width = ((vx2 - vx1) * scale) + 'px'
  vp.style.height = ((vy2 - vy1) * scale) + 'px'
}

document.getElementById('minimap-canvas').addEventListener('click', (e) => {
  const r = e.currentTarget.getBoundingClientRect()
  const fx = (e.clientX - r.left) / r.width
  const fy = (e.clientY - r.top) / r.height
  if (photos.length === 0) return
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  photos.forEach(p => {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x + p.w); maxY = Math.max(maxY, p.y + p.h)
  })
  const wR = wrap.getBoundingClientRect()
  const tx = minX + (maxX - minX) * fx
  const ty = minY + (maxY - minY) * fy
  panX = wR.width / 2 - tx * zoom
  panY = wR.height / 2 - ty * zoom
  applyView(); updateMinimap()
})
