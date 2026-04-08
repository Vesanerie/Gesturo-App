// Theme, notes, frame styles, guides, search, groups, PDF export.

// ─── Onboarding ──────────────────────────────────────────
function maybeShowOnboarding() {
  try {
    if (localStorage.getItem('moodboard-onboarded')) return
  } catch {}
  document.getElementById('onboarding').classList.add('visible')
}
function dismissOnboarding() {
  document.getElementById('onboarding').classList.remove('visible')
  try { localStorage.setItem('moodboard-onboarded', '1') } catch {}
}

// ─── Trash drop zone ─────────────────────────────────────
let _trashHover = false
function _trashTick() {
  const tz = document.getElementById('trash-zone'); if (!tz) return
  if (typeof dragState !== 'undefined' && dragState) {
    tz.classList.add('visible')
  } else if (tz.classList.contains('visible')) {
    if (_trashHover) {
      const list = (typeof multiSelected !== 'undefined' && multiSelected.length) ? [...multiSelected]
        : (typeof selected !== 'undefined' && selected ? [selected] : [])
      list.forEach(p => deletePhoto(p.id))
      if (list.length) showToast(list.length + ' supprimé' + (list.length > 1 ? 's' : ''))
    }
    tz.classList.remove('visible'); tz.classList.remove('hover'); _trashHover = false
  }
  requestAnimationFrame(_trashTick)
}
function initTrashZone() {
  const tz = document.getElementById('trash-zone'); if (!tz) return
  tz.addEventListener('mouseenter', () => { _trashHover = true; tz.classList.add('hover') })
  tz.addEventListener('mouseleave', () => { _trashHover = false; tz.classList.remove('hover') })
  requestAnimationFrame(_trashTick)
}

// ─── Toolbar menus ───────────────────────────────────────
function toggleAlignMenu(e) {
  if (e) e.stopPropagation()
  const m = document.getElementById('align-menu')
  closeMenus(); m.classList.add('visible')
}
function toggleExportMenu(e) {
  if (e) e.stopPropagation()
  const m = document.getElementById('export-menu')
  m.classList.toggle('visible')
}
function closeMenus() {
  document.querySelectorAll('.tb-menu-pop.visible').forEach(m => m.classList.remove('visible'))
}
document.addEventListener('mousedown', (e) => {
  if (!e.target.closest('.tb-menu')) closeMenus()
})

// ─── Theme ───────────────────────────────────────────────
function toggleTheme() {
  lightMode = !lightMode
  document.body.classList.toggle('light', lightMode)
  document.getElementById('btn-theme').classList.toggle('active', lightMode)
  try { localStorage.setItem('moodboard-theme', lightMode ? 'light' : 'dark') } catch {}
}
function loadTheme() {
  try {
    if (localStorage.getItem('moodboard-theme') === 'light') {
      lightMode = true
      document.body.classList.add('light')
      const btn = document.getElementById('btn-theme')
      if (btn) btn.classList.add('active')
    }
  } catch {}
}

// ─── Notes (post-it) ─────────────────────────────────────
const NOTE_COLORS = ['#ffe066', '#ffb3ba', '#bae1ff', '#baffc9', '#ffdfba', '#e0baff']

function addNoteItem() {
  if (!currentProject) return
  const wR = wrap.getBoundingClientRect()
  const cx = (wR.width / 2 - panX) / zoom
  const cy = (wR.height / 2 - panY) / zoom
  const p = {
    id: ++idCounter, type: 'note', text: 'Note',
    x: cx - 90, y: cy - 60, w: 180, h: 120,
    rotation: (Math.random() - 0.5) * 4,
    zIndex: idCounter, fontSize: 14,
    color: NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)],
  }
  photos.push(p); createPhotoEl(p); updateCount()
  document.getElementById('empty-state').style.display = 'none'
  snapshot(); scheduleSave(); selectPhoto(p); updateMinimap()
}

function createNoteEl(p) {
  const el = document.createElement('div')
  el.className = 'note-item photo-item'; el.id = 'photo-' + p.id
  el.style.background = p.color || '#ffe066'
  el.style.fontSize = (p.fontSize || 14) + 'px'
  const span = document.createElement('span')
  span.className = 'note-text'
  span.textContent = p.text || 'Note'
  el.appendChild(span)
  ;['tl','tr','bl','br'].forEach(c => {
    const rh = document.createElement('div')
    rh.className = 'resize-handle rh-' + c
    rh.dataset.corner = c
    rh.addEventListener('mousedown', e => onResizeMouseDown(e, p, c))
    el.appendChild(rh)
  })
  el.addEventListener('mousedown', e => onPhotoMouseDown(e, p))
  span.addEventListener('dblclick', e => {
    e.stopPropagation()
    span.setAttribute('contenteditable', 'true')
    span.focus()
    const range = document.createRange(); range.selectNodeContents(span)
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range)
  })
  span.addEventListener('blur', () => {
    span.removeAttribute('contenteditable')
    p.text = span.textContent
    snapshot(); scheduleSave()
  })
  el.addEventListener('contextmenu', e => {
    e.preventDefault(); e.stopPropagation()
    cycleNoteColor(p)
  })
  canvas.appendChild(el); updatePhotoEl(p)
}

