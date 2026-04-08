// Right-side layers panel: lists all photos sorted by zIndex (front → back),
// click to select, syncs with selection state.

let layersVisible = false

function toggleLayersPanel() {
  layersVisible = !layersVisible
  document.getElementById('layers-panel').classList.toggle('visible', layersVisible)
  document.getElementById('btn-layers').classList.toggle('active', layersVisible)
  document.body.classList.toggle('layers-on', layersVisible)
  if (layersVisible) renderLayers()
}

function renderLayers() {
  if (!layersVisible) return
  const list = document.getElementById('lp-list')
  document.getElementById('lp-count').textContent = photos.length
  const sorted = [...photos].sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0))
  list.innerHTML = ''
  sorted.forEach(p => {
    const item = document.createElement('div')
    item.className = 'lp-item'
    if (selected && selected.id === p.id) item.classList.add('selected')
    if (multiSelected.includes(p)) item.classList.add('selected')
    if (p.locked) item.classList.add('locked')
    const thumb = p.type === 'text'
      ? `<div class="lp-thumb text">T</div>`
      : `<div class="lp-thumb"><img src="${p.src}" draggable="false"></div>`
    const name = p.type === 'text'
      ? (p.text || 'Texte').slice(0, 30)
      : (p.name || 'image').replace(/\.[^/.]+$/, '').slice(0, 30)
    item.innerHTML = `
      ${thumb}
      <div class="lp-name"></div>
      <div class="lp-lock">🔒</div>
    `
    item.querySelector('.lp-name').textContent = name
    item.onclick = () => {
      selectPhoto(p)
      // Center the camera on the selected photo
      const wR = wrap.getBoundingClientRect()
      panX = wR.width / 2 - (p.x + p.w / 2) * zoom
      panY = wR.height / 2 - (p.y + p.h / 2) * zoom
      applyView()
      renderLayers()
    }
    list.appendChild(item)
  })
}
