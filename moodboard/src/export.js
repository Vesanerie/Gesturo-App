// PNG export: render photos + text into an offscreen canvas, then send
// the data URL to the main process which writes it via a save dialog.

async function exportPng() {
  if (!currentProject || photos.length === 0) { showToast('Rien à exporter'); return }
  showToast('Export en cours…')
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  photos.forEach(p => {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x + p.w); maxY = Math.max(maxY, p.y + p.h)
  })
  const pad = 40
  const W = Math.ceil(maxX - minX + pad * 2)
  const H = Math.ceil(maxY - minY + pad * 2)
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#0f0f0f'
  ctx.fillRect(0, 0, W, H)

  const sorted = [...photos].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0))
  for (const p of sorted) {
    ctx.save()
    const cx = p.x - minX + pad + p.w / 2
    const cy = p.y - minY + pad + p.h / 2
    ctx.translate(cx, cy)
    ctx.rotate(((p.rotation || 0) * Math.PI) / 180)
    ctx.globalAlpha = p.opacity != null ? p.opacity : 1
    if (p.type === 'text') {
      ctx.fillStyle = '#fff'
      ctx.font = `500 ${p.fontSize || 24}px -apple-system, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(p.text || '', 0, 0)
    } else {
      try {
        const img = await loadImg(p.src)
        if (p.flipped) ctx.scale(-1, 1)
        ctx.drawImage(img, -p.w / 2, -p.h / 2, p.w, p.h)
      } catch {}
    }
    ctx.restore()
  }
  const dataUrl = c.toDataURL('image/png')
  const savedPath = await window.electronAPI.savePng(currentProject.name, dataUrl)
  if (savedPath) showToast('PNG exporté')
}

function loadImg(src) {
  return new Promise((res, rej) => {
    const img = new Image()
    img.onload = () => res(img)
    img.onerror = rej
    img.src = src
  })
}