function cycleNoteColor(p) {
  const i = NOTE_COLORS.indexOf(p.color)
  p.color = NOTE_COLORS[(i + 1) % NOTE_COLORS.length]
  const el = document.getElementById('photo-' + p.id)
  if (el) el.style.background = p.color
  snapshot(); scheduleSave()
}

// ─── Frame styles for photos ─────────────────────────────
const FRAME_STYLES = ['none', 'polaroid', 'shadow', 'border', 'soft']

function cycleFrameStyle(id) {
  const p = photos.find(ph => ph.id === id); if (!p || p.type) return
  const i = FRAME_STYLES.indexOf(p.frame || 'none')
  p.frame = FRAME_STYLES[(i + 1) % FRAME_STYLES.length]
  applyFrameStyle(p)
  snapshot(); scheduleSave()
  showToast('Cadre : ' + p.frame)
}
function applyFrameStyle(p) {
  const el = document.getElementById('photo-' + p.id); if (!el) return
  const frame = el.querySelector('.photo-frame'); if (!frame) return
  FRAME_STYLES.forEach(s => frame.classList.remove('fr-' + s))
  if (p.frame && p.frame !== 'none') frame.classList.add('fr-' + p.frame)
}

// ─── Guides ──────────────────────────────────────────────
function addGuide(axis) {
  const wR = wrap.getBoundingClientRect()
  const cx = (wR.width / 2 - panX) / zoom
  const cy = (wR.height / 2 - panY) / zoom
  const g = { id: ++guideIdCounter, axis, pos: axis === 'h' ? cy : cx }
  guides.push(g)
  renderGuides()
  scheduleSave()
}
function renderGuides() {
  const layer = document.getElementById('guides-layer')
  if (!layer) return
  layer.innerHTML = ''
  guides.forEach(g => {
    const el = document.createElement('div')
    el.className = 'guide-line ' + g.axis
    if (g.axis === 'h') el.style.top = g.pos + 'px'
    else el.style.left = g.pos + 'px'
    const del = document.createElement('div')
    del.className = 'guide-del'; del.textContent = '✕'
    del.onclick = (e) => { e.stopPropagation(); removeGuide(g.id) }
    el.appendChild(del)
    el.addEventListener('mousedown', (e) => {
      if (e.target === del) return
      e.stopPropagation()
      const start = g.axis === 'h' ? e.clientY : e.clientX
      const orig = g.pos
      const move = (ev) => {
        const cur = g.axis === 'h' ? ev.clientY : ev.clientX
        g.pos = orig + (cur - start) / zoom
        if (g.axis === 'h') el.style.top = g.pos + 'px'
        else el.style.left = g.pos + 'px'
      }
      const up = () => {
        document.removeEventListener('mousemove', move)
        document.removeEventListener('mouseup', up)
        scheduleSave()
      }
      document.addEventListener('mousemove', move)
      document.addEventListener('mouseup', up)
    })
    layer.appendChild(el)
  })
}
function removeGuide(id) {
  guides = guides.filter(g => g.id !== id)
  renderGuides(); scheduleSave()
}

// ─── Search ──────────────────────────────────────────────
function openSearch() {
  searchOpen = true
  document.getElementById('search-overlay').classList.add('visible')
  setTimeout(() => { const i = document.getElementById('search-input'); i.focus(); i.select() }, 50)
}
function closeSearch() {
  searchOpen = false
  document.getElementById('search-overlay').classList.remove('visible')
  document.getElementById('search-input').value = ''
  document.getElementById('search-count').textContent = ''
  document.querySelectorAll('.search-hit').forEach(el => el.classList.remove('search-hit'))
}
function runSearch(q) {
  document.querySelectorAll('.search-hit').forEach(el => el.classList.remove('search-hit'))
  const query = (q || '').trim().toLowerCase()
  const countEl = document.getElementById('search-count')
  if (!query) { countEl.textContent = ''; return }
  let hits = []
  photos.forEach(p => {
    const hay = ((p.text || '') + ' ' + (p.name || '')).toLowerCase()
    if (hay.includes(query)) {
      hits.push(p)
      const el = document.getElementById('photo-' + p.id)
      if (el) el.classList.add('search-hit')
    }
  })
  countEl.textContent = hits.length + ' résultat' + (hits.length > 1 ? 's' : '')
  if (hits.length) zoomToItem(hits[0])
}
function zoomToItem(p) {
  const wR = wrap.getBoundingClientRect()
  panX = wR.width / 2 - (p.x + p.w / 2) * zoom
  panY = wR.height / 2 - (p.y + p.h / 2) * zoom
  applyView()
}

// ─── Groups ──────────────────────────────────────────────
function openGroupsPanel() {
  document.getElementById('groups-panel').classList.add('visible')
  renderGroupsList()
}
function closeGroupsPanel() {
  document.getElementById('groups-panel').classList.remove('visible')
}
function renderGroupsList() {
  const list = document.getElementById('gp-list')
  if (!list) return
  list.innerHTML = ''
  if (!groups.length) {
    list.innerHTML = '<div style="padding:8px 12px;font-size:11px;color:#555">Aucun groupe. Sélectionne des éléments puis crée un groupe.</div>'
    return
  }
  groups.forEach(g => {
    const item = document.createElement('div')
    item.className = 'gp-item'
    const inp = document.createElement('input')
    inp.value = g.name
    inp.onchange = () => { g.name = inp.value; scheduleSave() }
    inp.onclick = e => e.stopPropagation()
    const cnt = document.createElement('span')
    cnt.className = 'gp-count'; cnt.textContent = g.itemIds.length
    const lock = document.createElement('span')
    lock.className = 'gp-lock'; lock.textContent = g.locked ? '🔒' : '🔓'
    lock.title = g.locked ? 'Déverrouiller' : 'Verrouiller'
    lock.onclick = e => { e.stopPropagation(); toggleGroupLock(g); renderGroupsList() }
    const del = document.createElement('span')
    del.className = 'gp-del'; del.textContent = '✕'
    del.onclick = e => { e.stopPropagation(); groups = groups.filter(x => x !== g); renderGroupsList(); scheduleSave() }
    item.appendChild(inp); item.appendChild(cnt); item.appendChild(lock); item.appendChild(del)
    item.onclick = () => selectGroup(g)
    list.appendChild(item)
  })
}

function toggleGroupLock(g) {
  g.locked = !g.locked
  photos.forEach(p => {
    if (g.itemIds.includes(p.id)) {
      p.locked = g.locked
      updatePhotoEl(p)
    }
  })
  snapshot(); scheduleSave()
  showToast(g.locked ? 'Groupe verrouillé' : 'Groupe déverrouillé')
}
function createGroupFromSelection() {
  const sel = multiSelected.length ? multiSelected : (selected ? [selected] : [])
  if (!sel.length) { showToast('Sélectionne d\'abord'); return }
  groups.push({ id: Date.now(), name: 'Groupe ' + (groups.length + 1), itemIds: sel.map(p => p.id) })
  renderGroupsList(); scheduleSave()
  showToast('Groupe créé')
}
function selectGroup(g) {
  deselectAll()
  multiSelected = photos.filter(p => g.itemIds.includes(p.id))
  multiSelected.forEach(p => {
    const el = document.getElementById('photo-' + p.id)
    if (el) el.classList.add('selected')
  })
  if (typeof updateAlignToolbar === 'function') updateAlignToolbar()
}

// ─── PDF Export ──────────────────────────────────────────
async function exportPdf() {
  if (!currentProject || photos.length === 0) { showToast('Rien à exporter'); return }
  showToast('Export PDF…')
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
  ctx.fillStyle = lightMode ? '#ffffff' : '#0f0f0f'
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
      ctx.fillStyle = lightMode ? '#111' : '#fff'
      ctx.font = `500 ${p.fontSize || 24}px -apple-system, sans-serif`
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(p.text || '', 0, 0)
    } else if (p.type === 'note') {
      ctx.fillStyle = p.color || '#ffe066'
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
      ctx.fillStyle = '#1a1a1a'
      ctx.font = `500 ${p.fontSize || 14}px -apple-system, sans-serif`
      ctx.textAlign = 'left'; ctx.textBaseline = 'top'
      wrapText(ctx, p.text || '', -p.w / 2 + 16, -p.h / 2 + 16, p.w - 32, (p.fontSize || 14) * 1.4)
    } else {
      try {
        const img = await loadImg(p.src)
        if (p.flipped) ctx.scale(-1, 1)
        ctx.drawImage(img, -p.w / 2, -p.h / 2, p.w, p.h)
      } catch {}
    }
    ctx.restore()
  }
  const jpegDataUrl = c.toDataURL('image/jpeg', 0.92)
  const savedPath = await window.electronAPI.savePdf(currentProject.name, jpegDataUrl, W, H)
  if (savedPath) showToast('PDF exporté')
}

function wrapText(ctx, text, x, y, maxW, lineH) {
  const words = String(text).split(/\s+/)
  let line = ''
  for (const w of words) {
    const test = line ? line + ' ' + w : w
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y); y += lineH; line = w
    } else line = test
  }
  if (line) ctx.fillText(line, x, y)
}
