pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'

// ══ STATE ══
let currentRotation = 0
let currentFlipH = false
let currentBW = false
let allEntries = [], categories = {}, sequences = {}
let selectedCats = new Set()
let selectedSeq = null
let sessionEntries = [], sessionLog = []
let currentIndex = 0, timerDuration = 30, timeLeft = 30
let paused = false, ticker = null, loading = false
let currentSubMode = 'custom', mainMode = 'pose'

const PROGRESSIVE_PHASES = [
  { duration: 30, count: 10, label: '30 sec' },
  { duration: 60, count: 5,  label: '1 min' },
  { duration: 120, count: 5, label: '2 min' },
  { duration: 300, count: 2, label: '5 min' }
]
let progressiveQueue = []

// ══ ANIMATION STATE ══
let animFrames = []
let animNavPath = []
let animIndex = 0
let animLooping = false
let animInterval = null
let animStudyMode = false
let isR2Mode = false
let currentUserIsPro = false
let studyTimeLeft = 30, studyDuration = 30, studyTicker = null

// ══ AUDIO ══
let audioCtx = null
function beep(freq, dur, vol) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)()
    const o = audioCtx.createOscillator(), g = audioCtx.createGain()
    o.connect(g); g.connect(audioCtx.destination)
    o.frequency.value = freq
    g.gain.setValueAtTime(vol, audioCtx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur)
    o.start(); o.stop(audioCtx.currentTime + dur)
  } catch(e) {}
}
function soundWarning() { beep(880, 0.15, 0.3) }
function soundNext() { beep(440, 0.3, 0.4); setTimeout(() => beep(550, 0.3, 0.3), 150) }

// ══ INIT ══
window.addEventListener('DOMContentLoaded', () => {
  if (window.electronAPI?.authCheck) {
    window.electronAPI.authCheck().then(result => {
      if (result.authenticated && result.isAdmin) {
        document.getElementById('admin-source-card').style.display = 'block'
      }
    })
  }
  renderWeekBar()
  document.getElementById('options-btn').style.display = 'flex'
  document.getElementById('discord-btn').style.display = 'flex'

  if (window.electronAPI?.onAuthRequired) {
    if (window.electronAPI?.onAuthSuccess) {
      window.electronAPI.onAuthSuccess((user) => {
        if (user.isAdmin) document.getElementById('admin-source-card').style.display = 'block'
      })
    }
    window.electronAPI.onAuthRequired(() => {
      document.getElementById('options-btn').style.display = 'none'
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'))
      const div = document.createElement('div')
      div.id = 'screen-login'
      div.style.cssText = 'position:fixed;inset:0;background:#111;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;'
      div.innerHTML = `
        <h2 style="color:#fff;font-size:20px;">Gesturo</h2>
        <p style="color:#555;font-size:14px;">Vous avez été déconnecté</p>
        <button id="btn-google-login" style="background:#fff;color:#111;border:none;border-radius:10px;padding:12px 28px;font-size:15px;font-weight:600;cursor:pointer;">Se connecter avec Google</button>
      `
      document.body.appendChild(div)
      document.getElementById('btn-google-login').addEventListener('click', () => {
        window.electronAPI.authGoogle().then(result => {
          if (result?.success) location.reload()
          else alert('Connexion échouée : ' + (result?.message || result?.reason || 'inconnu'))
        }).catch(e => alert('Erreur : ' + e.message))
      })
    })
  }

  function initAutoLoad() {
    if (!window.electronAPI) { setTimeout(initAutoLoad, 100); return }
    window.electronAPI.onUseR2Mode(({ isPro }) => {
      isR2Mode = true
      currentUserIsPro = isPro
      const badge = document.getElementById('plan-badge')
      if (badge) {
        badge.style.display = 'flex'
        if (isPro) {
          badge.textContent = '⭐ PRO'
          badge.style.background = 'rgba(240,192,64,0.15)'
          badge.style.border = '0.5px solid #f0c040'
          badge.style.color = '#f0c040'
        } else {
          badge.textContent = 'FREE'
          badge.style.background = 'rgba(255,255,255,0.05)'
          badge.style.border = '0.5px solid #333'
          badge.style.color = '#555'
        }
      }
      loadR2(isPro)
    })
    window.electronAPI.onAutoLoad(f => { isR2Mode = false; loadFolder(f) })
  }
  initAutoLoad()
})

function adminSetSource(source) {
  if (source === 'r2') {
    document.getElementById('btn-source-r2').style.cssText += ';background:#1a2e44;border-color:#5b9bd5;color:#5b9bd5'
    document.getElementById('btn-source-local').style.background = ''
    document.getElementById('btn-source-local').style.borderColor = ''
    document.getElementById('btn-source-local').style.color = ''
    window.electronAPI.adminSwitchSource({ useLocal: false })
  } else {
    document.getElementById('btn-source-local').style.cssText += ';background:#1a2e44;border-color:#5b9bd5;color:#5b9bd5'
    document.getElementById('btn-source-r2').style.background = ''
    document.getElementById('btn-source-r2').style.borderColor = ''
    document.getElementById('btn-source-r2').style.color = ''
    window.electronAPI.adminSwitchSource({ useLocal: true })
  }
}

window.addEventListener('resize', () => { if (gridMode > 0) positionGridOverlay() })

// ══ MOODBOARD (in-app) ══
let moodboardLoaded = false
async function openMoodboard() {
  // Désactivé sur phone : <webview> = Electron-only et un écran phone est trop
  // petit pour servir de référence visuelle pendant qu'on dessine. Cf. CLAUDE.md.
  if (window.matchMedia && window.matchMedia('(max-width: 1199px)').matches) {
    showScreen('screen-config')
    return
  }
  const wv = document.getElementById('moodboard-webview')
  if (!moodboardLoaded) {
    try {
      const p = await window.electronAPI.getMoodboardPreloadPath()
      wv.setAttribute('preload', 'file://' + p)
    } catch (e) { console.warn('moodboard preload path failed', e) }
    wv.setAttribute('src', 'moodboard/index.html')
    moodboardLoaded = true
  }
  showScreen('screen-moodboard')
}
function closeMoodboard() { showScreen('screen-config') }

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'))
  document.getElementById(id).classList.add('active')
  const visible = id === 'screen-config'
  document.getElementById('options-btn').style.display = visible ? 'flex' : 'none'
  document.getElementById('discord-btn').style.display = visible ? 'flex' : 'none'
  const badge = document.getElementById('plan-badge')
  if (badge) badge.style.display = (visible && badge.textContent.trim()) ? 'flex' : 'none'
  document.getElementById('options-dropdown').classList.remove('open')
  // Orientation : libre sur les écrans où la photo est plein écran
  // (pose / animation / cinéma), lock portrait ailleurs. Sur desktop
  // Electron les helpers sont absents = no-op silencieux.
  const FREE_ORIENTATION = ['screen-session', 'screen-anim', 'screen-cinema']
  if (FREE_ORIENTATION.includes(id)) {
    if (window.__unlockOrientation) window.__unlockOrientation()
  } else {
    if (window.__lockPortrait) window.__lockPortrait()
  }
}

function applyTransform() {
  const scaleX = currentFlipH ? -1 : 1
  const transform = 'rotate(' + currentRotation + 'deg) scaleX(' + scaleX + ')'
  const filter = currentBW ? 'grayscale(1)' : ''
  document.getElementById('photo-img').style.transform = transform
  document.getElementById('photo-img').style.filter = filter
  document.getElementById('pdf-canvas').style.transform = transform
  document.getElementById('pdf-canvas').style.filter = filter
}

function toggleBW() {
  currentBW = !currentBW
  const btn = document.getElementById('bw-btn')
  btn.style.color = currentBW ? '#fff' : ''
  btn.style.background = currentBW ? 'rgba(255,255,255,0.15)' : ''
  btn.style.borderColor = currentBW ? 'rgba(255,255,255,0.4)' : ''
  applyTransform()
}
function rotateLeft() { currentRotation = (currentRotation - 90 + 360) % 360; applyTransform() }
function rotateRight() { currentRotation = (currentRotation + 90) % 360; applyTransform() }
function flipH() { currentFlipH = !currentFlipH; applyTransform() }

let flipModeEnabled = false
function toggleFlipMode() {
  flipModeEnabled = !flipModeEnabled
  const toggle = document.getElementById('flip-toggle')
  const knob = document.getElementById('flip-knob')
  const label = document.getElementById('flip-label')
  if (flipModeEnabled) {
    toggle.style.background = '#fff'; knob.style.left = '21px'; knob.style.background = '#111'
    label.textContent = 'Activé'; label.style.color = '#fff'
  } else {
    toggle.style.background = '#2e2e2e'; knob.style.left = '3px'; knob.style.background = '#666'
    label.textContent = 'Désactivé'; label.style.color = '#555'
  }
}

function resetTransform() {
  currentRotation = flipModeEnabled ? 180 : 0
  currentFlipH = false
  requestAnimationFrame(() => applyTransform())
}

// ══ CHARGEMENT DOSSIER ══
async function loadFolder(folder) {
  document.getElementById('folder-path').textContent = folder
  document.getElementById('file-count').textContent = 'Indexation...'
  document.getElementById('btn-start').disabled = true
  allEntries = []; categories = {}; sequences = {}
  imgCache.clear()
  const fileInfos = await window.electronAPI.listFiles(folder)
  for (const info of fileInfos) {
    const fp = info.path, cat = info.category, seq = info.sequence
    if (seq) {
      if (!sequences[seq]) sequences[seq] = { paths: [], animCategory: info.animCategory || null }
      sequences[seq].paths.push(fp); continue
    }
    if (window.electronAPI.isPdf(fp)) {
      const e = { type: 'pdf-pending', path: fp, category: cat }
      allEntries.push(e)
      if (!categories[cat]) categories[cat] = []
      categories[cat].push(e)
    } else {
      const e = { type: 'image', path: fp, category: cat }
      allEntries.push(e)
      if (!categories[cat]) categories[cat] = []
      categories[cat].push(e)
    }
  }
  renderCategories(); renderSequences()
  const seqCount = Object.keys(sequences).length
  const pdfCount = allEntries.filter(e => e.type === 'pdf-pending').length
  let msg = allEntries.length + ' fichiers indexés'
  if (pdfCount > 0) msg += ' (' + pdfCount + ' PDF)'
  if (seqCount > 0) msg += ' · ' + seqCount + ' séquence(s)'
  document.getElementById('file-count').textContent = msg
  document.getElementById('btn-start').disabled = false
}

async function loadR2(isPro) {
  document.getElementById('folder-path').textContent = isPro ? '☁️ Gesturo Pro — R2' : '☁️ Gesturo — R2'
  document.getElementById('file-count').textContent = 'Chargement depuis le cloud...'
  document.getElementById('btn-start').disabled = true
  allEntries = []; categories = {}; sequences = {}
  imgCache.clear()
  try {
    const [photos, anims] = await Promise.all([
      window.electronAPI.listR2Photos({ isPro }),
      window.electronAPI.listR2Animations({ isPro })
    ])
    for (const info of photos) {
      const fp = info.path, cat = info.category, sub = info.subcategory
      const e = { type: 'image', path: fp, category: cat, subcategory: sub, isR2: true }
      allEntries.push(e)
      if (!categories[cat]) categories[cat] = { entries: [], subcategories: {} }
      categories[cat].entries.push(e)
      if (sub) {
        if (!categories[cat].subcategories[sub]) categories[cat].subcategories[sub] = []
        categories[cat].subcategories[sub].push(e)
      }
    }
    for (const info of anims) {
      const seq = info.sequence; if (!seq) continue
      if (!sequences[seq]) sequences[seq] = { paths: [], animCategory: info.animCategory || null }
      sequences[seq].paths.push(info.path)
    }
    if (!isPro) {
      allEntries.sort(() => Math.random() - 0.5)
      allEntries = allEntries.slice(0, 150)
      categories = {}
      for (const e of allEntries) {
        if (!categories[e.category]) categories[e.category] = { entries: [], subcategories: {} }
        categories[e.category].entries.push(e)
        if (e.subcategory) {
          if (!categories[e.category].subcategories[e.subcategory]) categories[e.category].subcategories[e.subcategory] = []
          categories[e.category].subcategories[e.subcategory].push(e)
        }
      }
    }
    renderCategories(); renderSequences()
    const seqCount = Object.keys(sequences).length
    document.getElementById('file-count').textContent = allEntries.length + ' photos · ' + seqCount + ' séquence(s)'
    const r2Status = document.getElementById('r2-status')
    if (r2Status) r2Status.textContent = allEntries.length + ' photos chargées ✓'
    document.getElementById('btn-start').disabled = allEntries.length === 0
  } catch(e) {
    console.error('loadR2 error:', e)
    const msg = (e && e.message) || String(e)
    // Si l'Edge Function renvoie 401, c'est généralement une session expirée
    // ou un compte sans entrée profiles. On le dit clairement au user au lieu
    // de l'ancien faux "0 photos chargées ✓".
    const is401 = /\b401\b/.test(msg)
    const hint = is401
      ? '❌ Session expirée — déconnecte-toi puis reconnecte-toi'
      : '❌ Erreur de chargement R2 : ' + msg
    document.getElementById('file-count').textContent = hint
    const r2Status = document.getElementById('r2-status')
    if (r2Status) r2Status.textContent = hint
    document.getElementById('btn-start').disabled = true
  }
}

async function pickFolder() {
  const folder = await window.electronAPI.pickFolder()
  if (!folder) return
  await loadFolder(folder)
}

// ══ CATÉGORIES ══
const CAT_ICONS = { 'animals': '🐾', 'jambes-pieds': '🦵', 'mains': '🤲', 'nudite': '🔞', 'poses-dynamiques': '⚡', 'visage': '👤' }
function getCatIcon(cat) { return CAT_ICONS[cat.toLowerCase()] || '📁' }
function getCatLabel(cat) { const labels = { 'animals': 'Animaux', 'jambes-pieds': 'Jambes & Pieds', 'mains': 'Mains', 'nudite': 'Nudité', 'poses-dynamiques': 'Poses Dynamiques', 'visage': 'Visage' }; return labels[cat.toLowerCase()] || cat.charAt(0).toUpperCase() + cat.slice(1).replace(/-/g, ' ') }
const NUDITY_KW = ['nudité', 'nudite', 'nu ', 'nude', 'nsfw']
function isNudity(n) { return NUDITY_KW.some(k => n.toLowerCase().includes(k)) }

function buildCatCard(cat, key, count, previewUrl, isSelected, hasSubs, nudity = false) {
  const card = document.createElement('div')
  card.dataset.cat = key
  card.style.cssText = `position:relative;border-radius:10px;overflow:hidden;cursor:pointer;border:1.5px solid ${isSelected ? (nudity ? '#E24B4A' : '#2983eb') : '#1e2d40'};background:#131f2e;aspect-ratio:4/3;transition:border-color 0.15s,transform 0.15s;`
  if (previewUrl) {
    const img = document.createElement('img')
    img.src = previewUrl; img.loading = 'lazy'
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;opacity:0;transition:opacity 0.3s;'
    img.onload = () => { img.style.opacity = isSelected ? '1' : '0.35' }
    img.onerror = () => { img.style.display = 'none' }
    card.appendChild(img)
  }
  const overlay = document.createElement('div')
  overlay.style.cssText = 'position:absolute;inset:0;background:linear-gradient(to top, rgba(5,10,18,0.95) 0%, rgba(5,10,18,0.3) 60%, transparent 100%);display:flex;flex-direction:column;justify-content:flex-end;padding:10px;'
  overlay.appendChild(Object.assign(document.createElement('div'), { textContent: getCatIcon(cat), style: 'font-size:18px;margin-bottom:4px;' }))
  overlay.appendChild(Object.assign(document.createElement('div'), { textContent: getCatLabel(cat), style: 'font-size:12px;font-weight:600;color:#fff;line-height:1.2;' }))
  overlay.appendChild(Object.assign(document.createElement('div'), { textContent: count + ' poses', style: 'font-size:11px;color:#4a6280;margin-top:2px;' }))
  card.appendChild(overlay)
  if (!hasSubs) {
    const badge = document.createElement('div')
    badge.style.cssText = `position:absolute;top:8px;right:8px;width:20px;height:20px;border-radius:50%;background:${nudity ? '#E24B4A' : '#2983eb'};display:${isSelected ? 'flex' : 'none'};align-items:center;justify-content:center;font-size:11px;color:#fff;font-weight:700;`
    badge.textContent = '✓'
    card.appendChild(badge)
  }
  card.addEventListener('mouseenter', () => { card.style.transform = 'translateY(-2px)' })
  card.addEventListener('mouseleave', () => { card.style.transform = '' })
  return card
}

function renderCategories(parentCat = null) {
  const wrap = document.getElementById('categories-wrap')
  wrap.innerHTML = ''
  if (!currentUserIsPro && isR2Mode) {
    wrap.innerHTML = `<div class="free-random-block"><div class="frb-icon">🎲</div><div class="frb-title">150 poses aléatoires</div><div class="frb-sub">Passe Pro pour choisir tes catégories</div><button onclick="showUpgradeModal()" class="frb-cta">Découvrir Pro ⭐</button></div>`
    selectedCats = new Set(Object.keys(categories)); return
  }
  const cats = Object.keys(categories).sort()
  if (cats.length === 0) { selectedCats = new Set(['Sans catégorie']); return }
  const header = document.createElement('div')
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;'
  if (parentCat) {
    header.innerHTML = `<button onclick="renderCategories(null)" style="background:transparent;border:none;color:#5b9bd5;font-size:13px;cursor:pointer;padding:0;">← ${getCatLabel(parentCat)}</button><span style="font-size:12px;color:#3a5570;text-transform:uppercase;letter-spacing:0.8px;">Sous-collections</span>`
  } else {
    const allSelected = cats.every(c => selectedCats.has(c))
    header.innerHTML = `<span style="font-size:12px;color:#3a5570;text-transform:uppercase;letter-spacing:0.8px;">Collections</span><button id="cat-all" onclick="toggleAllCats()" style="font-size:12px;background:transparent;border:0.5px solid #1e2d40;border-radius:6px;color:${allSelected ? '#2983eb' : '#3a5570'};padding:4px 10px;cursor:pointer;">${allSelected ? '✓ Tout' : 'Tout sélectionner'}</button>`
  }
  wrap.appendChild(header)
  const grid = document.createElement('div')
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;'
  wrap.appendChild(grid)
  if (parentCat) {
    const subs = categories[parentCat]?.subcategories || {}
    Object.keys(subs).sort().forEach(sub => {
      const entries = subs[sub]
      const isSelected = selectedCats.has(parentCat + '/' + sub)
      const card = buildCatCard(sub, parentCat + '/' + sub, entries.length, entries[0]?.path || null, isSelected, false, isNudity(parentCat))
      card.onclick = () => toggleSubCat(parentCat, sub, card)
      grid.appendChild(card)
    })
  } else {
    cats.forEach(cat => {
      const nudity = isNudity(cat)
      const catData = categories[cat]
      const entries = Array.isArray(catData) ? catData : (catData.entries || [])
      const subs = Array.isArray(catData) ? {} : (catData.subcategories || {})
      const hasSubs = Object.keys(subs).length > 0
      const isSelected = selectedCats.has(cat)
      const card = buildCatCard(cat, cat, entries.length, entries[0]?.path || null, isSelected, hasSubs, nudity)
      if (hasSubs) {
        card.onclick = () => renderCategories(cat)
        const arrow = document.createElement('div')
        arrow.style.cssText = 'position:absolute;top:8px;left:8px;background:rgba(5,10,18,0.7);border-radius:4px;padding:2px 6px;font-size:10px;color:#8aaccc;'
        arrow.textContent = Object.keys(subs).length + ' collections →'
        card.appendChild(arrow)
      } else { card.onclick = () => toggleCat(cat, card) }
      grid.appendChild(card)
    })
  }
}

function showUpgradeModal() {
  const existing = document.getElementById('upgrade-modal'); if (existing) existing.remove()
  const modal = document.createElement('div')
  modal.id = 'upgrade-modal'
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:9999;'
  modal.innerHTML = `<div style="background:#1e1e1e;border:0.5px solid #333;border-radius:16px;padding:32px;width:360px;text-align:center;"><div style="font-size:28px;margin-bottom:12px;">⭐</div><h2 style="color:#fff;font-size:20px;margin-bottom:8px;">Gesturo Pro</h2><p style="color:#555;font-size:14px;line-height:1.6;margin-bottom:24px;">Accède à toutes les catégories, les animations et les poses de nudité académique.</p><button onclick="window.electronAPI.openExternal('https://gesturo.art')" style="width:100%;padding:13px;background:#fff;color:#111;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer;margin-bottom:10px;">Découvrir Pro</button><button onclick="document.getElementById('upgrade-modal').remove()" style="width:100%;padding:10px;background:transparent;color:#555;border:none;font-size:14px;cursor:pointer;">Pas maintenant</button></div>`
  document.body.appendChild(modal)
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove() })
}

function toggleCat(cat, card) {
  const nudity = isNudity(cat)
  if (selectedCats.has(cat)) {
    selectedCats.delete(cat); card.style.borderColor = '#1e2d40'
    const img = card.querySelector('img'); if (img) img.style.opacity = '0.35'
    card.lastElementChild.style.display = 'none'
  } else {
    selectedCats.add(cat); card.style.borderColor = nudity ? '#E24B4A' : '#2983eb'
    const img = card.querySelector('img'); if (img) img.style.opacity = '1'
    card.lastElementChild.style.display = 'flex'
  }
  updateAllBtn()
}

function toggleSubCat(parentCat, sub, card) {
  const key = parentCat + '/' + sub; const nudity = isNudity(parentCat)
  if (selectedCats.has(key)) {
    selectedCats.delete(key); card.style.borderColor = '#1e2d40'
    const img = card.querySelector('img'); if (img) img.style.opacity = '0.35'
    card.lastElementChild.style.display = 'none'
  } else {
    selectedCats.add(key); card.style.borderColor = nudity ? '#E24B4A' : '#2983eb'
    const img = card.querySelector('img'); if (img) img.style.opacity = '1'
    card.lastElementChild.style.display = 'flex'
  }
}

function toggleAllCats() {
  const cats = Object.keys(categories)
  const all = cats.every(c => selectedCats.has(c))
  if (all) { selectedCats.clear() } else { cats.forEach(c => selectedCats.add(c)) }
  renderCategories()
}

function updateAllBtn() {
  const btn = document.getElementById('cat-all'); if (!btn) return
  const allSelected = Object.keys(categories).every(c => selectedCats.has(c))
  btn.style.color = allSelected ? '#2983eb' : '#3a5570'
  btn.textContent = allSelected ? '✓ Tout' : 'Tout sélectionner'
}

function renderSequences(parentPath = null) {
  const wrap = document.getElementById('sequences-wrap'); wrap.innerHTML = ''
  if (Object.keys(sequences).length === 0) {
    wrap.innerHTML = '<div style="font-size:13px;color:#3a5570;text-align:center;padding:20px 0;">Aucune séquence disponible.</div>'; return
  }
  const header = document.createElement('div')
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;'
  if (parentPath) {
    const label = parentPath.split('/').pop()
    header.innerHTML = `<button onclick="renderSequences(${parentPath.split('/').slice(0,-1).join('/') ? "'"+parentPath.split('/').slice(0,-1).join('/')+"'" : 'null'})" style="background:transparent;border:none;color:#5b9bd5;font-size:13px;cursor:pointer;padding:0;">← ${label}</button><span style="font-size:12px;color:#3a5570;text-transform:uppercase;letter-spacing:0.8px;">Séquences</span>`
  } else {
    header.innerHTML = `<span style="font-size:12px;color:#3a5570;text-transform:uppercase;letter-spacing:0.8px;">Collections</span>`
  }
  wrap.appendChild(header)
  const grid = document.createElement('div')
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;'
  wrap.appendChild(grid)
  const folders = new Map(); const leafSequences = []
  for (const [seq, data] of Object.entries(sequences)) {
    const seqParts = seq.split('/')
    if (parentPath) {
      const parentParts = parentPath.split('/')
      if (!seqParts.slice(0, parentParts.length).join('/').startsWith(parentPath)) continue
      const remaining = seqParts.slice(parentParts.length)
      if (remaining.length === 1) leafSequences.push(seq)
      else if (remaining.length > 1) { const fn = parentPath + '/' + remaining[0]; if (!folders.has(fn)) folders.set(fn, data.paths[0]) }
    } else {
      const tier = seqParts.slice(0, 2).join('/')
      if (seqParts.length === 3) leafSequences.push(seq)
      else { if (!folders.has(tier)) folders.set(tier, data.paths[0]) }
    }
  }
  folders.forEach((previewUrl, folderPath) => {
    const label = folderPath.split('/').pop()
    const card = buildSeqCard(label, previewUrl, false, false, true)
    card.onclick = () => renderSequences(folderPath)
    const count = Object.keys(sequences).filter(s => s.startsWith(folderPath + '/')).length
    const arrow = document.createElement('div')
    arrow.style.cssText = 'position:absolute;top:8px;left:8px;background:rgba(5,10,18,0.7);border-radius:4px;padding:2px 6px;font-size:10px;color:#8aaccc;'
    arrow.textContent = count + ' séquences →'
    card.appendChild(arrow); grid.appendChild(card)
  })
  leafSequences.forEach(seq => {
    const data = sequences[seq]
    const isLocked = !currentUserIsPro && isR2Mode && !seq.startsWith('current/free')
    const isSelected = selectedSeq === seq
    const previewUrl = isR2Mode ? data.paths[0] : 'file://' + data.paths[0]
    const label = seq.split('/').pop()
    const card = buildSeqCard(label, previewUrl, isSelected, isLocked, false, data.paths.length, seq)
    card.onclick = () => {
      if (isLocked) { showUpgradeModal(); return }
      selectedSeq = seq; renderSequences(parentPath); selectSeqPreload(seq)
    }
    grid.appendChild(card)
  })
  if (leafSequences.length > 0 && !selectedSeq) {
    const first = leafSequences.find(s => !(!currentUserIsPro && isR2Mode && !s.startsWith('current/free'))) || leafSequences[0]
    selectedSeq = first; selectSeqPreload(first)
  }
}

function buildSeqCard(label, previewUrl, isSelected, isLocked, isFolder, frameCount = null, seq = null) {
  const card = document.createElement('div')
  card.style.cssText = `position:relative;border-radius:10px;overflow:hidden;cursor:pointer;border:1.5px solid ${isSelected ? '#2983eb' : '#1e2d40'};background:#131f2e;aspect-ratio:4/3;transition:border-color 0.15s,transform 0.15s;`
  const img = document.createElement('img')
  img.loading = 'lazy'
  img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;opacity:0;transition:opacity 0.3s;'
  if (previewUrl) { img.src = previewUrl; img.onload = () => { img.style.opacity = isSelected ? '1' : '0.45' }; img.onerror = () => { img.style.opacity = '0' } }
  card.appendChild(img)
  const overlay = document.createElement('div')
  overlay.style.cssText = 'position:absolute;inset:0;background:linear-gradient(to top, rgba(5,10,18,0.95) 0%, rgba(5,10,18,0.3) 60%, transparent 100%);display:flex;flex-direction:column;justify-content:flex-end;padding:10px;'
  overlay.appendChild(Object.assign(document.createElement('div'), { textContent: isFolder ? '📁' : (isLocked ? '🔒' : '▶'), style: 'font-size:18px;margin-bottom:4px;' }))
  overlay.appendChild(Object.assign(document.createElement('div'), { textContent: label.replace(/-/g, ' '), style: 'font-size:12px;font-weight:600;color:#fff;line-height:1.2;' }))
  if (frameCount) overlay.appendChild(Object.assign(document.createElement('div'), { textContent: frameCount + ' frames', style: 'font-size:11px;color:#4a6280;margin-top:2px;' }))
  card.appendChild(overlay)
  if (!isFolder && isSelected) {
    const badge = document.createElement('div')
    badge.style.cssText = 'position:absolute;top:8px;right:8px;width:20px;height:20px;border-radius:50%;background:#2983eb;display:flex;align-items:center;justify-content:center;font-size:11px;color:#fff;font-weight:700;'
    badge.textContent = '✓'; card.appendChild(badge)
  }
  if (!isFolder && seq && sequences[seq]) {
    let hoverInterval = null; let previewFrames = []; let previewLoaded = false; let frameIdx = 0
    const paths = sequences[seq].paths.slice(0, 10)
    const loadPreviews = () => {
      if (previewLoaded) return Promise.resolve()
      return Promise.all(paths.map(p => new Promise(resolve => {
        const i = new Image(); const src = isR2Mode ? p : 'file://' + p
        i.onload = () => { previewFrames.push(src); resolve() }; i.onerror = resolve; i.src = src
      }))).then(() => { previewLoaded = true })
    }
    setTimeout(() => loadPreviews(), 200)
    card.addEventListener('mouseenter', async () => {
      card.style.transform = 'translateY(-2px)'; await loadPreviews()
      if (previewFrames.length === 0) return
      frameIdx = 0; img.src = previewFrames[0]; img.style.opacity = '1'; img.style.transition = 'none'
      hoverInterval = setInterval(() => { frameIdx = (frameIdx + 1) % previewFrames.length; img.src = previewFrames[frameIdx] }, 150)
    })
    card.addEventListener('mouseleave', () => {
      card.style.transform = ''; clearInterval(hoverInterval); hoverInterval = null
      img.style.transition = 'opacity 0.3s'; img.src = previewUrl || ''; img.style.opacity = isSelected ? '1' : '0.45'
    })
  } else {
    card.addEventListener('mouseenter', () => { card.style.transform = 'translateY(-2px)' })
    card.addEventListener('mouseleave', () => { card.style.transform = '' })
  }
  return card
}

async function selectSeqPreload(seq) {
  if (preloadCache[seq]) return
  const paths = sequences[seq].paths
  await Promise.all(paths.map(p => new Promise(resolve => {
    const img = new Image(); img.onload = img.onerror = resolve; img.src = isR2Mode ? p : 'file://' + p
  })))
  preloadCache[seq] = true
}

async function selectSeq(seq, el) {
  document.querySelectorAll('.seq-item').forEach(i => i.classList.remove('selected'))
  el.classList.add('selected'); selectedSeq = seq
  if (preloadCache[seq]) return
  const paths = sequences[seq].paths || sequences[seq]
  const check = el.querySelector('.seq-check'); if (check) check.textContent = '...'
  await Promise.all(paths.map(p => new Promise(resolve => {
    const img = new Image(); img.onload = img.onerror = resolve; img.src = isR2Mode ? p : 'file://' + p
  })))
  preloadCache[seq] = true; el.classList.add('ready'); if (check) check.textContent = '✓'
}

// ══ MODES ══
function switchMainMode(mode) {
  mainMode = mode
  document.getElementById('tab-pose').classList.toggle('active', mode === 'pose')
  document.getElementById('tab-anim').classList.toggle('active', mode === 'anim')
  document.getElementById('tab-favs').classList.toggle('active', mode === 'favs')
  document.getElementById('tab-hist').classList.toggle('active', mode === 'hist')
  document.getElementById('tab-community').classList.toggle('active', mode === 'community')
  document.getElementById('tab-cinema').classList.toggle('active', mode === 'cinema')
  document.getElementById('pose-options').style.display = mode === 'pose' ? 'block' : 'none'
  document.getElementById('anim-options').style.display = mode === 'anim' ? 'block' : 'none'
  document.getElementById('favs-options').style.display = mode === 'favs' ? 'block' : 'none'
  document.getElementById('hist-options').style.display = mode === 'hist' ? 'block' : 'none'
  document.getElementById('community-options').style.display = mode === 'community' ? 'block' : 'none'
  document.getElementById('cinema-options').style.display = mode === 'cinema' ? 'block' : 'none'
  if (mode === 'cinema') {
    initFilmGrid()
    document.getElementById('btn-start').style.display = 'none'
    document.getElementById('btn-cinema-start').style.display = 'block'
  } else {
    document.getElementById('btn-cinema-start').style.display = 'none'
    document.getElementById('btn-start').style.display = (mode === 'favs' || mode === 'hist' || mode === 'community') ? 'none' : 'block'
  }
  if (mode === 'favs') renderFavsConfig()
  if (mode === 'hist') renderHist()
  if (mode === 'community') { renderCommunity(); startCommunityRefresh() }
  if (mode !== 'community' && communityInterval) { clearInterval(communityInterval); communityInterval = null }
  // Sync bottom tab bar (mobile) — Démarrer = tout sauf community
  const btabStart = document.getElementById('btab-start')
  const btabCommu = document.getElementById('btab-community')
  if (btabStart && btabCommu) {
    btabStart.classList.toggle('active', mode !== 'community')
    btabCommu.classList.toggle('active', mode === 'community')
  }
}

const preloadCache = {}

async function renderCommunity() {
  const grid = document.getElementById('community-grid')
  const empty = document.getElementById('community-empty')
  grid.innerHTML = ''; empty.style.display = 'block'; empty.textContent = 'Chargement...'
  try {
    const posts = await window.electronAPI.getInstagramPosts()
    empty.style.display = 'none'
    if (!posts || posts.length === 0) { empty.style.display = 'block'; empty.textContent = 'Aucune photo pour le moment.'; return }
    const seen = new Set()
    posts.forEach(post => {
      if (post.media_type !== 'IMAGE' && post.media_type !== 'CAROUSEL_ALBUM') return
      if (seen.has(post.id)) return; seen.add(post.id)
      const item = document.createElement('div')
      item.style.cssText = 'aspect-ratio:1;overflow:hidden;border-radius:4px;cursor:pointer;background:#242424;position:relative;'
      const img = document.createElement('img'); img.src = post.media_url
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;transition:filter 0.2s;'
      const overlay = document.createElement('div')
      overlay.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity 0.2s;font-size:14px;font-weight:600;color:#fff;gap:6px;'
      overlay.innerHTML = '❤️ ' + (post.like_count || 0)
      item.addEventListener('mouseenter', () => { overlay.style.opacity = '1'; img.style.filter = 'brightness(0.7)' })
      item.addEventListener('mouseleave', () => { overlay.style.opacity = '0'; img.style.filter = '' })
      item.onclick = () => window.electronAPI.openExternal(post.permalink)
      item.appendChild(img); item.appendChild(overlay); grid.appendChild(item)
    })
  } catch(e) { empty.style.display = 'block'; empty.textContent = '❌ Erreur de chargement.' }
}

let communityInterval = null
function startCommunityRefresh() {
  if (communityInterval) clearInterval(communityInterval)
  communityInterval = setInterval(() => { if (mainMode === 'community') renderCommunity() }, 60 * 1000)
}

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
    } catch(err) { console.warn('PDF illisible', e.path) }
  }
  let pool = allEntries.filter(e => {
    if (selectedCats.has(e.category)) return true
    if (e.subcategory && selectedCats.has(e.category + '/' + e.subcategory)) return true
    return false
  })
  if (pool.length === 0) { alert('Sélectionne au moins une catégorie pour démarrer.'); return }
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
      } catch(err) { console.warn('PDF illisible', e.path) }
    }
    for (const { original, pages } of resolved) {
      const si = sessionEntries.indexOf(original); if (si !== -1) sessionEntries.splice(si, 1, pages[0])
    }
  }
  currentIndex = 0; sessionLog = []
  imgCache.clear()
  document.getElementById('confirm-bar').style.display = 'none'
  document.getElementById('controls').style.display = 'flex'
  showScreen('screen-session'); loadAndShow(0)
}

// ══ POSE : AFFICHAGE ══
const imgCache = new Map()
const IMG_CACHE_MAX = 5

async function getImageSrc(entry) { if (entry.isR2) return entry.path; return 'file://' + entry.path }

// Précharge les 2 prochaines poses pour éliminer le délai visible entre
// chaque image. En mode R2, on instancie une Image() pour forcer le
// navigateur à fetch + mettre en cache HTTP — sinon le fetch n'arrive
// qu'au moment où le <img> visible demande l'URL, créant un blanc.
// En mode local, on lit les bytes via Electron IPC.
async function preloadNext(idx) {
  for (let k = 1; k <= 2; k++) {
    const next = sessionEntries[idx + k]
    if (!next || next.type === 'pdf') continue
    const key = next.path
    if (imgCache.has(key)) continue
    if (next.isR2) {
      const im = new Image()
      im.src = next.path
      imgCache.set(key, next.path)
    } else {
      try {
        const dataUrl = await window.electronAPI.readFileAsBase64(next.path)
        imgCache.set(key, dataUrl)
      } catch (e) { continue }
    }
    if (imgCache.size > IMG_CACHE_MAX) imgCache.delete(imgCache.keys().next().value)
  }
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
  document.getElementById('confirm-bar').style.display = 'none'
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
      img.onerror = () => { if (loading) { ph.textContent = 'Erreur'; onPoseReady(entry) } }
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
  timerDuration = currentSubMode === 'progressive' && progressiveQueue[currentIndex] ? progressiveQueue[currentIndex] : getSelectedDuration()
  logPoseEntry(entry, timerDuration)
  document.getElementById('btn-next').disabled = false
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
  else thumb = { data: entry.isR2 ? entry.path : 'file://' + entry.path }
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
function askEnd() { paused = true; document.getElementById('btn-pause').textContent = 'Reprendre'; document.getElementById('controls').style.display = 'none'; document.getElementById('confirm-bar').style.display = 'flex' }
function cancelEnd() { document.getElementById('confirm-bar').style.display = 'none'; document.getElementById('controls').style.display = 'flex'; paused = false; document.getElementById('btn-pause').textContent = 'Pause' }

// ══ ANIMATION SESSION ══
let animLoopCount = 0
const ANIM_LOOP_TARGET = 5
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
  document.getElementById('anim-frame-info').textContent = 'Frame ' + (idx + 1) + ' / ' + animFrames.length
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
      document.getElementById('anim-mode-badge').textContent = 'Étude — Frame 1 / ' + animFrames.length
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
      } else if (animLoopCount >= ANIM_LOOP_TARGET) animLoopCount = 0
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
  document.getElementById('anim-mode-badge').textContent = 'Étude — Frame 1 / ' + animFrames.length
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
  el.textContent = m + ':' + String(s).padStart(2, '0')
  el.className = (studyTimeLeft <= 5 && studyTimeLeft > 0) ? 'warning' : ''
  const pct = studyDuration > 0 ? Math.round((studyTimeLeft / studyDuration) * 100) : 0
  document.getElementById('study-prog-bar').style.width = pct + '%'
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
  const inner = document.getElementById('timeline-inner'); inner.innerHTML = ''
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

function finishAnimSession() {
  clearInterval(animInterval); clearInterval(studyTicker)
  const logs = animStudyLog.filter(Boolean)
  const totalMins = Math.round(logs.reduce((a, l) => a + l.duration, 0) / 60)
  document.getElementById('stat-poses').textContent = logs.length
  document.getElementById('stat-time').textContent = totalMins || 1
  logSession({ type: 'anim', poses: logs.length, minutes: totalMins || 1, seq: selectedSeq || '' })
  const grid = document.getElementById('recap-grid'); grid.innerHTML = ''
  logs.forEach((log, i) => {
    const item = document.createElement('div'); item.className = 'recap-item'
    const img = document.createElement('img'); img.src = log.src; img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;'; item.appendChild(img)
    const num = document.createElement('div'); num.className = 'recap-num'; num.textContent = 'F' + (log.frameNum + 1); item.appendChild(num)
    const dur = document.createElement('div'); dur.className = 'recap-duration'; const d = log.duration; dur.textContent = d < 60 ? d + 's' : (d / 60) + 'min'; item.appendChild(dur)
    item.addEventListener('click', () => openLightbox(log.src, i, log.duration))
    const star = document.createElement('button')
    star.className = 'recap-star' + (isFaved(log.src) ? ' faved' : ''); star.textContent = isFaved(log.src) ? '★' : '☆'; star.title = 'Favori'
    star.onclick = (e) => { e.stopPropagation(); if (isFaved(log.src)) { removeFav(log.src); star.textContent = '☆'; star.classList.remove('faved') } else { addFav(log.src, 'Frame ' + (log.frameNum + 1)); star.textContent = '★'; star.classList.add('faved') }; star.classList.add('bump'); setTimeout(() => star.classList.remove('bump'), 250) }
    item.appendChild(star); grid.appendChild(item)
  })
  // Reset récap header
  document.getElementById('recap-title').textContent = 'Session terminée'
  document.getElementById('stat-poses-label').textContent = 'poses'
  document.getElementById('stat-time-label').textContent = 'min'
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
}

// ══ RÉCAP POSE ══
function finishSession() {
  clearInterval(ticker); ticker = null
  const logs = sessionLog.filter(Boolean)
  const totalMins = Math.round(logs.reduce((a, l) => a + l.duration, 0) / 60)
  document.getElementById('stat-poses').textContent = logs.length
  document.getElementById('stat-time').textContent = totalMins
  logSession({ type: 'pose', poses: logs.length, minutes: totalMins || 1, subMode: currentSubMode, cats: Array.from(selectedCats).filter(c => c !== 'Sans catégorie').join(', ') })
  const grid = document.getElementById('recap-grid'); grid.innerHTML = ''
  logs.forEach((log, i) => {
    const item = document.createElement('div'); item.className = 'recap-item'
    const img = document.createElement('img'); if (log.thumbnail?.data) img.src = log.thumbnail.data; item.appendChild(img)
    if (log.rotation) img.style.transform = 'rotate(' + log.rotation + 'deg)'
    const num = document.createElement('div'); num.className = 'recap-num'; num.textContent = i + 1; item.appendChild(num)
    const dur = document.createElement('div'); dur.className = 'recap-duration'; const d = log.duration; dur.textContent = d < 60 ? d + 's' : (d / 60) + 'min'; item.appendChild(dur)
    const src = log.thumbnail?.data || null
    if (src) {
      const star = document.createElement('button')
      star.className = 'recap-star' + (isFaved(src) ? ' faved' : ''); star.textContent = isFaved(src) ? '★' : '☆'; star.title = 'Favori'
      star.onclick = (e) => { e.stopPropagation(); if (isFaved(src)) { removeFav(src); star.textContent = '☆'; star.classList.remove('faved') } else { addFav(src, 'Pose ' + (i + 1)); star.textContent = '★'; star.classList.add('faved') }; star.classList.add('bump'); setTimeout(() => star.classList.remove('bump'), 250) }
      item.appendChild(star)
    }
    item.addEventListener('click', () => { if (src) openLightbox(src, i, log.duration, log.rotation || 0) })
    grid.appendChild(item)
  })
  // Reset récap header
  document.getElementById('recap-title').textContent = 'Session terminée'
  document.getElementById('stat-poses-label').textContent = 'poses'
  document.getElementById('stat-time-label').textContent = 'min'
  showScreen('screen-end')
  // Pop-up Discord (1 fois sur 3)
  if (Math.random() < 0.33) {
    setTimeout(() => {
      const existing = document.getElementById('discord-popup'); if (existing) return
      const popup = document.createElement('div'); popup.id = 'discord-popup'
      popup.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#1e1e1e;border:0.5px solid #333;border-radius:12px;padding:16px 20px;max-width:280px;z-index:9999;box-shadow:0 8px 32px rgba(0,0,0,0.5);'
      popup.innerHTML = `<div style="font-size:13px;color:#888;margin-bottom:6px">🐛 Un bug ? Une idée ?</div><div style="font-size:14px;color:#fff;font-weight:500;margin-bottom:12px">Rejoins la communauté Gesturo</div><div style="display:flex;gap:8px"><a href="#" onclick="event.preventDefault(); window.electronAPI.openExternal('https://discord.gg/HgnBN85xjj')" style="flex:1;background:#5865F2;color:#fff;border:none;border-radius:8px;padding:8px 12px;font-size:13px;font-weight:500;cursor:pointer;text-decoration:none;text-align:center">💬 Discord</a><button onclick="document.getElementById('discord-popup').remove()" style="background:#2e2e2e;color:#888;border:none;border-radius:8px;padding:8px 12px;font-size:13px;cursor:pointer">✕</button></div>`
      document.body.appendChild(popup)
      setTimeout(() => { const p = document.getElementById('discord-popup'); if(p) p.remove() }, 8000)
    }, 1500)
  }
}

function replaySession() {
  if (mainMode === 'anim') {
    animStudyLog = []; animLoopCount = 0; animIndex = 0; animStudyMode = false
    buildTimeline(); showScreen('screen-anim'); showFrame(0)
    if (currentAnimMode === 'study') enterStudyMode(); else startLoop()
  } else if (mainMode === 'cinema') {
    startCinemaSession()
  } else {
    sessionEntries.sort(() => Math.random() - 0.5)
    currentIndex = 0; sessionLog = []
    showScreen('screen-session'); loadAndShow(0)
  }
}

// ══ LIGHTBOX ══
function openLightbox(src, index, duration) {
  const lb = document.getElementById('lightbox')
  lb.querySelector('img').src = src
  const d = duration
  document.getElementById('lightbox-info').textContent = 'Pose ' + (index + 1) + (d ? '  ·  ' + (d < 60 ? d + ' sec' : (d / 60) + ' min') : '')
  lb.classList.add('open')
  document.addEventListener('keydown', onLbKey)
}
function closeLightbox() {
  document.getElementById('lightbox').classList.remove('open')
  document.getElementById('lb-fav-remove').style.display = 'none'
  lbFavSrc = null
  document.removeEventListener('keydown', onLbKey)
}
function onLbKey(e) { if (e.key === 'Escape') closeLightbox() }

// ══ FAVORIS ══
const FAV_KEY = 'gd4_favorites'
function loadFavs() { try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]') } catch { return [] } }
function saveFavs(favs) { localStorage.setItem(FAV_KEY, JSON.stringify(favs)) }

function currentPoseSrc() {
  const entry = sessionEntries[currentIndex]; if (!entry) return null
  const canvas = document.getElementById('pdf-canvas')
  if (entry.type === 'pdf' && canvas.style.display !== 'none') return canvas.toDataURL('image/jpeg', 0.9)
  return entry.isR2 ? entry.path : 'file://' + entry.path
}

function isFaved(src) { return loadFavs().some(f => f.src === src) }

function updatePoseStarBtn() {
  const src = currentPoseSrc(); const btn = document.getElementById('pose-fav-btn'); if (!src || !btn) return
  const faved = isFaved(src); btn.textContent = faved ? '★' : '☆'; btn.classList.toggle('active', faved)
}

function updateAnimStarBtn() {
  const frame = animFrames[animIndex]; const src = frame ? frame.dataUrl : null
  const btn = document.getElementById('anim-fav-btn'); if (!src || !btn) return
  const faved = isFaved(src); btn.textContent = faved ? '★' : '☆'; btn.classList.toggle('active', faved)
}

function addFav(src, label) {
  const favs = loadFavs()
  if (favs.some(f => f.src === src)) return
  if (!currentUserIsPro && favs.length >= 10) { showUpgradeModal(); return }
  favs.push({ src, label, addedAt: Date.now() }); saveFavs(favs)
}

function removeFav(src) { saveFavs(loadFavs().filter(f => f.src !== src)) }

function toggleFavPose() {
  const src = currentPoseSrc(); if (!src) return
  const btn = document.getElementById('pose-fav-btn')
  if (isFaved(src)) { removeFav(src); btn.textContent = '☆'; btn.classList.remove('active') }
  else { const entry = sessionEntries[currentIndex]; const label = entry ? (entry.path.split('/').pop() || 'Pose') : 'Pose'; addFav(src, label); btn.textContent = '★'; btn.classList.add('active') }
  btn.classList.add('bump'); setTimeout(() => btn.classList.remove('bump'), 300)
}

function toggleFavAnim() {
  const frame = animFrames[animIndex]; if (!frame) return
  const src = frame.dataUrl; const btn = document.getElementById('anim-fav-btn'); const label = 'Frame ' + (animIndex + 1)
  if (isFaved(src)) { removeFav(src); btn.textContent = '☆'; btn.classList.remove('active') }
  else { addFav(src, label); btn.textContent = '★'; btn.classList.add('active') }
  btn.classList.add('bump'); setTimeout(() => btn.classList.remove('bump'), 300)
}

function renderFavsConfig() {
  const favs = loadFavs(); const grid = document.getElementById('favs-grid-config'); const empty = document.getElementById('favs-empty-config')
  grid.innerHTML = ''
  if (favs.length === 0) { empty.style.display = 'block'; return }
  empty.style.display = 'none'
  favs.forEach((fav, i) => {
    const item = document.createElement('div'); item.className = 'fav-item'; item.style.cssText = 'position:relative;border-radius:8px;overflow:hidden;background:#242424;aspect-ratio:3/4;cursor:zoom-in;'
    const img = document.createElement('img'); img.src = fav.src; img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;'; item.appendChild(img)
    const lbl = document.createElement('div'); lbl.style.cssText = 'position:absolute;bottom:6px;left:6px;background:rgba(0,0,0,0.7);border-radius:4px;padding:2px 6px;font-size:11px;color:#f0c040;'; lbl.textContent = '★ ' + (i + 1); item.appendChild(lbl)
    const removeBtn = document.createElement('button'); removeBtn.textContent = '✕'; removeBtn.style.cssText = 'position:absolute;top:6px;right:6px;background:rgba(0,0,0,0.7);border:none;border-radius:4px;color:#888;font-size:13px;cursor:pointer;padding:3px 6px;opacity:0;transition:opacity 0.15s,color 0.15s;'; removeBtn.title = 'Retirer des favoris'
    removeBtn.onclick = (e) => { e.stopPropagation(); removeFav(fav.src); renderFavsConfig() }
    item.appendChild(removeBtn)
    item.onclick = () => openLightboxFav(fav.src, i)
    item.addEventListener('mouseenter', () => { removeBtn.style.opacity = '1' })
    item.addEventListener('mouseleave', () => { removeBtn.style.opacity = '0' })
    grid.appendChild(item)
  })
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;'
}

let lbFavSrc = null
function openLightboxFav(src, index) {
  lbFavSrc = src; const lb = document.getElementById('lightbox')
  lb.querySelector('img').src = src
  document.getElementById('lightbox-info').textContent = 'Favori ' + (index + 1)
  document.getElementById('lb-fav-remove').style.display = 'block'
  lb.classList.add('open'); document.addEventListener('keydown', onLbKey)
}
function removeFavFromLightbox() { if (!lbFavSrc) return; removeFav(lbFavSrc); lbFavSrc = null; closeLightbox(); renderFavsConfig() }

function renderWeekBar() {
  if (!document.getElementById('week-streak')) return
  const all = loadHist(); const days = document.querySelectorAll('.week-day')
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const sessionDays = new Set(all.map(s => { const d = new Date(s.ts); d.setHours(0, 0, 0, 0); return d.getTime() }))
  let windowStart
  if (all.length === 0) { windowStart = new Date(today) }
  else {
    const firstTs = Math.min(...all.map(s => s.ts))
    const firstDay = new Date(firstTs); firstDay.setHours(0, 0, 0, 0)
    const daysSinceFirst = Math.floor((today - firstDay) / 86400000)
    const blockOffset = Math.floor(daysSinceFirst / 7) * 7
    windowStart = new Date(firstDay); windowStart.setDate(firstDay.getDate() + blockOffset)
  }
  days.forEach((el, i) => {
    const d = new Date(windowStart); d.setDate(windowStart.getDate() + i)
    const isToday = d.getTime() === today.getTime(); const isFuture = d > today; const done = sessionDays.has(d.getTime())
    el.className = 'week-day'
    if (isFuture) el.classList.add('future'); else if (done) el.classList.add('done')
    if (isToday) el.classList.add('today')
    el.title = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
  })
  const streak = computeStreak(all); const streakEl = document.getElementById('week-streak')
  streakEl.textContent = streak + ' j'; streakEl.className = streak === 0 ? 'zero' : ''
}

// ══ HISTORIQUE ══
const HIST_KEY = 'gd4_history'; let histPeriod = 'week'
function loadHist() { try { return JSON.parse(localStorage.getItem(HIST_KEY) || '[]') } catch { return [] } }
function saveHist(h) { localStorage.setItem(HIST_KEY, JSON.stringify(h)) }

function logSession(data) {
  const hist = loadHist(); hist.push({ ...data, ts: Date.now() })
  if (hist.length > 500) hist.splice(0, hist.length - 500)
  saveHist(hist); renderWeekBar()
  if (window.electronAPI?.saveSession) {
    window.electronAPI.saveSession({ poses: data.poses, minutes: data.minutes, cats: data.cats || data.seq || null }).catch(e => console.warn('saveSession error:', e))
  }
  checkBadges()
}

function setHistPeriod(p) {
  histPeriod = p
  document.querySelectorAll('.hist-period-tab').forEach(t => t.classList.toggle('active', t.dataset.period === p))
  renderHistList()
}

function renderHist() {
  const all = loadHist(); const localStreak = computeStreak(all)
  document.getElementById('hist-streak').textContent = localStreak
  if (window.electronAPI?.getStreak) {
    window.electronAPI.getStreak().then(r => {
      const streak = Math.max(r.streak || 0, localStreak)
      document.getElementById('hist-streak').textContent = streak
      const streakEl = document.getElementById('week-streak')
      if (streakEl) { streakEl.textContent = streak + ' j'; streakEl.className = streak === 0 ? 'zero' : '' }
    }).catch(() => {})
  }
  document.getElementById('hist-total-sessions').textContent = all.length
  document.getElementById('hist-total-mins').textContent = all.reduce((a, s) => a + (s.minutes || 0), 0)
  const unlockedCount = Object.keys(loadBadges()).length
  document.getElementById('hist-badges-count').textContent = unlockedCount + ' / ' + BADGES_DEF.length
  renderHistList()
}

function renderHistList() {
  const all = loadHist(); const now = Date.now()
  const cutoff = histPeriod === 'week' ? now - 7 * 86400000 : histPeriod === 'month' ? now - 30 * 86400000 : 0
  const filtered = all.filter(s => s.ts >= cutoff).reverse()
  const list = document.getElementById('hist-sessions-list'); const empty = document.getElementById('hist-empty')
  list.innerHTML = ''
  if (filtered.length === 0) { empty.style.display = 'block'; return }
  empty.style.display = 'none'
  filtered.forEach(s => {
    const row = document.createElement('div'); row.className = 'hist-session-row'
    const dot = document.createElement('div'); dot.className = 'hist-session-dot' + (s.type === 'anim' ? ' anim' : '')
    const info = document.createElement('div'); info.className = 'hist-session-info'
    const typeLabel = s.type === 'anim' ? 'Animation' + (s.seq ? ' — ' + s.seq : '') : s.type === 'cinema' ? '🎬 Cinéma' + (s.film ? ' — ' + s.film : '') : 'Poses' + (s.subMode === 'progressive' ? ' (progressif)' : '')
    const catsLabel = s.cats ? '<span style="color:#666"> · ' + s.cats + '</span>' : ''
    info.innerHTML = typeLabel + catsLabel + '<div class="hist-session-meta">' + (s.poses || 0) + ' frames · ' + (s.minutes || 0) + ' min</div>'
    const time = document.createElement('div'); time.className = 'hist-session-time'; time.textContent = formatHistDate(s.ts)
    row.appendChild(dot); row.appendChild(info); row.appendChild(time); list.appendChild(row)
  })
}

function formatHistDate(ts) {
  const d = new Date(ts); const today = new Date(); today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
  const dDay = new Date(d); dDay.setHours(0, 0, 0, 0)
  const hm = d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0')
  if (dDay.getTime() === today.getTime()) return "Aujourd'hui " + hm
  if (dDay.getTime() === yesterday.getTime()) return 'Hier ' + hm
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ' ' + hm
}

function computeStreak(hist) {
  if (hist.length === 0) return 0
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const days = new Set(hist.map(s => new Date(s.ts).toDateString()))
  let streak = 0, cur = new Date(today)
  while (days.has(cur.toDateString())) { streak++; cur.setDate(cur.getDate() - 1) }
  return streak
}

// ══ GRILLE DE COMPOSITION ══
let gridMode = 0
const GRID_TITLES = ['Grille : off', 'Tiers', 'Diagonales', 'Tiers + Diagonales']
function cycleGrid() { gridMode = (gridMode + 1) % 4; applyGrid() }

function getVisibleImageRect() {
  const area = document.getElementById('photo-area'); if (!area) return null
  const areaRect = area.getBoundingClientRect()
  let el = document.getElementById('photo-img')
  if (!el || el.style.display === 'none') el = document.getElementById('pdf-canvas')
  if (!el || el.style.display === 'none') return null
  const r = el.getBoundingClientRect()
  return { left: r.left - areaRect.left, top: r.top - areaRect.top, width: r.width, height: r.height }
}

function positionGridOverlay() {
  const overlay = document.getElementById('grid-overlay'); if (!overlay) return
  const rect = getVisibleImageRect(); if (!rect) return
  overlay.style.left = rect.left + 'px'; overlay.style.top = rect.top + 'px'
  overlay.style.width = rect.width + 'px'; overlay.style.height = rect.height + 'px'
}

function applyGrid() {
  const overlay = document.getElementById('grid-overlay'); const thirds = document.getElementById('grid-thirds')
  const diags = document.getElementById('grid-diags'); const btn = document.getElementById('grid-btn')
  if (!overlay) return
  if (gridMode > 0) positionGridOverlay()
  overlay.classList.toggle('visible', gridMode > 0)
  if (thirds) thirds.style.display = (gridMode === 1 || gridMode === 3) ? '' : 'none'
  if (diags) diags.style.display = (gridMode === 2 || gridMode === 3) ? '' : 'none'
  if (btn) { btn.classList.toggle('grid-active', gridMode > 0); btn.title = GRID_TITLES[gridMode] }
}

function resetGrid() { gridMode = 0; applyGrid() }

// ══ OPTIONS ══
function toggleOptions() { document.getElementById('options-dropdown').classList.toggle('open') }
document.addEventListener('click', (e) => {
  if (!e.target.closest('#options-btn') && !e.target.closest('#options-dropdown')) document.getElementById('options-dropdown').classList.remove('open')
})
function confirmResetHistory() {
  document.getElementById('options-dropdown').classList.remove('open')
  if (confirm('Réinitialiser tout l\'historique ? Cette action est irréversible.')) {
    localStorage.removeItem(HIST_KEY); renderWeekBar()
    if (document.getElementById('hist-options').style.display !== 'none') renderHist()
  }
}
async function handleLogout() {
  document.getElementById('options-dropdown').classList.remove('open')
  if (confirm('Se déconnecter ?')) await window.electronAPI.authLogout()
}

// ══ RACCOURCIS CLAVIER ══
document.addEventListener('keydown', (e) => {
  if (document.getElementById('screen-cinema').classList.contains('active')) {
    if (e.key === 'ArrowRight') { e.preventDefault(); cinemaNext(); return }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); cinemaPrev(); return }
    if (e.key === 'g' || e.key === 'G') { toggleCinemaGrid(); return }
    if (e.key === 'f' || e.key === 'F') { flipCinemaH(); return }
    if (e.key === 'b' || e.key === 'B') { toggleCinemaBW(); return }
    if (e.key === 's' || e.key === 'S') { toggleFavCinema(); return }
  }
  if (document.getElementById('screen-session').classList.contains('active')) {
    if (e.key === 'ArrowLeft' && e.shiftKey) { rotateLeft(); return }
    if (e.key === 'ArrowRight' && e.shiftKey) { rotateRight(); return }
    if (e.key === 'f' || e.key === 'F') { flipH(); return }
    if (e.key === 's' || e.key === 'S') { toggleFavPose(); return }
  }
  if (document.getElementById('screen-anim').classList.contains('active')) {
    if (animStudyMode) {
      if (e.key === 'ArrowRight') { e.preventDefault(); animNextFrame(); return }
      if (e.key === 'ArrowLeft') { e.preventDefault(); animPrevFrame(); return }
    }
    if (e.key === 's' || e.key === 'S') { toggleFavAnim(); return }
  }
})

async function showAbout() {
  document.getElementById('options-dropdown').classList.remove('open')
  const modal = document.getElementById('about-modal')
  const version = await window.electronAPI.getAppVersion()
  document.getElementById('about-version').textContent = 'v' + version
  const proData = await window.electronAPI.refreshProStatus()
  const isPro = proData?.isPro || currentUserIsPro; const expiresAt = proData?.expiresAt
  const planEl = document.getElementById('about-plan'); const expiryRow = document.getElementById('about-expiry-row')
  const expiryEl = document.getElementById('about-expiry'); const upgradeBtn = document.getElementById('about-upgrade-btn')
  if (isPro) {
    planEl.textContent = '⭐ Pro'; planEl.className = 'value pro'; upgradeBtn.style.display = 'none'
    if (expiresAt) {
      const d = new Date(expiresAt); expiryRow.style.display = 'flex'
      expiryEl.textContent = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
      const daysLeft = Math.ceil((d - Date.now()) / 86400000)
      if (daysLeft <= 7) { expiryEl.style.color = daysLeft <= 3 ? '#E24B4A' : '#f0c040'; expiryEl.textContent += ' (' + daysLeft + ' j)' }
    }
  } else { planEl.textContent = 'Free'; planEl.className = 'value free'; expiryRow.style.display = 'none'; upgradeBtn.style.display = 'block' }
  modal.classList.add('open')
}
function closeAbout() { document.getElementById('about-modal').classList.remove('open') }

// ══ BADGES ══
const BADGES_KEY = 'gd4_badges'
const BADGES_DEF = [
  { id: 'first_session',  emoji: '🎨', name: 'Premier pas',      desc: '1ère session complétée' },
  { id: 'streak_7',       emoji: '🔥', name: 'Semaine de feu',    desc: '7 jours consécutifs' },
  { id: 'streak_30',      emoji: '💎', name: 'Mois de feu',       desc: '30 jours consécutifs' },
  { id: 'poses_100',      emoji: '💪', name: 'Centurion',         desc: '100 poses dessinées' },
  { id: 'poses_500',      emoji: '⚡', name: '500 poses',         desc: '500 poses dessinées' },
  { id: 'poses_1000',     emoji: '🏆', name: 'Millénaire',        desc: '1000 poses dessinées' },
  { id: 'speed_master',   emoji: '⏱', name: 'Maître du 30s',     desc: '20 sessions en mode 30 sec' },
  { id: 'cinephile',      emoji: '🎬', name: 'Cinéphile',         desc: '5 sessions cinéma' },
  { id: 'collector',      emoji: '⭐', name: 'Collectionneur',    desc: '10 favoris enregistrés' },
  { id: 'early_bird', emoji: '🌅', name: 'Lève-tôt', desc: 'Faire une session avant 8h' },
  { id: 'explorer',       emoji: '🗺', name: 'Explorateur',       desc: 'Essayer Poses, Anim et Cinéma' },
  { id: 'poses_5000', emoji: '🔱', name: 'Légende', desc: '5000 poses dessinées' },
]
function loadBadges() { try { return JSON.parse(localStorage.getItem(BADGES_KEY) || '{}') } catch { return {} } }
function saveBadges(b) { localStorage.setItem(BADGES_KEY, JSON.stringify(b)) }
function unlockBadge(id) {
  const badges = loadBadges()
  if (badges[id]) return
  badges[id] = Date.now(); saveBadges(badges)
  const def = BADGES_DEF.find(b => b.id === id)
  if (def) showBadgePopup(def)
  renderBadges()
}
const BADGE_SOUND_B64 = 'data:audio/wav;base64,UklGRnpXAgBXQVZFZm10IBAAAAABAAEAgLsAAAB3AQACABAAZGF0YVZXAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP///////wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/////////////////////////////////////////////////////+/////////wAAAAAAAAAA//////7//v/9//7///8AAAAAAQABAAAA///+//3//f///////////wAAAQACAAAA/f/7//z//v8AAAMABAACAP///v/8//n/+f/9/wAAAwAFAAYABAABAP//+P/z//f//f8BAAQABgAHAAYAAwAAAPr/9v/2//j/+/8AAAYACQAKAAgAAQD3//L/9v/9/wIAAwADAAUABgAFAPn/7//z//z/BAAMABAADgAEAPn/8f/p/+z/+f8EAAsAEgASAAwABgD///L/5P/m//T/AAAJABIAFQARAAwA/P/r/+n/8//4//r/AQANABQAFAAIAPD/4v/t//3/CgAZABoACQD8//L/3P/a/+z/AAASACAAJwAeAAsA+v/e/8f/1f/0/wgAGwAlAB8AFgAIAO7/2//j//X/+//5/wQAFQAcABkA/P/e/+L/+P8EABgAJgAWAP7/8//a/83/3v/2/w0AJAA2ADIAIAAKAOD/sv+0/9r//v8hADwAPQAxABQA1v++/8//8f8JAAsAEwAgAB8AAgDS/8X/5P8MACwAQwA8ABMA7f+9/5z/vv/2/xkAOQBIADkAJwANANr/vP+8/8n/7v8OACwAPwA8AB4A2v++/9r//P8eADEAFgD7/wQA2/+0/8f/8f8XAEEAVQBMADQACACr/3f/mP/b/xkASQBnAGAAQQDx/6T/mv/T//v/AwAZADMARgAjALP/mv/N/wIAQwB0AGkAPwDm/2j/U/+b/+z/OwB2AI8AcgAyAMv/fv+L/7j/2P8PAEwAZQBSAA4AqP+V/9j/IABeAHkASAD0/6v/XP9p/87/GABhAJIAggBWABcAqP93/4L/pP/z/z8AaAB5AFIA1f+O/7L/+v9LAHAASAAAAMf/dP9n/7b/FABYAIIAigBsACoAwP9x/2D/lv/f/zIAeQCQAGgA5P+N/7T/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6v/r/+//+v/6//H/7////xQAGgAmADMAJQD6/8r/tf/A/+X/FwA/AEMAGwDr/9X/4f8BACMAMgAhAPH/wP+s/8b//f82AFcAUAAnAPT/yv/B/9r//P8QABYAEgD9/+P/4f8BACgANAApABQA8f/N/7//1v/4/w4AGgAiAB8AEAADAAcABwD4/+j/3v/k//T/BwAUABYABgD4//7/FAAkABwA/f/Z/8T/yf/p/xUAOQA/ACYA/v/j/9n/4v/8/x8AJwAOAOf/zv/L/+L/EABBAFcAPQAJANn/uv+4/9f/CQAsAC4AGQD6/+X/5/8CACYAMAAYAO//zP+//8///v8vAEIANQATAPH/2v/Z/+//CQATAA8ABgD7/+3/5f/r////HQAyADUAHwD4/8//tf+9/+b/GAA3ADwALwASAOf/yf/S//b/FgAlACIADQDm/8b/zP/1/x4AOgBIADsABgDE/6P/t//q/yEAQQBAABwA6v/S/93//v8aACIAFgD9/+H/0P/a//n/HgAvACcAFAD//+f/2v/l/wAAEwARAAoAAADr/+D/6/8MACYAMAAmAA8A7P/N/8P/0//w/xQANgBCACwABwDk/83/zf/j/wYAJgAvACUACwDg/8D/xf/1/zEAUwBJABoA1/+m/6f/2P8XAEIASQAvAAMA2//J/9T/9/8gADUAKQAEANn/v//F//D/KwBOAD8AGQDw/8r/uf/R/wcAMQAyABcA+//k/9b/5/8NACkAKQARAPb/3//R/9r//v8jAC0AIAAKAPf/5//i/+7/AQAQABcADwADAPD/3f/a//P/GwA2ADUAGgD5/9j/xP/N//D/FQAoAC4AKAANAOT/zf/Z//f/EAAjACsAGADt/83/zP/p/w0ALgA/AC0AAADS/8P/0//y/xcALwArABAA8v/f/97/7/8IAB8AJgAWAPv/5P/U/9v/9v8UACgALAAbAPz/4f/b/+n///8SABkADAD1/+f/6//7/w4AHQAjABYA+//l/9z/3f/s/wkAJQArABYA/v/s/9z/3f/3/xgALgApAA4A6v/H/7r/3f8ZAEQATAA1AAMA0P+2/8H/6/8WAC8ALwAbAP3/4//a/+j/BwAjACgAFgD6/+L/0//X//b/GgAqACMAEAD9/+z/4f/z/w4AEAACAPj/8//x//X/AwAZACAAEAACAPv/7P/m/+3/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+v8gAD8APwAxABYABQD6/+v/3P/V/8n/x//f/wgALgBFAE0ARQAjAO3/wv+2/8L/1//1/xAAIAAiABsAFgAOAAsADQAPAAkA8f/P/7n/uf/X/wcANQBUAF4ARAASAOP/wf+8/8z/3//5/wgABQAHAB0ALwAzACwAFQD5/9r/vv+4/8f/5f8MADgATQBCACMACAD0/+n/5//i/9n/2//k//P/BAAYAC4AOwA0ACIACwDr/87/wv/D/9H/6v8LADEASgBAACQACQDu/+D/4P/n/+j/5//n/+3///8WACwAOgA/AC0ACADe/77/tP/A/9r/+f8iAD4APgA0ACIABADr/+T/6//s/93/zv/a//L/EwA0AEcARQAqAP//3v/N/8T/zf/n/wIAEgAUABUAGAAbABsAFwARAAsA9//X/7v/s//G//L/JwBXAGYASQAUAO3/0/+//8D/0//w/wYAEgAeACcAHQAXABoAFgADAOX/0P/P/9b/4f/4/xMAJAAuAC8AJQATAP//7v/i/9z/3f/Z/97/9f8RACYANgA5ADEAGwD1/9P/yP/A/8X/3/8DACkAQQBGADkAFwDu/9j/2P/m//P/8//n/+X/8v8NACYANgA3ACwAEQDy/9j/wv+6/8n/8f8fADcAMwAqABsABQD2//P/+P/1/+X/2f/a/9v/7/8ZAEIAUQBBAB8A9v/U/7v/vP/V//P/DQAbAB8AHQAaABcAFAAQAAoA8v/W/8f/zP/c//T/GAA4AEMAMQAUAPr/5v/c/+T/6//s/+f/6/8AAB8ALQAuACcAEwD4/+r/3//a/9//6v/0/wAADAAaACcAKwAiABAA9v/g/9f/2f/f/+z/AAAQABoAIAAjACEAFQALAPv/5P/G/7r/y//y/x0APABJADYAFQD0/+H/3v/g//D/AQACAPb/8v/2/wMAGAApACsAHAAFAPH/4v/W/9H/2//w/wQAGwAvADcALwAbAP7/4P/O/8v/1//s/wIAFQAhACMAIAAXAAkA+v/2//X/7//m/9//3//z/w4AKQAzACUADAD6//L/7v/u//D/6v/k/+v//f8QABsAIwArACkAEwDy/9z/y//F/9P/8/8XAC4AMwAqABcA///p/+X/7v/2//3/+//0/+7/7v/4/xIALwA9ADEADgDk/8b/u//M//L/FAAiACIAHwAXAAUA9//7/wUA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HgAXAAgA+P/z//3/DQAUABIACAD2/+H/2P/e/+3/AQAaADAAMwAiAAYA7v/e/9f/3//w////CAAQABQAFAAVABMACgD7/+z/4//i/+n/+P8LABcAGQATAAkA/f/1//j/BAAKAAYA/f/v/+H/3f/r/wcAIwA1ADUAIgAAAN3/x//G/9r/+/8aACsAKAAYAAUA9v/x//f//f/8//z//P/3//H/8//+/woAEgAXABsAFwAFAPH/5v/g/97/5//9/xMAHwAiAB0AEAD///H/6//q/+3/8v/3////CAAQABMAFgAVAAwA+//r/+f/8P/4//7/BAAFAPv/9v/+/wwAGgAfABwADADt/9H/yf/Z//X/FAAtADgAKgAMAO//3f/b/+n//P8KAA8ACQD7//P/+f8JABcAGgAUAAYA8//h/9z/6P/5/wUADgAXABUACgADAAQABQAAAPj/8f/s/+r/7f/5/wwAGwAgAB0AEwADAPH/4//d/+T/9f8EABAAGwAaAAwA/v/7//3//f/8//7//v/3/+3/7//8/wcADwAYAB4AFAAAAPD/6P/m/+r/9v8DAA0ADgAJAAYACQAPAA4ACAD8/+v/3v/b/+n/AgAYACAAIgAdAAoA8P/i/+f/9P8AAAoADwAGAPb/7f/z/wIAEwAfACIAFQD4/9v/zf/R/+n/DAApADQAKwATAPH/3f/d/+z/AAARABUACQDv/+H/6f8CABsAJwAmABYA9//b/9T/3//z/woAHQAfABAA/f/0//j/BQANAAoA/v/u/+P/5f/z/wgAHQAmAB8ADgD7/+n/3//m//n/BQAIAAoACwAGAPz/+P///wkADgANAAgA/P/r/+H/6P/1/wMAEwAhACQAGwAHAOz/2v/Z/+f/AAAXAB8AEwD9/+7/7f/8/w8AHwAgAA0A6//O/8z/4/8EACYAOgAyABIA7P/W/9b/5f///xkAIwAVAPn/5v/l//L/BwAdACYAHAAFAOz/2//a/+f/+/8PAB0AHQARAAAA+f/7/wAA///7//b/8f/u//f/CAAUABcAFwAPAP3/6v/i/+j/9/8IABUAFgAKAPv/8v/z//v/BwATABcADQD5/+f/3P/g//T/DQAeACQAHwAOAPn/6v/k/+f/8f///w4AFwARAAUA/P/3//f//f8FAAoACAACAPn/8P/t//T///8KABUAGgAWAAkA+P/p/+D/4//2/w4AGAAUAAgA///4//j/AQALAAkA/P/y/+//8//8/wgAEgATAAgA/f/4//f/+/8EAAkABAD2/+7/7v/3/wcAFQAcABoADAD2/+T/4f/s//7/DQAUABIABgD4//T/+P8AAAYACgAJAP//8P/r//T/AQAMABQAEwAJAPv/8//3//3////+//z/+f/4//3/BgAOABAADQAEAPf/8P/y//j/AgALAAwABAD4//H/9f8AABAAHAAZAAMA5//Z/+H/9v8PACEAIQAQAP3/8f/s/+//+f8FAA4ADQAEAPn/8P/w//v/CwAVABUADAD9/+//6//1/wAABAAHAAYAAQD9////BgALAAcA/v/5//X/8//5/wIACQAKAAYABAABAAAAAQABAP7/+f/0//P//f8NABUADwD///L/7f/z/wIAEgAWAAwA+//u/+n/6//5/xAAIAAeABAA+//l/9z/5f///xcAHgAVAAYA8//l/+n//f8UAB8AGAAEAO3/3v/i//b/DAAbAB0AEgAAAO7/5P/n//f/DgAfAB4ACwDy/+H/4P/x/wwAIgAmABcA/f/j/9X/3f/3/xQAJgAkABEA+P/l/+P/8f8CABAAFwAUAAUA8v/n/+r/9f8FABUAGQAPAP//9P/x//L/+f8EAAsACAACAP7//v///wMABwAFAPv/8//3/wAABgAFAAEA/v8AAAMABQAEAAAA+f/3//r/AwALAAsABQD+//X/7P/u/wAAFwAhABkABQDs/9j/1//u/xAAKQAsAB0AAgDi/87/2P/4/xsALgApAA8A6//R/9L/7f8QACsALwAbAPv/3//U/+L/AAAbACIAFAD///D/6//y/wEADgASAAoAAAD2/+v/6f/4/w4AHAAaAAoA9//q/+n/9/8KABIADwADAPT/7P/v//3/DQAUABIACwD9//H/8f/4//7/AQADAAcACAAFAAEA/v/6//n//f8DAAUAAQAAAAEA/f/5//j//f8HABIAEgAJAPr/7P/n/+7/+/8MABYAFQAOAAEA8f/n/+3/AAATABkAEwAEAO7/3f/j//z/FQAgAB0AEAD6/+T/3//r////DwAUABMACwD8//P/9P/5/wEACgAKAAQA+f/w//L//v8NABQADQD9//L/8v/7/wcADwAMAP//8f/u//T//P8IABQAFwAPAAEA9f/u/+r/7//7/wcADgASAA8ACAD8//H/8//8/wQACQAIAP7/9//3//r///8GAAsACgAEAP3//P/+//7//v/8//f/9f/7/woAFwAXAA0A/v/v/+j/7P/3/wUADgAQAAoA///3//j//P8EAA4ADgAFAPf/7f/t//T///8OABcADwACAPn/9v/4////BgAFAPn/8P/1/wIADQARABEACwD+//H/7v/0//v/AwAIAAYAAQD7//z/BAAMABAADAD+//H/6v/r//b/CAAVABYACgD6//L/8//8/w0AFwAOAPj/5f/f/+r/AQAaACcAHwAIAPL/5f/n//X/BgAPAAkA/f/2//f///8LABIADwAGAPv/8//v//D/+f8FAAsADQAKAAIA+v/6/wAACAAIAAIA/P/1/+7/7//5/wcAEwAZABYACQD5/+//7f/x//j//v8CAAYACQANAAwABAD8//r/+P/4//z/AgAEAAIA/v/9//z//f8FAA8AEgALAP//9P/s/+r/8P/+/wsAEgAUAA8ABAD6//j/+v/+//7/+//2//T/+v8CAAoAEQATAA0AAgD3//L/8f/y//j/AwAJAAgABwAFAAEA/P/9/wUACwAIAP7/8v/o/+f/9v8MABwAHgAUAAUA9v/s/+z/8//8/wQACQAHAAAA+//9/wMACgAQAA4AAgD1/+v/6v/v//n/BwAVABgAEgAJAP3/8v/v//X///8EAAIA/f/6//r/AQAKAA8ADgAIAAIA+//1//H/8P/w//f/BgAVABsAGAAMAPv/6//m/+///P8GAAwACwADAPj/8//4/wcAFgAcABYAAgDn/9j/2f/s/wgAHwAlABoABQDz/+3/8/8BAAsABwD7/+//6v/v/wAAFwAoACMADQD0/+H/2P/h//j/EQAeABwAEAD9/+v/5v/z/wcAFwAcABUAAQDn/9f/2//u/wcAHwAsACkAFgD7/+L/1v/a/+3/BQAWABsAFgAKAP7/9//1//n/AQAIAAkA///y/+r/7f/7/w8AIAAgAA8A+f/r/+j/7//+/woACwADAPn/9f/4/wAADwAeAB8ADgD0/93/0f/Y//H/EwAsADIAIgAFAOj/2f/g//X/DQAbABoACQDw/9//3//w/w0AKgA3ACcAAwDc/8b/yP/i/wgAKAA0ACkAEADz/9//3v/v/wYAFQATAAUA8f/j/+n//v8VACMAIwAVAPz/5v/b/9//7/8GABkAHQAQAPz/8f/y//3/DAAYABcABQDr/9X/0v/k/wYAKgA9ADUAFwDv/8//yP/Z//j/FwAoACQADQDz/+X/6v/6/wwAHAAeAAwA8f/d/9n/5P/5/xUAKgAsABoAAADq/9//4//0/wkAEQALAAAA9f/w//b/BwAbACcAHgAFAOX/zP/K/+D/BQApADsAMQATAO7/1f/S/+X/BgAiACcAEwD0/9v/1f/o/w0ALwA6ACgABADe/8b/x//i/wgAJgAvACQACwDv/+P/7f8BABEAFAAIAPX/4//f/+3/BQAaACYAJQAUAPv/5f/d/+H/7/8CABEAFgARAAcA/f/4//v/BAALAAsAAwD2/+b/3//n//3/GAAsAC4AHAD7/9z/0v/e//b/EQAhABsAAgDp/+P/7/8GAB4ALwAmAAYA4f/I/8b/2/8AACkAPwA2ABgA9f/c/9P/3//5/xEAGwATAAIA8f/r//L/AgAWACIAHQAJAO//3P/W/+D/9/8TACUAJQAWAAQA8//q/+7/+/8GAAYA/v/2//H/8v/+/xEAIQAhABMA///o/9n/3f/w/wgAGAAaABAA///x//L/AAAPABcAEwAAAOf/1v/X/+3/CwAnADcAMAATAO//1P/N/9v/9f8QACIAIgATAP3/7v/r//T/AwASABkAEwAAAOj/2//e/+v/AwAfAC8AKgAUAPr/5//c/9z/7f8DABAAEAALAAcABQACAAUACQAFAPv/8v/s/+z/8v/+/w4AGQAZABAAAgD2//D/8f/5/wMABwABAPb/7v/0/wIAEQAeACIAFQD8/+X/2P/b/+r/AQAZACMAGwAKAPn/8P/z////CwAOAAQA8//l/+L/8f8IABwAJQAiABMA+//j/9r/4v/x/wEADwAXABQACAD+//7/AAAAAAEAAgD9//b/8P/w//b///8IABMAGgAZAA4A/f/t/+X/5P/s//v/DAATAA8ACAAHAAUAAgACAAQA///z/+n/6v/z//3/DAAcACAAFAAAAPH/7v/w//f/BAAJAAEA9P/v//f/CQAaACMAHQAJAO3/2f/W/+T/+/8QABwAHwAWAAUA9f/v//T//P8FAAwACAD5/+r/6P/x/wIAEwAhACQAGAADAO7/3f/W/9//9v8PAB8AIgAaAAkA9//w//T/+f/+////+//1//T/+/8IABQAGQAVAAoA+P/q/+j/8P/7/wYACwAHAP3/9v/6/wcAFgAdABYAAgDq/9n/2P/n/wEAFwAiAB8AFAAFAPX/7f/x//r//v/8//r/+//6//3/BwATABcAEgAIAPz/7v/i/+P/8P8AAA0AFwAaABQABwD6//L/7//0/wAACgALAP//7f/l/+7/BAAdACwAKgAVAPT/2P/O/9j/7v8JACAAKQAdAAYA9P/v//P//P8IAAsAAgDx/+X/6f/6/xAAIgAnABgA/v/o/9//5f/1/wYADwALAAEA+P/2//7/DgAdACEAEQD0/9r/zv/V/+//EgArADIAJQALAO//3f/c/+z/AwAVABkADAD4/+n/5f/x/wgAHwAsACUADQDs/9D/xP/T//f/HQA0ADUAJQAHAOj/1//c/+7/AQAPABQADQD6/+z/8P8DABQAHgAbAAoA8v/e/9r/6P/8/w4AGAAWAA4AAgD5//r/AwAJAAgAAADz/+b/3//m/wEAIQA1ADIAGgD3/9b/yf/X//T/DwAfACAAFAABAPL/7v/3/wUAEQAWAAwA9P/f/9f/4f/7/xkALwAyACAAAwDl/9P/1//t/wgAGQAZAAoA9//q/+z/AAAZACgAIwALAOj/zf/G/9v/AQAmADsANgAZAPf/3v/V/+D/9/8MABcAEAACAPb/8P/1/wcAGgAfABQAAQDu/+D/3f/o//3/DwAYABkAEgAIAP7/+f/6//z/+//4//T/8f/z//r/CAAYACIAIQARAPj/4v/W/9v/8P8JABoAHgAWAAcA+P/u//D///8PABYAEAD+/+b/0//X//P/GAA1AD8ALgAGANr/wP/E/+L/BwAmADAAIAAEAOz/5f/v/wMAFgAdABIA+f/i/9b/3f/1/xIAJwAsAB8ACADw/+L/4v/t//z/CAAMAAYA/f/8/wQADwAVABIABwDz/+L/3v/m//X/BwAYACEAHAAMAPz/8//w//T//f8BAP//+f/2//f//P8FABEAGgAaABEAAADt/9//3f/p//3/DwAbABwAFAAFAPr/8//2//z/AgAEAPz/8f/r/+3//f8VACkALQAeAAAA4f/N/87/5v8HAB0AJAAdAAwA+v/v//L/+/8EAAoACwACAPP/5//m//P/BwAaACYAIgAOAPf/5//h/+X/8P/9/wkADgANAA0ADQANAAoAAgD3/+7/5//o//L/AgAQABYAFgARAAYA+P/x//T//P8BAAIAAAD5/+//7v/6/wwAHQAmACIAEADx/9X/zP/X//D/DwAnAC0AIAAHAPP/6v/s//f/AwAKAAcA/f/y/+//9v8EABEAGgAaABAA///u/+X/5v/s//j/BQAPABQAFAATAA4AAgD2/+7/7f/w//b/+////wIABwAQABYAFQANAAAA8P/m/+f/8////wcADQAOAAUA/f/+/wUADQAOAAkA+//p/9z/3v/x/wsAIgAsACYAEQD2/+H/3P/m//r/CgAQAAsA/f/x//L/BQAZACUAHQAFAOn/0f/N/+L/BAAeACcAIQASAP7/7v/r//b/AQAGAAUAAAD1/+z/7f/8/xAAHQAfABYABwD1/+b/4P/k//D///8OABkAHAAUAAcA/f/4//b/9P/0//X/9//5//3/BwAQABUAFQAQAAQA9f/p/+j/7v/5/wUADQAMAAQA/v/+/wMADAATABEAAwDv/97/2v/j//n/FgAsADEAIwAKAOz/1f/S/+X/AAAVABsAEwACAPL/7v/7/w4AGwAaAA0A9v/f/9P/2v/z/xEAJgArAB8ACwD2/+b/4//v////CQAKAAIA9v/u//T/CQAhACgAHAADAOj/0//Q/+P/AQAbACYAJAATAPv/6//r//f/BQAMAAkA/P/s/+X/7/8BABQAIQAjABgAAwDt/97/3f/o//v/CgASABQADwAGAAAAAQAEAAYAAQD4/+3/5f/o//b/CgAaACIAIQAVAP//6v/f/9//7P8CABQAGAAOAP//9f/1//z/CgAXABcACwD4/+T/1v/X/+z/DgAsADcALgATAPL/2f/S/9z/8v8JABkAGgANAPv/8v/3/wYAFQAYAAwA9v/j/93/5f/5/xAAHAAcABMABAD2//L/9/8BAAYA/v/z/+z/6v/x/wgAIgAwACsAEgDx/9L/xf/U//b/GAAqACYAEwD8/+v/6v/3/wgAFQAUAAYA8f/d/9v/6/8GAB8AKQAiABIAAADu/+L/4f/p//b/BQAPABQAEQAKAAUABAACAP7/+v/2//L/7//x//j/AQANABsAIAAXAAUA8v/m/+T/7P/8/wkADgAKAAIA+//6/wIAEAAbABUAAgDr/9n/1f/l////GwAsACkAFwD//+v/5P/r//n/BAAHAAEA+f/2//n/AwAQAB4AIAASAPn/4P/T/9j/7v8OACQAJQAWAAQA9v/w//T//v8IAAsAAwD2/+n/4f/q/wMAIAAxAC4AFgD0/9n/zv/X/+//CwAeACMAFwACAPL/8P/6/wkAEQAMAPv/6f/g/+X/9v8OACAAJQAcAAkA9v/p/+j/8P/5//3//////wEABAALABMAFgAQAAUA+P/p/9//4//z/wQAEgAZABsAFAAHAPj/7//t//D/+v8GAAoABQD8//X/9f/9/wsAGgAiABsABADl/83/yv/g/wQAJwA5ADAAEgDy/+H/4P/r//7/DgARAAUA8//o/+z//f8ZAC4ALAATAPD/1P/M/9r/+P8XACgAIwAPAPn/7P/t//z/DgAWAA8A+//l/9n/3v/1/xQALAAzACUABwDo/9b/2P/n//3/DwAVABIACQD///r//P8FABAAEQAFAPL/4v/b/+X//f8WACUAJAAZAAkA9v/m/+L/6//4/wYADgANAAMA+f/4/wEADAAUABUADAD5/+T/2f/d/+//CQAgACoAJAASAPr/6f/j/+n/9v8DAAoACQAAAPf/+P8CAA4AGAAaABAA+//l/9j/2//r/wMAHQArACMADQD3/+v/6v/0/wMACwAGAPr/8P/u//X/BAAXACYAJAAPAPP/2//T/97/9v8QAB8AHgAQAP7/8f/x//3/DAAVAA8A+f/i/9j/4f/6/xYAKgAtAB0ABADt/+D/3v/o//z/DAAQAAkAAwD//wIACgARAA8AAwDy/+j/6P/t//n/CQATABQADwAIAAIA/f/6//r/+f/2//T/9//8/wIABwALAA8AEAAOAAgA///1/+v/4//k//D/BAAZACcAJwAWAPr/5v/i/+z/+f8EAAkABgD///r//P8CAAgAEAAWABEA/v/q/9//4f/v/wIAFQAcABcACwABAPv/+v/7//3/+//1/+//7//4/wcAFQAeABwADwD8/+3/5v/p//P//v8HAAsACAACAAEABQALAA4ACwACAPT/5//j/+v/+v8KABgAIQAbAAkA+P/v/+7/8//6/wAAAAD8//r///8HAA0AEgASAAsA/f/v/+n/6v/y//7/CQANAAsACQAHAAcACQAHAAAA9//t/+b/6f/1/wcAGAAeABoADgD+//L/7//z//b/9v/4//7/BAAJAA0ADwAKAAMA/v/9//v/+P/2//b/9f/2////DAAVABYAEQAIAPr/7v/r/+//9v/9/wIABQAHAAgACQAMAA0ACQACAPn/7//o/+b/7v8AABUAIQAfABQAAgDv/+X/6v/5/wQACAAGAAEA+v/2//7/CwAVABcAEAABAO7/3v/d/+z/AAASAB0AHAAQAAAA9f/0//r///8BAAAA+P/w//D/+P8HABcAIAAdAAwA9v/l/9//5//4/wcADwAPAAoABAABAAMACAAIAAIA+v/x/+j/6f/0/wUAFQAdABoADgD8/+//7//1//v//v/+//7//v8AAAYACwAKAAcABQAEAAEA/P/2//D/6v/r//j/DAAdACQAHgAMAPX/4//e/+f/+P8GAA4ADgAKAAMA//8BAAYACQAHAP//9v/t/+j/7v///xAAGAAXABAAAgD1/+//9f/+/wEAAAD9//j/9P/4/wcAFwAdABcACQD3/+b/3//n//j/CAARABIADgAHAAAA/v///wEAAQD7//b/8v/x//f/AQAOABkAGAAPAAIA9P/q/+n/8v/+/wUABgAHAAcABAADAAQABQAFAAQAAQD7//H/6//v//n/BwATABgAFQALAP//9v/x/+//8//5//3/AgAIAAwADgALAAYAAQD8//j/+f/6//n/9v/1//n/BAAPABcAFgANAAAA8v/q/+z/9P/8/wMACQAMAAoABgAGAAYAAQD6//j/+P/4//n/+/8BAAQABQAIAAkABgACAAEAAgACAPz/9v/w/+3/8P/9/xAAHgAiABkABgDv/97/3P/p//7/EAAZABYACwD///j/9//8/wEAAwABAP7/+v/2//X//P8FAAwADQAKAAcAAwD+//3/+//1/+//7v/2/wMAEAAaABwAEgAAAPD/5//n//D//v8LABAADgAIAAEA/P/7//7/AgAGAAUA///3//H/8P/2/wAADgAZABkAEAACAPT/6v/n/+7/+/8HAAwADwAPAAoAAAD4//X/+P/+/wYACQAEAPn/8f/w//j/BwAVABoAEwAFAPb/6v/n/+7/+v8GAAwADQAMAAgAAgAAAAAA/v/7//n/+P/3//j/+/8EAA0AEQAPAAcA/P/z//D/9f8AAAgACQADAPr/9f/2//7/DQAZABcACAD2/+j/4f/m//f/DgAdAB0AEgADAPP/6v/t//3/DQAQAAgA+//v/+v/8/8EABcAIAAZAAgA9P/k/9//5//5/w0AGQAZABAABAD5//H/7//3/wMACgAKAAYA/P/y/+//9/8FABEAFQAQAAYA+P/u/+z/8v/8/wUACwANAAgAAgD+//3/AAAFAAUA///4//D/7P/z/wMAFgAhABsACQD1/+T/4P/s/wMAFgAZAA8A///v/+j/7/8CABUAHgAXAAQA7//h/+D/7f8DABgAIwAeAA0A9v/l/+H/7P8CABcAGQAMAPr/7P/o//P/CAAbACEAFQAAAOv/3P/c/+//CgAgACQAGQAEAO3/4P/m//n/DgAbABcABwDz/+X/5f/1/wsAHQAgABQAAADt/+L/5f/z/wcAFQAVAAwAAgD4//P/9////wcACgAHAAAA+P/x//H/+v8IABMAFwAPAAAA8f/q/+7/+P8GAA8ADgAGAP3/9v/0//v/BwARABIACAD4/+r/4//p//3/FgAlACEADgD0/97/2P/p/wUAHgAnABsAAQDn/9r/4P/3/xIAJgAnABUA+f/h/9f/3//1/xAAIgAiABUAAQDu/+X/6//6/wkAEAAMAAMA+f/z//f/AQAKAA0ACAAAAPr/9f/2//7/BQAKAAkAAgD6//X/9v/9/wgADgAPAAcA+//w/+v/7v/6/wwAGgAbABAA/v/u/+X/6v/6/wsAEwASAAgA/f/z//D/9/8CAAsADwANAAQA9//u/+//9/8CAA0AEwAPAAQA+f/x//L/+f8EAAsADAAFAPz/9f/0//n/AwAMAA8ADAAEAPj/7f/t//b/AwAPABQADgACAPX/7//y//z/CQASAA8AAgD0/+z/7//7/wsAFwAVAAkA+//x/+z/8P/8/wgADwAPAAcA/P/z//P//f8IAA0ACQABAPn/9f/2////BgAHAAYAAgD8//r//f8BAAYACAADAPv/9f/1//v/BAAJAAwACgAEAP3/+v/5//j/9//6/wAABgAKAAwACQACAPj/8v/0//3/BgAMAAsABAD7//b/9f/3//z/BgAPABAADAABAPT/7f/w//n/BQAMAA0ACQADAP7//P/8//z//P/+/////v///wMABQAEAAMAAQD/////AAABAAAA/f/7//v//f///wIABQAHAAgABgAAAPn/9v/6//7/AAACAAIAAQAAAAIABAAFAAMAAgAAAP3/+P/2//n//f8CAAgADAAKAAUA///6//b/9//8/wIABwAGAAIA/f/7//3/AgAIAAsACQAAAPb/7//w//r/BQAOAA8ABwD7//j//f8EAAgABgD///b/8f/y//z/BwAPABEADgAEAPf/7//x//n/BAALAAoAAwD7//f/+P/+/wgADwAPAAcA+v/w/+z/8P/7/wcADgAPAA0ACgAEAPz/9v/z//L/9v///wgADAAMAAYA///5//f/+/8EAAoACgAEAPr/8f/v//b/AAAMABQAEwAJAP7/9v/z//X/+////wAA/f/8/wMADQATABIACQD7/+3/5v/r//j/BwAUABcADwABAPT/7//1/wMADgAQAAgA+//w/+v/7f/5/woAFwAcABcACgD3/+b/4v/r//n/CAASABMACwAAAPn/+v///wQABgADAPr/8v/x//j/AgALABEADwAIAAAA+f/1//f/+////wAA///8//v///8GAA4AEgAOAAUA+f/v/+n/6//3/wQADwATABAACAAAAPz/+f/4//n/+//+/wAAAAAAAAAA//8DAAoADQALAAUA/f/z/+v/6//z/wAADQAWABgAEAACAPb/8v/0//r/AQADAP7/+P/1//v/BQASABoAFwAIAPX/5v/h/+v//P8MABUAEwAJAP3/9//5/wIACwALAAMA9//r/+f/8P8BABEAGQAaABEAAgD0/+z/7f/z//z/BAAHAAQAAAAAAAQACgAOAA4ABwD5/+v/5f/p//X/BgAVABoAFAAIAPz/9//3//r//f/+//z/+P/4//v/AQAJABAAEwAQAAYA+f/u/+v/7v/1//7/BwAMAA4ADgALAAcAAAD6//b/9P/0//X/+v///wMABwAOABIAEAALAAIA9v/s/+f/7P/3/wQADwAUABEABwD9//r//P8BAAYABQD7/+z/5f/q//z/EwAkACgAGwADAOr/2v/b/+v/AQAUABoAEQAAAPP/8v8AABAAGAATAAIA6//b/9z/7v8GABoAIgAdAA4A/P/x//H/9v/7//3//f/5//b/+f8DAA4AFwAaABQABQDy/+P/3v/l//X/CAAXABwAGAANAP//9P/x//b//v8DAAIA/f/2//L/9v8AAA4AGQAdABYABQDx/+H/3P/k//X/CQAXABoAFgANAAMA+//5//r/+v/4//b/8//z//j/BQATABsAGgARAAMA8//m/+P/6//4/wYAEQATAAwAAgD8//7/BAAKAAsABAD2/+b/3f/j//j/EgAnAC8AJgAOAPD/2f/V/+L/+P8NABkAFgAGAPb/8//9/w4AGgAZAAkA7v/Y/9P/4//+/xkAKQAoABYA/v/v/+z/8v/7/wEA///3//H/8//+/w4AHQAhABkABwDy/+L/3f/k//T/BgASABUAEgALAAMA/////wAA///8//b/8P/u//L/+v8FABIAHAAgABoACgD1/+D/1P/Y/+z/BQAaACUAJAAUAP//8P/t//P//f8FAAYA/f/u/+f/7/8DABoAKgAqABcA+f/e/9L/2f/u/wcAGAAbABIAAgD4//r/BgASABMABwDx/9z/1P/f//v/GgAsAC0AHwAHAO7/4f/k/+7/+f8CAAcABQAAAP7/AwAOABcAGAARAP//6P/Y/9f/5v/+/xYAJAAkABgABwD3/+7/7v/0//v/AAAAAPr/9P/0////DwAeACIAGwAKAPH/2//S/9r/7v8IAB4AKAAiABIAAADz/+//8//4//v/+v/3//X/+P8AAA0AGQAdABcACwD6/+j/3//h/+v/+f8JABYAGwAWAAwAAwD9//v/+f/4//b/8P/t//D/+v8IABgAIwAjABYAAADn/9n/2//r//3/EAAXABEABAD8//3/CgAVABcACQDz/9j/yf/V//b/GwA0ADcAJgAGAOn/2//g/+////8JAAoAAQD2//L//f8QACAAJAAXAP//5//Y/9f/5f/7/w4AGgAdABgADQACAP3/+//5//P/7f/s/+//9/8DABEAGgAbABYADgACAPP/5//g/+H/7P/9/w4AGwAfABoADQAAAPb/8//0//T/9P/0//P/9v8AAA8AGgAeABsADwD7/+f/3f/g/+////8LABAADQAHAAUACQAPABAACgD8/+r/2//X/+H/+v8ZAC8ANAAnAA0A8P/a/9X/4f/1/wYAEQASAAsA/v/3//7/DQAYABoADwD2/93/0P/X/+//DQAkACwAJgASAP3/7//r/+7/8//2//b/9//7/wIADAAXAB0AGQAMAPz/7P/h/+D/6v/6/wcADwASABIAEAAMAAkABQD9//L/6f/l/+b/8P8BABIAIAAkAB4ADwD9/+3/4//h/+f/9P8EAA8AEwAQAAsABQACAAQABwAEAP3/8//o/+P/5v/1/wwAIQAtACoAGQD+/+T/1v/W/+P/+P8LABcAGQAUAAoAAgABAAQABQAAAPb/6//j/+X/8/8HABoAIwAiABkACAD0/+b/4//n//D//P8FAAkACAAJAA4AFAAVABAAAgDu/97/2f/i//f/DQAbAB4AFwALAAIA/v/+//7/+f/v/+f/5f/r//z/EwAmACwAIgANAPb/4//a/97/7P/7/wcAEAAVABIADQAJAAYAAgD9//j/8v/u/+7/8v/5/wEACQASABoAHAAYAAsA9//i/9T/1v/m////FwAnACcAGgAIAPn/8P/v//P/9//4//b/9f/3/wAADQAaACAAGwANAPr/6P/f/+H/6//4/wYAEAATABMAEgARAA4ABAD3/+r/4f/g/+v//v8QABkAGgAUAAwAAwD9//r/9//y/+7/7f/x//j/AwAQABsAHwAaAA8A///u/+L/3f/g/+7/AQASAB0AIQAaAA4AAQD4//D/6//q/+7/9v/+/wUADQAQABAADwAOAAoAAgD3/+3/5f/j/+r/+v8MABkAHwAeABUABgD4/+z/5v/l/+z/+P8DAAkADQAQABEAEQAPAAoA///z/+f/4P/i/+3///8TACMAJwAeAA0A+v/t/+f/6P/u//b//P8AAAUADAAQABMAEwAQAAYA9//q/+X/5//v//v/BwAOABAAEQAUABQADgACAPL/4f/Y/93/7/8GABsAJQAiABUABQD4//L/8P/w//H/8v/0//r/AwAMABMAGAAVAA0AAgD3/+//6//q/+3/8v/7/wgAFQAeACAAGQAKAPb/4//Z/93/6/8AABMAHAAXAAsAAQD+/wEABgAIAAEA8v/k/9//5//5/w4AIAApACMAEgD//+//5P/h/+X/7f/5/wYAEgAbAB4AFwALAP3/8f/q/+r/7//4/wAAAwAEAAUACAAMABEAFAARAAQA8//j/9z/3//s/wIAFwAiACQAHAAPAP7/7v/k/+P/6P/z/wAACwAQABEADgALAAkABwAEAP3/9P/r/+f/6f/y/wAADwAaAB4AGwARAAQA9v/q/+L/4f/o//b/CAAXAB8AHwAUAAYA+f/w/+z/7v/0//r//v8BAAMABQAIAA0AEwAVAA8AAwDz/+P/2v/e/+7/AwAWACMAJgAeAA8A/f/u/+P/4P/l//H/AQAQABcAFwAQAAYA///9////AQD///f/7P/n/+n/9f8JAB4AKQAlABYAAADq/9z/2//m//f/BgAQABQAEQAMAAkACQAIAAIA+f/v/+j/5v/u//3/DAAWABoAFwAPAAYA/P/1//H/7f/s/+7/8//9/wsAGAAfAB8AFQADAPH/5P/e/+P/8P8BABAAFgAVAA4ABgAAAP//AQAAAPv/9P/s/+n/7f/7/wwAGwAhACAAFQADAPD/4v/d/+D/7P///xEAGwAcABUACgAAAPn/+P/5//j/9f/y//H/9P/8/wgAFQAeAB8AFQADAO7/3//a/+H/8/8IABgAHAAXAAwAAQD8//7/AgABAPj/7//o/+j/8v8FABgAIgAhABYABQDz/+f/5v/s//T/+/8BAAUACAANABMAFgATAAkA+f/p/9//3v/q//3/DwAbAB4AFwAKAP//9//1//b/+P/4//f/9f/1//r/BgATABsAGwAUAAcA9v/l/9z/3v/r//3/EQAgACMAGQAJAPz/8//u//D/9v/7//z/+//7//7/AwAMABYAHAAYAAkA9v/j/9j/2v/q/wMAGQAlACIAFQADAPb/8P/y//f/+v/6//j/+P/7/wEACgAUABkAFgALAPz/7v/l/+P/6//4/wUADwAUABMADgAJAAYAAwD9//X/6//l/+b/8v8GABYAIAAgABYABQD0/+r/6P/t//X///8FAAUAAwADAAgADgARABEACQD8/+3/4f/f/+j/+f8NAB0AIwAdAA4A/P/x/+z/7P/x//n/AAACAAIAAwAGAAkADAAOAA4ACAD7//D/5//i/+b/9P8KABwAJgAjABYAAgDu/+L/4v/q//b/AwALAA4ACwAGAAMABgAKAAwABgD6/+3/5v/n//P/AwARABgAFwAPAAUA/v/7//r/+P/y/+z/7P/y////EQAeACEAGgAKAPj/6f/i/+b/8f/+/wkADgANAAgABAAFAAcACAAFAP//9f/s/+j/7P/3/wUAEwAdAB0AFQAHAPj/7f/m/+b/7P/5/wYAEAAUABMADAAFAP7/+//8//3/+//3//P/8f/z//3/DAAYAB0AFwALAPz/7P/k/+b/7v/4/wQADgATABIADgAKAAcAAQD5//P/7f/q/+7/+P8GABEAFgAVAA8ABgD8//X/8v/z//X/+P/7////AwAGAAoADwAQAA0ABgD7/+//5//l/+7//v8LABQAFwATAAoAAgD+//v/9//z//D/8f/z//v/BgASABgAGAARAAQA9v/s/+n/7f/0//3/BQAKAAwADAALAAgABQACAP3/9v/y//D/8v/3////BwAPABIAEgAPAAcA/v/0/+3/6f/r//P/AAANABcAGQATAAcA/f/2//P/9P/3//r/+v/6//7/BQALABAAEwAQAAcA+v/w/+z/6//w//n/AwALABAAEgARAA0ABQD7//L/7P/r//H/+/8GAA4AEAAMAAcAAgAAAAAAAQAAAPv/9P/v/+//9v8CAA8AGgAbABQABwD5/+3/5v/n//D//P8GAA4AEgARAA0ACAADAP3/9//x/+//8f/4/wIACgAOAA4ACQADAP///v8AAAAA/v/5//P/7//x//v/CgAXAB0AGgAOAPz/7P/j/+T/7v/8/woAEQASAA4ACAABAP3//v////7/+v/2//P/8v/3/wEADQAVABcAEgAHAPn/7f/p/+z/8v/9/wgADwAQAAwABwADAP///f/8//v/+f/3//b/9//8/wQADAASABMADQADAPn/8//w//H/9P/7/wEABQAIAAsADgAOAAwABwD9//D/5f/j/+3//v8QABwAHgATAAMA9f/v//D/9/8AAAYABgAAAPj/9f/4/wIAEAAZABgADQD6/+j/3v/i//H/BQAWAB0AGAALAP7/9v/1//r/AAACAP7/9v/w//P//f8LABcAGgAUAAYA9//s/+n/7f/3/wEABwALAAsACAAFAAQABAAEAAAA+v/0/+//7//3/wIADQAUABUADwAFAPn/8f/w//P/+f8AAAUABQACAAAAAAAEAAkADQANAAcA+//u/+T/5f/w/wIAFAAgACAAFAABAPD/6P/o//D//f8IAAwABwABAP3//v8CAAoADwAMAAAA8//q/+n/8f8AAA8AFQASAAkA///5//r//v8CAAEA/P/0/+//8v/9/wsAFwAbABUACAD3/+n/5f/q//X/AgANABIADwAHAAAA/f/9/wEAAwABAPv/9P/x//T//P8HABAAEwAQAAkAAAD2//H/8P/0//n/AAAGAAkABwAGAAYABQAEAAIAAAD7//X/8f/z//n///8JABEAFAAQAAYA/P/1//L/8//3//v///8BAAMABwAKAAsACgAIAAMA+//x/+v/7f/1/wEADQAVABQACwAAAPn/9//3//r//v8AAP///f/7//3/AQAFAAwAEAANAAUA+v/v/+r/7P/1/wEACwAQAA8ACwAHAAQAAAD7//b/8//x//P/+v8FAA4AEgARAAsAAQD3//L/9P/5//7/AgACAAAAAAAAAAIABgAKAAsACQABAPf/7//s/+//+/8IAA8AEQAPAAoAAwD8//j/9//2//b/+P/9/wEABQAJAAwACgAGAAIA///8//j/9f/0//f/+/8CAAkADgAPAAwABgD///j/8f/w//T/+/8DAAgACgAKAAcAAwACAAIA/v/6//j/+P/6//z/AQAEAAUAAwADAAYACQAJAAYA///1/+z/6v/w//3/CwAXABsAFgAIAPj/7f/q/+//+f8CAAcACQAHAAQAAgABAAIAAwADAAEA/P/1//P/9v/9/wUACgAKAAcABAADAAMAAwD///j/8//x//T//P8GAA4AEgASAAsAAgD5//L/8P/y//n/AQAGAAcABQAEAAMABAAGAAcAAwD8//X/8v/y//b//f8HAA8AEgAQAAkA///1/+//7//2//7/BQAJAAkABgACAP7//v8CAAYABgACAPz/9f/v//H/+f8EAA0AEwAUAA4AAwD3//D/7//y//j/AQAHAAkABwAGAAQABAAFAAUAAAD4//H/7v/y//3/CQASABMADQADAPr/9f/2//v/AAACAAIA///6//j//P8FAA4AEwARAAYA+P/t/+n/7v/5/wYADwAQAAsABAD///3///8BAAEA/v/3//P/8//3/wEADQAVABUADgABAPX/7f/s//L//P8FAAsADQAKAAMA/f/7//3/AgAGAAYAAAD4//P/8v/2////CgASABYAEgAHAPn/7P/o/+3/+f8FAA0ADgAIAAEA/f///wIABgAGAAIA+f/x/+//8//9/wkAEwAWABEABQD4/+//7f/0//7/BgAGAAMA///9/wAABwANAA4ABwD8//H/6//s//b/BAARABUAEAADAPj/9P/5/wIACAAJAAMA9//u/+3/9f8DABMAHAAcAA8A/P/q/+L/5P/w/wIAEgAZABUACgD9//T/9P/6/wEABgAGAAEA+v/2//X/+f8CAAwAEgATAAsA/v/y/+v/7f/1/wAACAALAAoACAAEAAEAAQABAAAA/f/5//X/9P/2//3/CAARABQAEAAFAPj/8P/w//b///8GAAcAAgD8//r//v8FAAwAEAANAAMA9P/p/+b/7f/9/w8AGwAbAA8A/v/w/+v/8f/9/wgADQAJAP//9P/v//L///8QABsAGwAOAPn/5v/g/+b/9f8IABcAGgASAAUA+//1//X/+v8AAAIAAAD7//j/+v///wYADgAQAAwAAgD4//L/8f/2//z/AgAFAAYABAADAAQABAADAAIAAQD+//r/9f/0//f//f8FAA0AEQAPAAgA///3//L/8f/1//z/AwAGAAcABQAEAAQABQAGAAQAAAD7//X/8f/y//j/AwAOABUAEwAJAPz/8//w//T//f8FAAgABQD9//j/+f///wgAEAASAAsA/f/v/+j/6v/0/wIADQAUABMACwACAPv/+P/4//r//v////3/+v/8/wIABwAKAAsACQADAPz/+P/2//b/+P/8/wEABAAGAAgACgAKAAcAAgD7//T/8P/x//j/AAAJAA4ADgAKAAMA/f/6//r//f///////f/6//n/+/8BAAgADgAPAAsAAwD5//D/7v/x//j/AAAHAAwADwAOAAkAAgD6//X/9P/3//v///8CAAQABQAGAAcABQABAAAAAAAAAP7/+v/3//f/+f///wcADQAOAAsABQD+//j/9P/0//f/+////wMABwAKAAsACgAGAAAA+//2//X/9//7////AgAEAAUABQAFAAgACQAFAP3/9v/w/+//9v8BAAsAEQAPAAkAAQD6//b/+f/+/wIAAgD+//j/9v/6/wIADAASABIACgD///T/7f/t//P//v8IAA0ADAAIAAQAAQD//////v/8//n/9//4//r/AAAIAA0ADQAJAAMA/P/4//j/+//+//7//P/8//z/AAAHAA0AEAANAAUA+//w/+r/7P/2/wIADQAUABQACwAAAPb/8v/0//r/AgAHAAUA///5//j/+/8CAAsAEQASAAsA///x/+r/6f/v//z/DAAWABgAEwAHAPr/7//r//H//P8GAAoACgAEAP3/+f/8/wMACQAMAAkAAQD1/+3/7f/2/wIADAARAA4ABwAAAPz//f8AAAAA/P/2//L/8//6/wYAEgAXABQACAD5/+7/6//u//n/BgAOAA4ACAAAAPr/+f/+/wYACgAIAAEA9//w/+7/9P///wsAFAAWABAAAwD3/+//7v/z//z/BAAIAAcABAACAAEAAAACAAUABgACAPz/9f/x//L/+f8EAA8AFAASAAoA/v/0/+//8f/4/wAABQAGAAQAAQAAAAAABAAIAAkABQD9//b/8P/v//X/AAALABEAEgANAAQA+f/y//H/9v/8/wIABQAFAAEA//8BAAUACQAKAAYA///2//D/7//2/wAACwAPAAwABQD+//r//f8CAAYABAD8//P/7//y//z/DAAXABkAEgADAPL/6P/n//D///8MABIAEAAIAP7/+P/4//3/AwAIAAcAAgD6//P/8v/2//7/CAAQABMADwAHAPz/8v/t/+//9////wcADQAOAAoAAwD///z//P/9//7//f/6//j/+f///wcADQAPAAsAAwD7//T/8//4//7/AwAFAAIA///8////BQAMAA4ACAD9//P/7f/t//X/AgANABMAEwAMAAAA9v/z//b//P8BAAQAAwD///r/+v/+/wYADQAPAAsAAgD3/+7/7P/y//7/CgAQABEADAACAPn/9//6////AQABAP7/+v/3//r/AgALAA8ADwAKAAEA9v/v/+//9f/+/wYACgAKAAcAAgD///7///8BAAAA///9//v/+P/6//7/BQAJAAoACgAHAAEA+v/2//T/9f/4//7/BgALAAwACgAHAAMA/f/4//b/9v/5//z/AAAFAAgACAAGAAUAAQD9//n/+f/9/wAAAQAAAP///f/8////BgANAA4ACQABAPf/7//t//L//P8HAA8AEgAPAAcA/f/2//T/+P/8////AAAAAAAAAQADAAcACQAGAAAA/f/5//f/9//8/wEABQAEAAMAAgABAAMABwAJAAYA/f/z/+7/8P/4/wMADgASABAABwD8//b/9f/3//z/AQAEAAQAAAD+////AgAFAAcABwAEAP3/9v/0//X/+f///wYACwAMAAoABgABAPz/+P/3//j/+////wEAAgADAAQABAAFAAYABQABAPv/9f/0//b//P8FAAwADQAJAAMA/f/5//n//P8BAAQAAgD9//f/9v/6/wQADgASABAABgD5/+//7v/x//n/BAAMAA8ADAAGAAAA/P/7//z///////z/+v/7//7/AgAHAAoACgAGAAEA+//4//f/+f/+/wIABAAFAAIA///9////BAAJAAoABgD8//H/7f/v//r/CAATABcAEgAGAPf/7v/s//H//P8HAAwACgAEAP///P/+/wIABgAHAAMA/f/3//P/9f/8/wQACwAMAAkABAD///v/+//7//3//v8AAAAA/////wAAAgAHAAoACQAEAPz/9P/w//H/+P8DAA0AEQARAAkA/v/1//L/9v/+/wUABwAEAP3/9//4//7/CAAQABEACgD9//H/7P/v//j/BQAPABEADQAEAPr/9f/3//7/BgAHAAMA/P/1//T/+f8DAAwAEAAPAAgA/v/0//D/8P/4/wEACgANAAoAAwD+//v//P8AAAQABgACAPv/9P/x//X/AAANABQAEwAMAP//8//t/+7/9v8AAAkADgAMAAQA/P/4//r///8FAAgABQD///f/8//2//3/BgANAA4ACgACAPv/9v/2//n//v8CAAMAAgAAAP7///8EAAsADgAKAAAA9P/s/+v/8v8AAA4AFgAXABAAAQDy/+v/7f/2/wUADwAQAAkA/v/2//T/+f8CAAsADgALAAMA+P/w//D/9f/+/wgADwAPAAsABAD9//r/+P/4//r//P/8//7/AgAHAAsADAAJAAIA+v/0//H/9P/6/wIACgANAAsABQD9//j/+P/+/wQACAAHAAEA+f/y//H/+P8EAA8AFAASAAkA+//w/+v/7v/2/wMADwAUAA8ABgD7//T/9f/8/wQABwAFAP7/+P/2//n///8GAAwADgAMAAUA+//0//L/9P/6/wAABAAGAAcACAAJAAYAAgD9//j/9P/0//j//v8FAAwADgALAAUA/f/3//X/+P/+/wUABwAEAP//+v/3//v/AgAKAA4ADQAIAP//9P/t/+3/8////wwAFAAVAA4AAgD3//L/8v/1//z/AwAGAAcABQACAAEAAgAEAAQAAgD9//j/9f/3//3/AwAHAAkACAADAP3//P/+/wEAAwACAP7/+P/1//f//v8HAA0ADwAOAAYA/P/0//D/8f/2////BwAMAA0ACgAEAP///f/9//z//P/7//r/+v/8/wEABwALAAoABgABAPz/+f/5//r//f8AAAIAAgABAAEAAQAFAAgACAAEAP7/9//z//P/9f/9/wgADwAQAA0ABQD8//T/8//4//3/AQADAAIAAAD+////AwAHAAkABwADAPz/9P/y//P/+v8DAAoADQANAAoAAwD7//X/9f/3//v///8CAAMAAwADAAQABgAFAAMAAQD9//j/9//4//3/AAAEAAYABgAEAAIAAQACAAIAAgD+//j/8//y//f/AgAOABUAFAALAP7/9P/v/+//9P/+/wYADAANAAgAAQD7//r///8FAAYAAgD8//X/8//2////CAAOAA4ACgACAPr/9f/1//n//v8CAAIAAAD/////AQAGAAsADAAGAP3/9v/y//H/9P/8/wYADAAPAA4ACgABAPj/8//0//f//P8BAAUABgAGAAYABAADAAEA///9//z/+//5//n//P8BAAUABwAHAAYABAABAP/////+//z/+f/2//b/+f8BAAwAEwAUAA0AAQD0/+r/6f/x//3/DAATABIACwD///b/9P/5/wIACQAJAAAA9v/x//P/+v8HABAAFAAPAAYA+//z/+//8f/3/wAABgAKAAoACAAFAAIA///+//3/+//5//n/+//+/wEABAAHAAgABwAGAAMA///6//f/9//4//r//f8CAAcACgAMAAwACAAAAPj/8//y//T/+P8BAAoADwAPAAwAAwD6//X/9P/4//7/AwAEAAIA///9//3/AQAGAAsACwAHAP//9v/w/+//9f/+/wgADQAPAA0ABwD///r/9//2//n/+//9//7/AAADAAgACwALAAkAAgD6//T/8v/z//j/AQAJAAwADAAJAAIA/f/7//z//v8AAP///P/5//j//P8DAAkADAALAAgAAgD7//b/9f/1//f//f8DAAgACwAMAAsABgABAPv/9f/y//P/+P8AAAcACwALAAkABAAAAP7//f/8//z//P/6//r//P8AAAQACQALAAsABwABAPv/9v/1//X/+P/9/wMACAALAAwACwAHAP//9//z//T/9v/9/wQACAAHAAIAAAAAAAQABwAJAAYA/v/1/+7/7//2/wIADQAVABQADAABAPb/8v/y//b//P8AAAIAAwAFAAgACgAJAAQA///6//j/+P/6//3///8AAAAAAQADAAYACgAKAAgAAQD3//D/7v/y//v/BwAPABEADQAHAP7/+f/3//f/+P/6//z///8BAAQACAAJAAgABgADAP7/+f/2//b/+P/7//7/AgAGAAkACwALAAgA///3//L/8v/2//7/BAAIAAkABwAEAAIAAQABAAAA///8//n/9v/2//r/AAAHAAsADwANAAgA///3//H/7v/y//r/BAALAA4ADQAKAAMA/f/5//j/+f/6//z//f8AAAIABAAFAAUABQAEAAMAAgD///v/9//1//X/+P///wkAEAATAA8ABwD7//L/7v/x//n/AgAIAAoACAAEAAEAAQADAAQAAgD+//j/9P/0//n/AAAIAAwADAAKAAUAAAD8//n/9v/2//f/+v/9/wMACQANAA0ACgADAPr/9f/0//b//P8BAAQABAACAAEAAgAFAAgACAAEAP3/9v/y//L/9v///wcADAAOAAwACQADAPv/9v/0//P/9v/8/wUACgALAAoABgABAP3//P/9//7//f/7//r/+v/7/wAABwAMAA8ADAAFAPv/8//v//L/+P8CAAkACgAJAAQAAAD//wAAAwADAAAA+//2//T/9v/9/wcADgARAA4ABwD9//b/8//0//j//f8CAAUABgAGAAcACAAHAAQA///4//T/8//3//7/BQAJAAoABwACAP////8AAAAA///9//r/+P/3//r/AAAHAAwADwANAAcA/P/z/+7/8P/3/wAACQANAAwACQAEAP///P/7//v//P/9//z//P/9//7/AQAFAAkACwAJAAUA/v/3//H/8f/3////BwAMAA0ACgAEAP7/+//6//v//P/9//z//P/8////AwAIAAoACgAHAAEA+v/2//T/9v/7/wEABQAHAAgABgAGAAYABQAAAPr/9f/y//T/+v8FAAwADwANAAgA///5//f/+P/8/wAAAgABAP3/+v/8/wIACQANAA0ACQD+//T/7//w//f/AQAJAAwACwAHAAMA///9//z//P/8//z//P/9//7/AAAEAAcACQAJAAcAAgD8//f/9f/1//f//f8FAAkACwALAAgAAgD8//f/9//3//r///8DAAUABQADAAIAAwADAAQAAgD+//r/9//3//r//v8DAAcACQAIAAYAAwABAP///P/4//b/9v/5/wEACAANAA4ACgADAPv/9v/0//f//P8CAAYABgADAAAA//8BAAUABwAGAAEA+v/2//T/9//9/wMACAALAAoABwACAP//+//4//j/+f/8////AwAFAAcABgAFAAMAAQD+//z//P/7//v/+//8////BAAIAAsACgAHAAAA+P/z//P/+P/9/wQACAAIAAYAAwACAAEAAQD///3/+//5//r//f8AAAIABQAHAAcABQADAP///P/6//n/+f/7//3/AQAFAAgACAAHAAUAAAD8//n/+P/4//r///8EAAcACAAHAAQAAAD+//7//v/9//z/+v/6//z/AAAFAAgACgAJAAUA/f/3//T/9v/6/wEABwAIAAUAAQD/////AQAEAAQAAQD9//n/+P/4//v/AAAFAAgACQAIAAQA///6//f/9//5//3/AgAFAAcACAAGAAQAAQD+//v/+v/7//z//f/9////AwAGAAgACAAFAAEA+//5//n//P///wEAAQAAAP7/AAADAAcACAAHAAEA+f/z//P/+P8AAAgADAALAAYA///6//n//P8BAAQAAwD+//j/9//5/wAACAAOAA8ACQAAAPf/8P/w//b/AAAIAA0ACwAGAP//+v/5//z/AAADAAQAAQD9//r/+f/7/wAABwALAAoABwAAAPr/9v/2//n//v8CAAUABgAFAAMAAgACAAEA///8//r/+v/7//3/AQAFAAgACAAGAAEA/P/4//j/+/8AAAMABAABAP7//P/9/wEACAALAAkAAwD6//T/8f/1//3/BwANAA0ACAABAPn/9v/4//3/BAAIAAcAAQD6//f/+P///wcADAAMAAcA/v/2//L/8//5/wEACAAMAAoABgABAPz/+v/7//7/AAAAAP///f/9/wAAAwAGAAYABQABAP3/+v/6//3/AAADAAQAAgD+//z//f8BAAUABwAIAAQA/P/2//P/9f/7/wQADAAQAA0ABQD7//T/8v/3////BgAIAAcAAgD9//r//P8BAAYABwAGAAAA+v/3//f/+f///wYACgAJAAYAAQD7//j/+f/+/wMABQADAP//+v/5//z/AgAIAAoACAADAPv/9f/z//f///8HAAwADAAHAP//+f/3//n///8FAAcAAwD9//n/+f/8/wQACQALAAgAAgD6//b/9v/5////BQAHAAcAAwD+//z//f8AAAMABQADAP//+//5//n//P8CAAcACQAIAAQA/v/5//f/+f/+/wMABQAEAAIAAAD9//7/AQAFAAcABQAAAPr/9f/0//n/AQAKABAADwAHAPz/9P/x//b///8HAAsACQADAPv/9//3//z/BAAKAAsABwABAPn/8//0//n/AgAHAAsACgAFAP//+v/5//v//v8AAAEAAAD+////AgAEAAYABgADAP7/+v/5//n/+/8AAAUABwAGAAIA/v/8//z/AAAEAAYABAD///n/9v/3//v/BAAKAA0ACwAEAPv/9//2//j//f8EAAcABwAEAP///P/8////BAAHAAUAAAD6//f/9//6/wIACQANAAsABQD8//f/9f/5//7/BAAGAAUAAQD9//v//P8AAAYACAAHAAMA+//2//T/+P/+/wYACgAKAAcAAAD7//n/+////wIAAgAAAP3/+//9/wIABgAIAAcABAD+//j/9v/3//v/AQAHAAkABwADAP7//P/9/wAAAwADAAEA+//4//j//P8CAAgACwAKAAUA/v/4//b/+P/7/wEABgAHAAUA///7//r//v8DAAgACQAFAPz/9f/z//X/+/8FAA0AEAANAAYA+//0//H/9P/6/wMABwAJAAcAAwD///3//f8AAAIAAwABAP3/+f/5//v///8EAAcABwAGAAIA///+//3//f/9//z/+v/7//7/BAAIAAoACQAFAP7/+P/0//T/+v8BAAYACQAIAAUA///8//3///8AAAAA///9//r/+v/9/wIABgAHAAgABgACAP3/+v/5//r/+v/9/wEABQAGAAUABAADAAIAAAD///3/+//6//r//P8AAAQABgAHAAcABgABAP3/+v/4//n/+////wIABQAGAAYABgAEAAIA///7//n/+P/5//z/AQAGAAcABgAEAAEAAAAAAAAAAAD+//r/+f/4//r/AAAHAAwADAAIAAEA+v/2//X/+f/9/wIABQAFAAMAAQABAAIABAAGAAQA/v/5//X/9f/5////BgANAA8ADAAGAP7/9//z//T/+v8AAAUABgAGAAQAAQD//wEAAwAEAAIA///6//f/9//6/wAABgAIAAkABwAEAAAA/f/7//r/+v/5//r//P8BAAYACwAOAAwABQD7//T/8P/x//n/AgAJAAwACgAFAP///P/9/wAAAgACAP//+//4//f/+v///wYADAAOAAwABgD9//b/8v/x//b//f8GAAsADAAJAAQA/v/7//3/AAABAP//+//5//j/+v8BAAkADwAPAAoAAQD4//H/8P/2//7/BQAGAAYABQADAAMABQAGAAQA/v/4//P/9P/4////BwAMAAsABwACAP7//P/7//3//v/+//v/+v/6//3/BAAKAA8ADgAIAP7/9f/v/+//9P/8/wYADQAPAAsABgAAAPv/+v/6//z//f/+//3//P/8//7/AwAJAA4ADQAIAP//9f/u/+7/9P/+/wgADwAPAAoAAwD8//r//P///wAA/v/6//j/+P/7/wIACQAPAA8ACQABAPn/8//x//T/+v8AAAYACAAJAAgABgAEAAIA///7//j/9f/1//n//v8GAAsADwAOAAgAAAD5//T/8//4//3/AwAEAAIAAQABAAIABgAJAAkABQD9//b/8P/v//X//v8JABEAEQAOAAYA/f/2//T/9f/5//z/AAACAAIABAAGAAgACgAIAAUA/f/3//H/8P/1//z/BgALAA4ADQAIAAIA/P/5//j/+f/6//3///8AAAEAAgAFAAcACQAKAAYA///3//H/7//y//r/BQANABEAEAAKAAIA+v/3//b/9//5//r//f8BAAUACAAKAAoABwACAPz/+P/2//b/+f/8/wEABQAGAAcACAAHAAYABAD///n/9P/x//P/+f8BAAoAEAARAA0ABgD8//X/8v/0//n//v8CAAQABAAEAAQABgAHAAcABAD///n/9P/x//P/+v8CAAoAEAARAA4ABwD+//b/8f/w//P/+v8AAAYACgALAAkABgADAP///P/6//r/+f/6//v//v8BAAUACAAKAAoABwADAP3/+P/0//P/9f/6/wAABwAOABEADwAJAAEA+f/x/+//8f/4/wAABwAMAAwACQAFAAAA/////////f/6//b/9P/3////CAAQABIADwAFAPz/9f/x//P/9//9/wIABQAFAAUABgAHAAcABgACAPv/9f/y//L/9v/9/wUADQAQAA8ACgADAPv/9v/0//X/+P/7////AwAGAAkACwALAAcAAgD7//X/8v/z//f//f8EAAkACwAKAAgABQABAP3/+//6//j/9v/3//v///8GAA0AEAAPAAkAAAD3//D/7v/y//v/AwAJAAwACgAGAAQAAQABAAAA/v/7//j/9P/0//n/AAAJABAAEwAQAAYA+//y/+7/8P/1//3/BQALAAwACQAFAAIAAAAAAAAA/v/7//b/8//1//v/BQAOABIAEAAIAP//+P/0//T/+P/7//3//v8AAAQABwAMAA4ADAAFAPv/8f/s/+3/8////woAEQASAA4ABQD9//j/9//5//z////+//v/+//8/wIACQAQABAADAACAPf/7//s//D/+f8EAAsADwANAAgABAD///3//f/8//v/+f/3//j/+/8BAAkAEAASAA8ABgD7//H/7P/t//T//v8IAA4ADwALAAUA///8//3//v/+//v/+P/2//b/+/8EAA0AEQAQAAoAAAD3//H/8f/0//v/AQAFAAcABwAHAAYABQAFAAQA///5//H/7//x//v/BgARABUAEQAIAP3/9f/y//X/+////wEAAAD+//7/AQAGAAwADgALAAMA+f/w/+z/7//2/wIADQATABMADQAEAPv/9f/0//f/+//+/////////wAABAAIAAwADAAHAP//9//x//D/8//7/wMACgAPAA8ACwAFAAAA+//3//X/9f/3//v/AAAFAAkADAAMAAkABQD+//j/8//y//X/+/8CAAYACQAJAAcABAABAAAAAAD///z/+P/0//P/+P8BAAsAEQATAA4ABQD6//L/7//x//f///8FAAkACgAIAAYABAADAAEA/v/7//f/9P/1//n/AAAJAA8ADwALAAUA/f/5//f/9//5//v//P///wMABgAJAAsACQAFAP//+v/1//T/9v/5//3/BAAJAAwADQAKAAUA/v/5//b/9v/4//v//f8BAAUABwAJAAoACAAFAAAA+v/0//L/9P/6/wAABgALAAwACwAHAAIA/P/5//f/9v/4//v//v8DAAYACQAJAAgABQABAP3/+v/3//b/9//7/wAABgAKAAsACQAFAAEA/f/7//r/+f/4//j/+/8AAAYADQAPAA0ABgD+//f/8v/y//X/+/8DAAcACgAJAAYAAwABAAEAAAD9//v/9//2//n//f8EAAoADQALAAYAAQD9//r/+P/4//j/+v/8/wEABgALAAwACgAFAAAA+v/2//b/9//7//7/AgAFAAgACQAJAAcAAwD9//n/9f/1//j//P8BAAUACAAIAAcABgAFAAEA/P/4//T/9P/4//7/BQALAA0ACgAFAAAA+//6//v//P/9//z/+//7//7/BAAIAAsACwAHAAEA+v/0//L/8//5/wEACAAMAAwACQAFAAAA/P/7//n/+f/6//v//f8BAAUACAAJAAgABQAAAPv/+P/3//j/+//+/wIABQAFAAUABQAFAAQAAgD///v/9v/1//f/+/8DAAkADQANAAgAAgD7//j/9//5//v//v///wEAAwAFAAYABwAGAAQAAAD7//j/9v/3//v///8FAAkACwAJAAYAAgD9//n/9v/3//r//v8DAAUABgAFAAQAAgABAAAAAAD///z/+f/3//n//f8EAAkADAAKAAUAAAD7//r/+f/6//v//P/+/wIABQAIAAoACQAFAP//+f/1//T/9//8/wMABwAIAAcABQABAP////////7//P/7//r/+//+/wMABgAIAAgABQACAP7/+//5//n/+v/7////AgAFAAgACAAGAAMA/v/7//r/+f/6//v//f8BAAQABwAIAAcABQACAP3/+v/2//b/+f/+/wQACAAJAAgABAAAAP3//P/8//z//f/9//7//v8AAAMABAAFAAUABQADAP7/+//4//f/+f/9/wMABwAJAAcABAABAP7//P/8//z//P/7//z//f8CAAYACQAJAAYAAQD8//j/+P/6//z/AAACAAQABAAEAAMAAwACAAIAAAD8//r/+f/6//z/AQAFAAgACAAGAAMA/v/7//n/+v/8//7/AQADAAQAAwACAAEAAQACAAMAAwAAAPz/9//1//j//v8FAA0ADwAMAAQA+//z//P/9v/9/wQACAAIAAQAAAD9//7/AAADAAQAAwD9//n/9v/5//7/BQAKAAoABgABAPz/+//8//3/AAAAAP///f/9////AwAGAAgABgADAP7/+v/3//b/+v///wQACQAKAAcAAgD9//z//P/9////AAD///3//f///wIABAAHAAcABAAAAPv/9v/2//n///8FAAkACQAFAAAA/P/7//z/AAADAAQAAgD9//r/+f/8/wEABwAMAAwABgD+//f/8//0//r/AQAHAAoACQAFAAEA/P/7//z//v8AAAEAAAD9//z//v8CAAUABwAGAAMA/f/6//n/+//9/wEABAAEAAMAAQAAAAEAAgADAAMAAAD8//n/+P/6////BQAKAAoABgAAAPv/+f/7//7/AQACAAEA///+////AgAEAAUABAADAP//+//4//f/+////wQACQAKAAcAAwD9//r/+P/7//7/AQADAAMAAgABAP////8AAAIABAAEAAIA/f/6//j/+v/+/wQABwAIAAYAAgD9//z//P/8////AAD///7//v8AAAQABgAHAAUAAAD7//j/9//6//7/BAAHAAgABQACAP7//P/8//7/AAAAAAAA/v/8//7/AAAEAAUABgAEAAAA/P/6//v//f8AAAIAAwACAAAAAAABAAIAAwAEAAIA///8//n/+f/7/wAABQAJAAoABwACAPz/+P/3//n//P8BAAQABQAFAAQAAgD///3//P/9/wAAAQABAP///P/8//7/AgAEAAYABQADAP///P/7//r//P/+/wIABAAFAAQAAwABAP////////7//P/8//z//f8BAAQABgAHAAQAAQD9//v/+//8////AAAAAAAAAAABAAQABgAGAAQA///6//f/+P/8/wEABQAHAAcABAAAAP3//P/9////AQABAAAA/v/8//3///8CAAUABwAFAAIA/f/7//n/+v/8////AgAEAAYABgAEAAMA///8//r/+//8//7/AQACAAMABAAEAAQAAgAAAP7//P/8//z//P/+/wEABAAFAAYABAAAAPz//P/9////AAAAAP7//P/8////BAAHAAcABAAAAPz/+f/6//z///8BAAIAAgACAAIABAAEAAQAAwD+//r/9v/2//n///8GAAsADAAJAAIA+v/1//X/+v8BAAYACAAFAAAA/P/7//z/AgAGAAgABQAAAPv/9v/2//r///8FAAoACgAHAAMA/v/6//j/+f/8//7/AQADAAQAAwADAAQABAADAAAA/f/7//r/+//9/wAABAAFAAUABAAEAAEA/v/8//z//P/9//7///8AAAEABAAFAAcABQACAP3/+v/4//n//P8AAAQABgAHAAUAAQD9//z//f8BAAQABAAAAPv/9v/3//3/BgAOABEACwABAPb/7//v//b/AAAJAAwACgAEAP///P/8////AgACAAAA/f/6//r//P8CAAYACQAIAAQA/v/7//n/+//9/wAAAQABAAAAAAACAAQABgAGAAQA///6//f/9//6//7/AgAFAAcABwAFAAQAAAD8//r/+f/6//z/AAADAAQABAAEAAQAAwACAAAA/P/6//n/+v/9/wIABgAIAAgABAAAAPz/+v/7//7/AgADAAAA/P/6//r//v8FAAsADQAJAAEA+f/z//H/9v/9/wUACwANAAoAAwD9//r/+f/8////AQABAP7//f/9////BAAJAAoABwAAAPr/9v/2//n///8EAAcABQADAAAAAAACAAMAAwABAP3/+f/3//n//f8DAAkACgAJAAQA/v/7//n/+v/9//7/AAAAAP//AAADAAYABwAHAAMA/v/5//b/9v/6////BAAHAAgABwAEAAIA///8//n/+f/7//7/AgADAAQAAwABAAEAAgADAAQAAgD+//r/9v/2//r/AQAIAAwADAAIAAEA+v/2//f//P8AAAMAAgAAAP7///8DAAYACQAIAAMA/P/2//T/9v/8/wMACQAKAAkABQACAP3//P/8//z//P/8//3//v8CAAQABwAIAAUAAgD9//r/+v/9////AAAAAP///v///wIABQAJAAgABAD+//j/9P/z//j///8GAAoADAAKAAUAAAD7//f/9v/4//v///8DAAYABwAFAAMAAAD+//7//v///////v/9//3//f/9/wEABQAJAAoACAACAPr/9P/z//b//f8DAAcACQAIAAUAAwAAAP7//f/8//v/+v/7//3/AQAEAAgACAAFAAIA/v/8//v//P/9//3//f/9/wAAAwAHAAoACQAFAP//+f/1//X/+P/9/wMACAAJAAcAAwABAP///v/+//7//f/8//v//P/+/wIABQAHAAcABQACAP7/+//6//n/+v/8////AgAFAAkACgAIAAMA/v/5//b/9v/5//7/AwAGAAYABQAEAAMAAwABAP7//P/5//j/+v/+/wMABgAIAAcABAAAAP3//f/9//3//v/9//3//P/9/wAABQAJAAsACgADAPz/9v/z//X/+v8AAAYACQAJAAcABAABAP7//P/6//n/+v/8////AwAHAAgABwADAAAA/f/9//3//v////3//P/8//3/AQAFAAkACgAIAAMA/f/3//X/9//7////AwAGAAcABwAFAAMAAQD9//r/+P/3//r//v8DAAcACQAHAAMAAAD9//3//v////7//f/7//r//P8BAAcACwAMAAkAAgD6//X/8//3//3/AwAHAAgABQADAAEAAQABAAEA///8//r/+f/8////AwAFAAcABgAEAAMAAQD+//z/+f/3//j//P8BAAcACgAKAAgAAwD9//n/+P/5//z///8BAAEAAgADAAUABgAGAAQA///6//f/9//5//7/AwAHAAcABAACAAAAAAABAAIAAAD9//n/9//4//3/AwAJAAwACgAFAP7/+P/3//f//P///wEAAgADAAMAAwAFAAYABQACAP3/+P/1//b/+f8AAAcACwAKAAYAAQD9//v//P/9//////////7//v///wEAAwAGAAgABgADAP3/+P/2//f/+/8AAAUACQAJAAgABQABAP3/+v/4//j/+//+/wIAAwAFAAUABAADAAMAAQD+//z/+v/6//z//v8BAAQABgAGAAQAAgAAAP///v/9//3/+//6//v//v8DAAkACwAKAAUA/v/3//T/9f/5/wAABgAJAAcAAwD+//3//v8CAAUABAABAPr/9v/1//n/AQAJAA4ADgAIAAAA+P/1//b/+v///wMABAADAAIAAQACAAMABQAEAAEA/P/3//b/+P/+/wUACQAJAAUAAQD9//3//f///wAA///9//z//P/9/wEABQAJAAkABwACAPz/9//2//f/+/8AAAUACAAJAAcAAwD///3/+v/7//z//v8AAAEAAQABAAIAAwAEAAUABAACAP3/+f/3//j//f8CAAYACAAGAAMAAAD+////AQABAP///P/4//f/+/8BAAgADAAMAAgAAAD4//T/9P/4/wAABgAIAAcAAwD///3///8CAAMAAwAAAPz/+P/4//v/AQAGAAkACQAFAAEA/f/8//z//f/9//3//v///wEAAwAFAAYABQADAP7/+v/3//j/+/8AAAQABwAGAAMAAAD+////AQACAAEA/v/8//r/+//9/wIABgAIAAgABgACAP3/+f/4//j//P8AAAQABwAHAAYAAwD///3//P/8//3///8AAAAAAAD//wAAAQADAAUABQADAAAA/P/5//j/+//+/wMABQAFAAQAAwACAAEAAAD+//3/+v/5//v///8EAAgACAAHAAIA/f/6//n//P/+/wEAAwACAAAA/////wEABAAGAAUAAgD9//j/9//4//3/AwAIAAgABgACAP7//f/9//7/AAD///7//f/9////AQADAAUABgAEAAIA/v/7//j/+f/9/wEABAAFAAUAAwACAAEA///+//3//P/9//7/AAABAAMAAwADAAMAAgABAAAA///+//3//f/9//3/AAADAAUABQAEAAIAAAD9//3//P/9//3///8AAAMAAwADAAMAAwABAP///f/8//z//f8AAAMAAwADAAEAAAAAAAIAAwACAP///P/6//r//f8BAAUACAAHAAQAAQD9//r/+v/8////AgADAAMAAQD///7///8BAAMAAwACAP///f/7//v//f8BAAMABAAEAAMAAgAAAP7//f/7//v//f8AAAMABAAEAAMAAgAAAP7//v/+//7//v//////AAABAAEAAgADAAMAAQAAAP7//f/9//3///8AAAEAAQACAAIAAgACAAIAAQD+//z/+//8//7/AgAFAAYABAABAP7//f/+////AQABAP///f/9//3/AAADAAUABgAEAAAA/P/4//j//P8CAAYABwAEAAAA/f/7//3/AgAEAAQAAgD+//v/+v/8////AwAFAAYABAACAP7//f/8//3//v8AAAIAAwADAAIAAAD/////AAAAAAAA///+//3//v8AAAIAAgADAAIAAgABAAAA///9//3//f///wEAAQABAAEAAQABAAEAAQAAAP7//f/9//7/AAADAAMAAwABAP///f/9////AQADAAMAAgD///3/+//9/wAABAAHAAcABAD///r/9//4//3/AwAIAAgABgAAAPv/+f/7//7/AwAEAAQAAgD///3//f/9////AgADAAMAAgD///3//f/+/wAAAQACAAEAAAAAAAAAAQACAAEA///+//3//v8AAAIAAwACAAAA/v///wAAAQABAAAA///+//7/AAABAAEAAQABAAEAAQAAAP///v/+//7///8BAAIAAgABAAAA////////AAABAAEAAQABAAEA///+//3//v8AAAEAAwADAAIAAAD+//3//f/+/wAAAwAEAAMAAgD///3//f/9////AgACAAIAAQD///7//f/+/wAAAgADAAIAAQD+//7//v///wEAAQABAAAAAAAAAAAAAAD/////AAABAAIAAgABAP///f/9//7/AQACAAQAAwACAP///f/8//z//v8BAAMABQADAAEA/v/7//z//v8CAAQABAACAP7//P/8//7/AQACAAIAAgAAAP//AAABAAEAAAD+//3//v///wIABAAFAAMAAQD+//v/+//9/wAAAwAFAAQAAgD+//z//P/+/wIABAAFAAIA///8//r//P///wIABQAFAAMAAAD9//v//P/+/wAAAgADAAMAAgD///7//v///wIAAwADAAEA/v/8//z//f8AAAIABAAFAAMAAQD+//z/+//8//7/AgAEAAQAAgAAAP7//f/+/wEAAgACAAAA/v/8//3/AAACAAQABAACAP///v/+////AQABAAEA///+//7//v8BAAMABQAFAAIA/v/6//j/+f/+/wMABwAHAAQA///7//v//v8BAAMAAwABAP7/+//7//7/AgAGAAcABwACAP7/+f/4//r//v8DAAYABgADAP///P/8//7/AQADAAQAAgD///z/+v/7//7/AgAGAAcABwACAP7/+//5//n/+////wMABgAGAAQAAQD+//7//v/////////+//7///8BAAIAAgACAAIAAQAAAP///v/+//7//v8AAAEAAQABAAEAAgACAAQAAwABAP3/+f/4//r///8FAAgACAAEAP//+//6//3///8CAAIAAQD+//3//f/+/wIABgAHAAYAAgD8//j/9//5//7/AwAHAAcABQACAP7//f/9//7//v////////8AAAAAAQABAAIAAgACAAIAAQAAAP7//P/7//v//v8CAAQABwAHAAUAAgD+//v/+f/6//z///8CAAQABAADAAIAAQAAAAAA/v/+//z//P/+/wAAAgAEAAMAAgABAAAAAAAAAAAA/v/9//z//f/+/wEAAwAFAAUABAACAP///f/7//v//P/+/wAAAgADAAMAAwACAAIAAgAAAP7/+v/5//r//v8CAAYABwAHAAIA///+//3//f/+//7//v/+////AQACAAQABAADAAIAAAD+//z/+//8//7///8BAAIAAwAEAAUABAACAP//+//5//n/+//+/wIABgAGAAQAAgABAP///v/+//7//v/8//z//f///wMABgAHAAcAAwD///z/+v/5//r//f///wIABQAFAAUAAwACAP///v/9//z//P/9////AgACAAMAAgACAAIAAgACAAIA/v/6//j/+P/7/wEABgAJAAkABwACAP7/+//5//n/+//9/wAAAgAEAAUABQADAAIAAAD+//3/+//7//z//v8BAAIABAADAAIAAgACAAIAAQD+//v/+f/5//v///8EAAgACgAHAAMA/v/7//n/+f/8//7/AQACAAIAAgACAAQABQAEAAIA/v/6//j/+P/5//7/BAAHAAkABwAEAAAA/v/8//v/+//8//7///8CAAMABAAEAAMAAgACAAAA///9//v/+f/6//7/AgAFAAcACAAHAAMA///7//n/+f/6//7/AAACAAQABAAFAAUABQADAAAA+//4//b/+P/9/wMACAAKAAcAAwD+//3//f/+/wAA///+//v/+v/9/wIABgAKAAsABgABAPr/9v/1//j//f8CAAYABwAFAAIAAAAAAAEAAgABAP7/+v/4//j/+/8BAAYACwALAAkAAwD9//j/9f/2//r///8DAAYABgAFAAIAAgAAAAAAAAD///3/+//6//r//v8CAAYACQAJAAYAAgD9//r/+P/5//z///8CAAMABAAEAAMAAwADAAMAAQD9//n/9f/2//r/AQAIAAwADAAIAAIA/P/4//j/+v/+/wAAAgACAAEAAQACAAQABgAGAAMA/v/6//X/9f/5////BgALAAsABgABAP3//P/9//7////+//v/+v/7////BAAJAAsACgAFAP7/9//0//X/+f///wQABwAIAAYABAACAAAA///+//3/+//6//r//f///wMABgAJAAgABgABAPz/+f/3//j/+////wIABQAGAAYABAACAAEA///+//3/+v/5//r//P8BAAYACQAKAAgAAwD+//r/+P/4//r//f8AAAIABAAEAAQABQAFAAQAAgD+//n/9f/1//n/AAAHAAwADAAIAAIA/P/5//n//P///wAAAAD+//7//v8CAAYACQAJAAYA///5//X/9P/3//3/AwAIAAoACAAFAAIA///+//7//P/6//r/+v/9/wEABgAKAAoACAADAP7/+f/2//f/+v/+/wIABAAFAAUABAADAAIAAgAAAP7/+//6//n/+v/9/wIABgAKAAoACAADAP7/+f/2//f/+v/+/wIABQAGAAUABAADAAIAAgAAAP7/+v/3//f/+v///wYACgAMAAkABAD+//r/+P/4//r//f///wEAAgADAAQABQAGAAYAAgD+//r/9v/2//n//v8EAAkACgAIAAQA///9//z//f/+//7/+//6//v///8EAAoADAAKAAUA/v/4//X/9f/4//7/AwAHAAgABgAFAAIAAQD///7//f/7//r/+v/8/wAABAAIAAoACAAEAAAA/P/6//n/+v/7//7/AQADAAUABgAGAAYAAwABAP7/+v/5//j/+v/8/wEABQAJAAoACQAFAP7/+v/2//f/+v/+/wEAAwAEAAQABAAEAAQABAACAP//+v/2//X/9//+/wYACwANAAoAAwD+//r/+f/7//7///////7//v/+/wIABgAJAAoABgABAPr/9f/y//b//P8DAAoADAAKAAUAAAD9//z//f/+//7//P/7//v//v8DAAcACgAKAAYAAAD6//b/9v/3//v/AQAFAAcABwAGAAMAAQAAAP///v/9//v/+v/6//z/AAAFAAkACwAKAAYA///5//b/9f/4//3/AgAGAAcABgAEAAIAAQABAAAA/v/8//r/+P/5//3/AgAJAAwADAAHAAAA+v/2//b/+f/+/wIABQAEAAIAAQABAAIABQAGAAQA/v/4//P/8//4/wEACgAOAA0ACAABAPr/9//4//v//v8AAAAA///+/wAAAwAGAAgABwADAP7/+P/1//X/+f///wYACgALAAgAAwD///z/+//8//z//P/8//3///8CAAYACAAIAAYAAgD+//r/+f/4//r//f8BAAQABgAGAAYAAwABAP///v/9//v/+v/6//r//v8CAAgACwALAAgAAgD6//T/8//3//3/AwAHAAgABgACAP///v8AAAIAAgABAP3/+P/2//j//v8GAAwADgALAAQA/P/3//X/9//7/wAAAwAFAAQAAgACAAIABAAFAAMA///6//f/9v/5////BgAKAAsACAACAP7/+//7//z//f/+//3//f/+/wIABgAIAAkABgACAPz/+P/2//f/+v///wUACAAJAAYAAgD///7//v/+//7//v/8//v//P/+/wIABgAJAAkABgACAPz/9//1//b/+v8AAAUACQAJAAYAAgD+//z//P/9//7//v/9//z//P/+/wMABwAKAAkABQD+//n/9f/2//r///8EAAYABgAFAAIAAQAAAAEAAQD///3/+v/4//r//v8EAAkACgAIAAQA/v/7//n/+v/7//7///8BAAIAAgAEAAUABQAFAAIA/v/5//f/9//7/wAABQAJAAkABgACAP7//P/8//7//v/+//3//P/+/wAABAAHAAgABgACAP7/+//5//j/+v/9/wEABQAGAAYABQADAAEA/v/9//z/+//7//z//v8BAAMABQAGAAUABAACAP7/+//5//j/+v/9/wIABQAIAAgABQACAP7//f/8//3//f/9//3//v8AAAMABQAHAAYAAwD///v/+v/6//z//v8BAAIAAgACAAMABAAEAAQAAgD+//n/9//3//v/AQAHAAoACQAFAAAA/P/7//v//f///wAAAAD+//7/AAACAAUABgAGAAMA///7//j/9//6//7/AwAHAAkABwADAAAA/f/8//3//v/+//7//v///wEAAwAFAAUABAACAAAA/v/8//v/+//7//7/AQAEAAUABgAFAAMAAAD9//v/+v/6//v//v8CAAUABgAFAAQAAgD///3//P/7//z//v///wIAAwADAAMAAgACAAEAAQAAAP///v/7//r/+//+/wIABwAJAAgABAD+//r/+P/5//z/AAACAAQAAwACAAIAAQACAAIAAgAAAP3/+//5//v//v8DAAcACAAGAAMA/v/8//v//P/+////////////AQACAAQABQADAAIA///8//v/+//8//7/AgAEAAUABQADAAIAAAD///7//f/8//z//P/+/wEABAAGAAYABAABAP7//P/7//z//v///wEAAgACAAMAAgACAAEAAAD///7//v/9//z//f/+/wEABAAFAAYABQACAP7/+//6//v//f8AAAMABQAFAAMAAAD+//7///8CAAIAAgD+//v/+f/7/wAABQAJAAkABQD///v/+P/4//v///8DAAUABQACAAEAAAAAAAAAAAAAAP7//f/8//3//v8CAAQABQAEAAIA///+//7//////////v/+//7///8CAAUABgAFAAIA/v/7//n/+f/8/wAAAwAFAAYABQACAP7//f/9//7///8AAAAA///+//7/AAACAAMABAAEAAIA/v/8//v/+//9////AgAFAAUABQACAP7//f/8//3///8BAAEAAAD+//7/AAACAAMABQAEAAIA/v/8//v/+//9/wEABAAFAAUAAwAAAP7//f/+//7///////7//v///wIABAAFAAQAAgD+//v/+//+////AgACAAEAAAD//wAAAgADAAMAAgD///3/+//7//3/AAADAAUABQAEAAEA/f/7//z//v8AAAEAAQAAAP////8BAAIAAwADAAIA///9//v/+//9////AgADAAUABAACAAAA/v/9//z//f/+/wAAAgACAAIAAgABAAEAAAAAAAAA//////7//v/+//7///8CAAMABAADAAIAAAD+//3//f/+//7///8BAAIAAwAEAAMAAgD///3//P/8//7///8CAAMAAwADAAIAAAD+//7///8AAAAAAAD///7//f/+/wEABAAFAAUAAgD+//v/+//8////AgADAAIAAgABAAAAAQABAAEAAAD+//7//f/9//7/AQADAAQABAADAAEA/v/9//z//f/+////AAABAAIAAgACAAIAAgAAAP7//f/+//7///8BAAEAAQABAAEAAQABAAEAAQD///7//P/8//7/AAACAAQABAADAAEAAAD///7//f/+//////8AAAEAAQABAAIAAgABAAAA///+//7//v//////AAABAAEAAwADAAMAAQD///z/+//8//7/AQADAAQABAACAAEA///+//////8AAAAAAAD//////////wEAAwAEAAQAAQD///z//P/8//7/AAABAAIAAgADAAMAAgABAP///P/8//z//f8AAAIABAAEAAMAAQD///7//f/+////AQABAAAA////////AAACAAQABAACAP///P/7//v//f8AAAMABAAEAAMAAQAAAP///v/9//7//////wAAAQABAAEAAQABAAEAAQABAP///v/8//z//f///wIABAAFAAQAAQD///z//P/8//7/AAABAAEAAQAAAAEAAQADAAMAAgAAAP3/+//7//z///8CAAQABAADAAEA/////////////////v/+//7/AAACAAQABQAEAAIA///7//r/+//+/wEAAwAEAAMAAQABAAAAAQABAAAA///9//z//P/+/wAAAwAEAAQABAABAP///f/8//z//f///wEAAgACAAEAAQABAAEAAQABAAAA///8//z//P/+/wEABAAFAAYABAABAP///P/6//v//P///wIABAAEAAMAAQAAAAAAAAAAAP///v/8//z//f///wIABQAGAAQAAQD///3//f/+//////////////8AAAEAAwAEAAQAAgD///z/+f/5//z/AQAEAAcABgADAAAA/v/9//7//////////v/9//7///8CAAQABgAFAAIA///7//n/+v/8/wAAAwAEAAQAAgABAAAAAAAAAAAA///+//3//P/9////AQAEAAUABQAEAAEA/v/8//r/+v/9/wAAAwAEAAQAAwABAAAA/////////v/9//3//f/+/wEAAwAFAAYABAABAP///P/7//v//f///wEAAgADAAIAAQABAAEAAQABAP///f/7//r//P///wQABgAHAAUAAQD///z//P/8//////8AAAAAAAABAAEABAAEAAQAAgD///z/+f/5//v///8DAAYABgAFAAMAAQD///3//P/9//3//v///wAAAQADAAQABAADAAEA///+//z//P/8//7/AAACAAQABAAEAAMAAQAAAP///P/8//v//P///wEAAwAEAAQABAADAAEA///8//r/+v/8////AgAEAAUABAACAAAA///////////+//3//f///wAAAQAEAAUABAADAAEA/v/8//v//P/9////AQADAAQABAAEAAMAAQD///z/+//7//z//v8BAAQABgAGAAQAAQD///7//f/9//7//v/+//////8BAAMABAAFAAQAAQD///z/+v/6//z///8CAAQABgAFAAQAAQD///7//P/8//z//f///wEAAwAEAAQAAwACAAEAAAD///3//P/8//z///8BAAQABQAFAAQAAgAAAP7//P/7//v//P///wEAAwAEAAQABAADAAEA///8//v/+v/8////AgAEAAQABAACAAEA///////////+//z//P/8////AgAGAAcABgAEAAAA/P/6//r/+//+/wAAAgAEAAQABAADAAIAAQD///3//P/8//z//f///wIABAAFAAQAAwABAP///f/8//z//P/9////AQADAAQABAAEAAIAAQD///3//P/7//z//f///wIABQAGAAYABAABAP3/+//6//v//f///wEAAwADAAMAAgACAAEAAQAAAP7//P/6//v//f8BAAQABgAGAAQAAQD///3//P/8//z//f///wAAAQAEAAQABQAEAAIA///8//v/+v/7//7/AQAEAAUABQAEAAIAAQD//////v/9//z//P/9////AQAEAAYABgAEAAEA/f/7//r/+//9////AQADAAQABQAEAAMAAQD///3//P/8//z//v///wEAAwAEAAQABAACAAAA/v/8//v/+//8////AQAEAAUABQAEAAEA//////7//f/8//z//P/+/wEABAAGAAYABQACAP///P/6//r//P///wEAAwAEAAQAAwACAAEAAQD///7//P/7//z//v8BAAQABgAFAAMAAQD///7//v/+//3//f/9//7/AAACAAUABgAGAAQAAAD8//r/+f/7//7/AQAEAAUABQAEAAIAAAD///7//f/9//3//v///wAAAQADAAQABAADAAIAAAD+//z/+//6//z//v8BAAUABwAHAAQAAQD9//v/+v/8//3///8BAAEAAgADAAMAAwACAAEA///9//z//P/8//7/AQACAAQABAAEAAIAAQAAAP///P/8//v//P/+/wEABQAGAAYABAABAP7//P/7//z//f///wEAAgADAAMAAwACAAEAAQD///7//P/8//z//v8AAAIABAAEAAQAAwABAP///v/8//z//P/9////AQAEAAUABgAEAAIA///8//v/+//8////AQACAAMABAAEAAMAAgABAP///f/8//v//P///wEAAwAEAAQAAwABAAAA/////////f/9//z//f///wIABQAGAAYAAwD///z/+v/6//3///8BAAIAAwADAAMAAwABAAAA/v/9//3//f/+////AQABAAIAAgACAAIAAgABAAAA/v/8//r/+v/9/wEABQAHAAcABQABAP3/+//6//z//v8AAAEAAgACAAIAAgACAAEAAQD///7//f/9//3//////wEAAgADAAMAAwADAAEA///9//r/+v/7////AgAGAAcABgADAAAA/f/7//z//f///wAAAQABAAEAAgACAAIAAgABAAAA/v/9//3//f/+/wAAAQACAAMAAwADAAIAAQD///3//P/7//z///8CAAUABgAGAAMA///9//z//f/+////AAAAAAAAAAABAAIAAwADAAMAAAD+//z/+//8//7/AQADAAQABAADAAEA//////7//v/+//7//v///wEAAgADAAMAAwABAAAA///9//3//f/9////AQADAAMABAADAAEA///+//3//f/+//////8AAAEAAQACAAMAAwACAAEA///9//v//P/9////AgAEAAUAAwABAP///v/+//7//////////////wEAAgADAAQAAwABAP7//P/8//3///8BAAIAAgABAAEAAAABAAEAAgABAP///f/7//v//f8BAAUABwAHAAMA///8//v/+//+/wAAAQABAAEAAAAAAAEAAQACAAEAAQD///7//f/9//7///8BAAMAAwADAAMAAQD///3//f/9//3///8BAAIAAwADAAIAAQAAAP////////7//v/+////AAABAAMAAwADAAEA///+//3//f/+////AAABAAEAAQACAAMAAgABAP///v/9//3//f///wEAAgADAAMAAgABAP///////////////////v///wAAAgAEAAQAAwABAP7//P/7//z///8BAAMAAwADAAEAAAD///////8AAAAA//////7//v///wEAAwADAAMAAQD///7//f/+//7//////wEAAgADAAMAAwABAP///f/9//3///8BAAEAAQABAAAAAAABAAEAAgABAAAA/v/9//z//f///wIABAAEAAMAAQD///3//f/9//////8AAAEAAQABAAIAAgACAAEA///+//3//v///wAAAQABAAEAAQABAAEAAQABAAEA///+//3//f/+////AQADAAQAAwACAP///v/9//3//v///wEAAQACAAEAAQABAAEAAAD//////////////////wAAAQACAAMAAwACAAAA///9//3//f///wAAAgADAAMAAgABAP//////////AAAAAP/////+////AQADAAUABAACAP///f/7//z///8BAAMAAwACAAEAAAAAAAAAAAAAAP///v/+//7///8BAAMAAwADAAEAAAD/////////////////////AQABAAMAAwADAAEA///9//3//f///wAAAQACAAIAAQABAAEAAAD//////////////////wAAAQACAAMAAwACAAAA///9//3//f///wAAAQADAAMAAwACAAAA/v/9//3//v///wEAAQABAAEAAAAAAAAAAQABAAEAAQD///7//f/9//3/AAACAAUABQAEAAEA/v/8//v//P/+/wAAAgADAAMAAgABAAEA//////////////////8AAAEAAQABAAEAAgACAAEAAAD///3//f/9////AQADAAMAAwACAAEA/////////////////////wAAAQADAAMAAwABAP///f/8//3//v8AAAEAAgABAAEAAQABAAEAAgABAP///f/7//z//v8BAAMABQAFAAMAAAD+//3//f/+////AQABAAEAAAD//wAAAQADAAMAAgD///3/+//7//3/AAADAAUABQADAAEA///+//3//v//////////////AAABAAMAAwADAAIA///9//v/+//9////AQADAAUABAADAAEA///9//3//f///wAAAQABAAEAAAABAAEAAgADAAIAAQD+//z/+//8////AQADAAQABAADAAEA//////7//f/9//3//v///wEAAwAFAAUAAwAAAP3/+//7//z///8BAAMAAwACAAEA/////wEAAQABAAAA/v/8//v//f///wIABQAGAAUAAwD///z/+//7//3///8BAAIAAgACAAIAAQABAAEAAAD///3//f/9//3///8BAAMABAAEAAMAAgD///3//P/7//3///8BAAIAAwADAAMAAgABAP/////+//3//f/9//7///8BAAMABAAEAAMAAQD///3//P/9//7///8BAAEAAgACAAMAAwADAAEA///9//v/+//8////AgAEAAUABQADAAEA///9//3//f/+//////8AAAEAAgADAAQAAwACAP///f/7//v//P///wEAAwAEAAMAAgABAAAA/////////v/9//3//v///wEAAwAFAAUABAACAP///f/6//r/+//9/wEABAAGAAYABQABAP///P/7//z//f///wEAAQABAAEAAQABAAMAAwACAAAA/f/7//r/+//+/wEABAAFAAUAAwABAP///v/9//3//f/9//3///8BAAQABQAGAAQAAQD+//v/+v/7//3/AAABAAMAAwADAAIAAgACAAEA///9//z/+//7//3/AQADAAUABgAFAAIA///9//v/+//8//3///8BAAMAAwADAAMAAgABAAAA///9//z/+//8//7/AQADAAUABQAFAAMA///9//v/+//7//3///8BAAMABAAEAAMAAgABAP///f/8//v/+//9/wAAAwAFAAUABQADAAEA/v/8//v//P/9////AAABAAIAAwADAAMAAwABAP///f/7//v//P/+/wEAAwAEAAUABAADAAEA///9//z//P/7//z///8CAAUABwAGAAQAAQD9//r/+v/7//3/AQACAAMAAgABAAEAAgACAAIAAQD///z/+//6//z///8DAAUABgAFAAMAAQD///3//P/7//z//f8AAAIABAAFAAUAAwABAP///f/8//z//P/9////AQADAAQABAAEAAMAAQD///3//P/7//z//v8AAAMABAAEAAQAAwACAAAA/f/8//r/+//9/wAAAwAEAAUABAADAAEA///9//3//f/9//3//f///wEAAwAGAAYABQADAP7/+v/4//n//P///wMABAAEAAQAAwABAAEAAAD///3//P/8//z//f8AAAMABgAGAAUAAwD///3/+//7//z//f///wEAAgADAAQABAADAAIAAAD9//z/+//8//3///8CAAQABQAFAAQAAgD///3//P/6//v//P///wIABAAFAAUABAACAP///f/8//z//P/9//7/AQADAAQABAAEAAMAAQD///3//P/8//3//v///wAAAgADAAQABQAEAAMA///8//n/+P/6//7/AwAGAAgABgAEAAEA/f/8//z//f/+/////////wAAAgAEAAUABQADAAEA/f/6//n/+v/9/wAAAwAEAAQABAADAAEAAAD///3//P/8//z//f8AAAIABAAGAAUABAABAP///P/6//r//P/9/wAAAwAFAAYABQADAAEA///9//z//P/8//3///8BAAIABAAFAAUABAABAP7//P/6//r//P///wIABAAFAAQAAwABAAAAAAD///7//P/7//v//f8BAAQABwAIAAUAAgD9//v/+v/7//3///8BAAIAAgACAAMAAwADAAMAAQD///z/+f/5//v///8EAAcACAAGAAMA///8//r/+v/8//7/AAABAAIAAgACAAIAAwACAAIAAAD+//z/+//7//3/AAACAAUABgAGAAQAAQD+//z/+//7//z//v8AAAIABAAFAAUABAACAP///f/7//r/+//9////AgAEAAYABAACAAAA///+//7//v/+//7//v/+/wAAAgAEAAYABgAEAAAA/P/5//j/+v/+/wIABQAGAAUAAwABAP///////////v/8//z//P///wIABgAHAAYAAwD///z/+v/6//z//v8AAAEAAgACAAIAAwADAAIAAQD///z/+//7//z//v8BAAQABgAGAAQAAgD///3//P/7//z//f///wEAAwAEAAQAAwACAAEA///+//3//P/8//3///8BAAQABgAGAAQAAgD///z/+//7//z//v8AAAEAAwAEAAQABAADAAEA///8//r/+v/8////AgAEAAUABAACAAEA///+//7////+//7//v/+////AQAEAAYABgAEAAEA/v/6//n/+f/8/wAAAwAGAAYABAACAAEA///+//3//f/9//7//v8AAAIAAwAEAAQAAgABAP///v/9//3//P/9//7/AQACAAQABQAEAAMAAAD+//z/+//7//3///8BAAMABAAEAAQAAgABAP///f/8//z//f/+/wEAAgAEAAQAAwACAAEA///+//7//P/8//3//v8BAAIABAAFAAQAAgD///7//P/8//z//v///wEAAgACAAMAAwACAAIAAAD+//z/+//8//7/AAACAAQABAAEAAIAAQD///7//v/9//z//f/+/wEAAgAEAAUABAACAAAA/v/9//z//P/9////AAACAAMABAADAAIAAQD///7//P/8//z//v8AAAIABAAEAAQAAgABAP///v/+//7//v/+//7///8BAAMABAAEAAMAAQD///3//P/8//z//v8BAAIABAAEAAQAAgABAP///v/8//z//v/+/wAAAQACAAMAAwACAAEAAAD///7//f/8//z//v8AAAIABAAEAAQAAgAAAP7//f/9//3//v///wAAAQACAAMAAwADAAIAAAD+//z//P/8//7/AAACAAQABAADAAIAAQAAAP/////+//3//f/+////AgAEAAQABAACAAAA/v/9//3//v/+////AAABAAIAAgADAAIAAgABAP///v/8//z//f///wEAAwAEAAQAAgABAP///v/+//3//f/+////AQACAAIAAwACAAEAAAD//////v/+//7//v/+/wAAAgAEAAQABAACAP///f/8//z//v///wEAAQACAAIAAgACAAIAAQAAAP///v/9//3//v8AAAIAAwADAAIAAQAAAP////////7//v/+//7///8BAAMABAAEAAIAAQD+//z//P/8//7/AAACAAMAAwACAAEAAAD//////////////v/+////AAACAAMAAwACAAEAAAD///7//f/9//7///8BAAIAAwACAAIAAQAAAP/////+//7//v/+////AQADAAQAAwACAAAA/v/+//3//v///wAAAQACAAIAAQABAAEAAQABAAEAAAD///7//f/9////AQAEAAQABAACAP///v/8//3//v///wEAAQABAAEAAQABAAEAAQABAP///v/9//3//v8AAAIAAwADAAIAAQD///////////////////7///8AAAIAAwAEAAMAAQD///7//P/8//7///8CAAMAAwACAAEA/////////////wAA//////////8BAAEAAgACAAIAAQAAAP///v/9//3//v8BAAIAAwADAAIAAQD///7//v///////////wAAAQACAAIAAgACAAAA///+//7//v///wAAAQABAAEAAQABAAAAAQABAAEAAQD///7//f/+////AQADAAQAAwABAP///v/+//7///8AAAEAAQABAAEAAQABAAIAAQAAAP///v/+//7///8AAAEAAgACAAEAAQD///////8AAAAA//////////8AAAEAAgACAAIAAQD///7//v/+//7///8BAAIAAgACAAEAAAD///////////////////////8BAAEAAgACAAEAAAD//////v/+//////8AAAEAAgACAAEAAAD/////////////////////AAABAAIAAgACAAEA///+//7//v///wAAAQABAAEAAQAAAAAAAQABAAEAAQD///7//v/+////AQADAAMAAgABAP7//f/9//7/AAABAAEAAQAAAAAAAAABAAEAAQAAAP////////////8AAAEAAQABAAEAAQABAP///////////////wAAAQABAAEAAQAAAAAAAAAAAAAAAAD//////v///wAAAgADAAIAAQD///7//v/+////AQABAAEAAQAAAAAAAQABAAEAAQD/////////////AAABAAIAAgABAAEA///+//////8BAAEAAAD///////8AAAEAAgACAAIAAAD+//3//f/+/wAAAgADAAIAAQAAAP///v/+////AAABAAEAAAD///////8BAAIAAgACAAAA///+//7//////wEAAQABAAEAAQAAAP////////////8AAAAAAAAAAAAAAQABAAIAAQABAP///v/+//7///8AAAEAAgACAAEAAAD///////8AAAAAAAD//////////wAAAgADAAMAAQD///3//f/+////AgACAAIAAQD///////8AAAEAAQABAAAA///+//7///8BAAIAAwACAAEA///+//3//v8AAAEAAgABAAAA/////wAAAQACAAEAAAD+//3//f/+/wAAAgADAAMAAgABAP///v/+//7///8BAAEAAQABAAAAAAAAAAAAAQABAAEA/////////////wAAAQACAAIAAgABAAAA///+//7//////wEAAQABAAEAAQABAAEAAQAAAP///v/+//7///8BAAIAAgACAAEA/////////////wAAAAAAAP///////wEAAgACAAIAAQD///7//f/9////AQACAAIAAgABAAAA////////AAAAAP//////////AAABAAIAAgACAAEA///+//7//v///wAAAQABAAIAAQABAAEAAQAAAP///v/+//7///8AAAEAAgACAAEAAQABAAAA/////////v//////AAABAAIAAgACAAEAAAD//////////////////wAAAQACAAIAAgABAAAA///+//3//v///wEAAgACAAIAAQABAAEAAQAAAP///v/+//7///8AAAIAAwADAAIAAQD///7//v/+//////8AAAAAAQABAAEAAQACAAIAAQD///7//v/+//7///8BAAIAAgACAAIAAQAAAP///v/+//7///8AAAEAAgACAAIAAQABAAAA//////7//v/+////AAABAAIAAgACAAIAAQD///7//v/+//7///8AAAEAAQABAAIAAgABAAEAAAD///7//f/+////AQACAAMAAwACAAEA//////7//v/+/////////wEAAQACAAIAAgABAAAA/v/9//3//v///wEAAgACAAIAAQABAAAAAQAAAAAA///+//3//v///wEAAgADAAMAAgABAP///v/9//3//v///wEAAQACAAIAAgABAAEAAAD///7//v/+//7///8AAAEAAgACAAIAAgABAP///v/9//3//v///wEAAgADAAMAAgABAAAA///+//7//v/+//////8BAAIAAgACAAIAAQD//////v/+//7//////wAAAQABAAIAAwADAAIAAAD+//3//P/9//7/AQADAAQABAACAAEA///+//7//v///////////wAAAQACAAIAAgACAAEA///+//3//f/+////AQACAAMAAwACAAIAAQD///7//f/9//7//v8AAAIAAgADAAMAAgABAP///v/9//3//v///wAAAQACAAMAAgACAAEA//////7//v/+//7///8AAAEAAgADAAMAAgABAP///v/9//3//f/+/wAAAgADAAMAAgABAAEA//////7//v/+//7///8AAAEAAwADAAMAAgAAAP7//f/9//3//v///wEAAgACAAIAAgACAAEAAAD///7//f/9//7///8BAAMAAwADAAIAAQAAAP7//v/+//7///8AAAEAAQACAAIAAQABAAAAAAD///7//v/+////AAAAAAIAAwADAAIAAQAAAP7//f/9//7///8BAAIAAgACAAEAAQAAAAAAAAD///7//v/+////AAABAAMAAwADAAEAAAD///7//v/+////AAAAAAEAAQACAAIAAgABAAAA///+//3//f/+/wAAAQACAAMAAwACAAEAAAD///7//v/+////AAAAAAEAAgACAAIAAgABAAAA/v/+//3//v///wAAAQACAAMAAgACAAAAAAD///7//v/+//////8AAAEAAgACAAIAAgABAAAA/v/9//3//v///wEAAgADAAMAAgABAAAA///+//7//v/+////AAAAAAEAAgADAAIAAgAAAP///f/9//3//v8AAAEAAgADAAIAAgABAAAA//////7//v/+////AAABAAIAAwADAAIAAAD///7//v/+//7///8AAAAAAQACAAIAAgACAAAA///+//3//f/+////AAACAAMAAwACAAEAAAD///7//v/+//7///8AAAEAAgACAAIAAgABAAAA///+//3//f/+////AAACAAMAAwACAAEAAAD///7//v/+//7///8AAAEAAgADAAMAAgABAAAA/v/9//3//f///wAAAgADAAMAAgABAAAAAAD///7//v/+////AAAAAAEAAgACAAIAAQAAAP///v/+//7//v///wAAAQACAAMAAwACAAEAAAD+//3//f/9//7/AAABAAMAAwADAAIAAAD//////v/+//7//////wAAAQACAAMAAwACAAAA///+//3//f/+////AAABAAIAAwADAAIAAQAAAP7//f/9//3//v8AAAEAAgADAAMAAgABAAAA///+//7//v///wAAAAABAAIAAgACAAIAAQAAAP///f/9//3//v8AAAEAAwAEAAMAAgAAAP///v/9//3//v///wAAAQACAAIAAgACAAEAAAAAAP///v/9//7///8AAAIAAwADAAMAAQAAAP///v/+//7//v///wAAAAACAAIAAwADAAEAAAD///3//f/9//7/AAABAAMAAwADAAIAAAAAAP///v/+//7//v///wAAAQACAAIAAwACAAEAAAD+//3//f/9//7/AAABAAIAAwADAAIAAQAAAP7//v/9//7//v8AAAAAAQACAAMAAgACAAAA///+//3//f/+////AAABAAIAAgACAAEAAAAAAP///v/+//3//v///wAAAgADAAMAAwABAAAA///9//3//f/+/wAAAQACAAIAAgACAAEAAAAAAP///v/+//7//v///wAAAgADAAMAAwABAAAA/v/9//3//f/+/wAAAQACAAMAAgACAAEAAAD///7//v/+//7///8AAAEAAgADAAMAAgAAAP///v/+//7//v///wAAAQACAAIAAgACAAEAAAD///7//v/+//7///8AAAIAAwADAAIAAQAAAP///v/9//7///8AAAAAAQACAAIAAgACAAEAAAD+//3//f/9////AAACAAMAAwACAAEAAAAAAP/////+//7//v///wAAAQACAAMAAwACAAEA///+//3//f/+////AAACAAMAAwACAAEAAAD///7//v/+//7///8AAAEAAgACAAIAAgABAAAA///+//7//v/+////AAACAAIAAwACAAEAAAD//////v/+//7///8AAAEAAgADAAMAAgAAAP///v/+//7///8AAAAAAQABAAEAAgACAAEAAQAAAP7//f/9//7///8AAAIAAwADAAIAAQAAAP///v/+//7//////wAAAQACAAIAAgACAAEAAAD///7//v/+////AAABAAIAAgACAAIAAQAAAP///v/+//7//v///wAAAQACAAIAAgACAAEAAAD+//3//f/+////AAABAAIAAgACAAEAAAAAAP///v/+//7///8AAAAAAgACAAIAAgAAAAAA///+//7/////////AAAAAAEAAgACAAIAAQAAAP///v/9//3//v8AAAEAAwADAAMAAQAAAP///v/+//7///8AAAAAAQABAAEAAQABAAEAAAAAAP///v/+//7///8AAAEAAgADAAIAAQAAAP/////+//7//////wAAAAABAAIAAwACAAEAAAD+//3//v/+/wAAAAABAAEAAQABAAEAAQABAAAA///+//3//v/+/wAAAQACAAMAAwABAAAA///+//7//v///wAAAAABAAEAAgACAAEAAAAAAP////////7//////wAAAQACAAMAAgABAAAA///+//7//v///wAAAAABAAEAAQABAAEAAAAAAAAA///+//7//v///wEAAgADAAMAAgAAAP///v/+//7///8AAAAAAAABAAEAAQABAAEAAAAAAP///v/+//////8AAAEAAgACAAIAAQAAAAAA//////7//v///wAAAAACAAIAAgACAAEAAAD+//7//v/+////AAABAAIAAgABAAEAAAAAAAAA/////////////wAAAAABAAIAAgACAAEAAAD///7//v/+////AAABAAIAAgACAAEAAAD/////////////AAAAAAAAAAABAAIAAgABAAAA///+//7//v///wAAAAABAAIAAgABAAEAAAAAAP/////+//////8AAAEAAQACAAIAAQAAAAAA///+//7///8AAAAAAAABAAEAAQABAAEAAAAAAP///v/+//7///8AAAEAAgACAAIAAQAAAP///v/+////AAAAAAAAAAABAAEAAQABAAEAAAAAAP///v/+////AAAAAAIAAgACAAIAAAD///7//v/+////AAAAAAEAAQAAAAAAAQABAAEAAAAAAP///v/+//7/AAABAAIAAgACAAEAAAD///7//v///wAAAAAAAAAAAAABAAEAAgABAAAA///+//7//v///wAAAQABAAEAAQAAAAAAAAAAAAAAAAD//////////wAAAQACAAIAAgABAAAA/v/+//7///8AAAEAAgACAAEAAQAAAAAAAAAAAAAAAAD///////8AAAAAAQACAAIAAgAAAP///v/+//7///8AAAEAAgACAAEAAQAAAAAAAAAAAP//////////AAAAAAEAAgACAAIAAQAAAP7//v/+////AAABAAEAAQABAAAAAAABAAAAAAAAAP///v/+////AAABAAIAAgACAAAA///+//7//////wAAAAAAAAAAAAABAAEAAgABAAAA///+//7//v///wAAAQACAAIAAQABAAAAAAD/////////////AAAAAAAAAQABAAIAAQABAAAA///+//7//v///wAAAgACAAIAAQAAAP//////////AAAAAAAAAAAAAAAAAQABAAEAAQAAAAAA///+//7///8AAAAAAQACAAIAAQABAAAA//////7//////wAAAAABAAEAAgACAAEAAAD//////v/+////AAAAAAEAAQABAAEAAQAAAAAAAAD//////v/+////AAABAAIAAgACAAEAAAD///7//v///wAAAAABAAEAAQABAAEAAAAAAAAAAAD//////////wAAAAABAAEAAQABAAAAAAD///7//v///wAAAAABAAEAAQABAAEAAAAAAP///////////////wAAAQABAAEAAQABAAAA/////////////wAAAAABAAEAAQABAAEAAAAAAP////////////8AAAEAAQABAAEAAQAAAAAA/////////////wAAAAABAAEAAQABAAEAAAD//////v/+////AAABAAEAAQABAAEAAAAAAAAA////////////////AAABAAEAAgACAAEAAAD///7//v/+////AAABAAEAAQABAAEAAAAAAP///////////////wAAAQABAAEAAQABAAAA/////////////wAAAAAAAAEAAQABAAEAAQAAAP////////////8AAAAAAQACAAIAAQAAAAAA//////////8AAAAAAAAAAAEAAQABAAEAAQAAAP///v/+//7///8AAAEAAgACAAEAAQAAAP//////////AAAAAAAAAAAAAAEAAQABAAEAAQAAAP///v/+////AAABAAEAAgACAAEAAAAAAP///////////////wAAAAABAAEAAgABAAEAAAD///7//v//////AAABAAEAAQABAAEAAAAAAAAA/////////////wAAAQABAAIAAgABAAAA///+//7//////wAAAQABAAEAAQABAAEAAAAAAAAA//////7//v///wAAAQACAAIAAgABAAAA///+//7///8AAAAAAQABAAEAAQABAAEAAQAAAP/////+//7///8AAAEAAQACAAIAAQAAAAAA//////7//////wAAAAABAAEAAgABAAEAAAD///7//v/+////AAABAAEAAgACAAEAAQAAAP///////////////wAAAAABAAEAAgABAAEAAAD///7//v/+////AAABAAEAAgACAAEAAAAAAP///////////////wAAAQABAAIAAgABAAEAAAD///7//v//////AAABAAEAAgABAAEAAAAAAP////////////8AAAAAAQABAAEAAQABAAAA//////7//v///wAAAAABAAEAAQABAAEAAQAAAP///v/+//7///8AAAEAAQACAAIAAQABAAAA//////7//v///wAAAQABAAIAAgABAAEAAAD//////v//////AAAAAAEAAQABAAEAAQABAAAA///+//7//////wAAAQABAAIAAgABAAEAAAD//////v/+////AAAAAAEAAgACAAIAAQAAAP/////+//7//////wAAAQABAAIAAQABAAAAAAD//////v//////AAABAAEAAQABAAEAAQAAAP/////+//7//////wAAAQACAAIAAgABAAAA//////7//////wAAAAABAAEAAQACAAEAAQAAAP///v/+//7///8AAAEAAgACAAEAAQAAAAAA/////////////wAAAAABAAEAAgACAAEAAAAAAP///v/+//////8AAAEAAQACAAIAAQAAAAAA//////7//v///wAAAAABAAIAAgACAAEAAAD///7//v/+////AAABAAEAAgABAAEAAAAAAAAA////////////////AAABAAIAAgACAAEAAAD///7//v//////AAABAAEAAQABAAEAAQAAAAAA///+//7//v///wAAAQACAAIAAgABAAAA///+//7//////wAAAAABAAEAAQABAAEAAQAAAAAA///+//7///8AAAEAAQACAAIAAQABAAAA////////////////AAABAAEAAQACAAEAAQAAAP///v/+//7///8AAAEAAgACAAIAAQAAAP///////////////wAAAAAAAAEAAQACAAEAAQAAAP///v/+//////8BAAEAAgABAAEAAAAAAP//////////////////AAABAAEAAgACAAEAAAD///7//v//////AAABAAEAAQABAAEAAQAAAAAA/////////////wAAAQABAAEAAQABAAAA/////////////wAAAAABAAEAAQABAAEAAQAAAAAA//////7//////wAAAQACAAIAAQABAAAA//////7//////wAAAQABAAEAAQABAAEAAQAAAAAA//////////8AAAEAAQACAAIAAQAAAP///////////////wAAAAABAAEAAQABAAEAAQAAAP/////+//7///8AAAEAAgACAAEAAQAAAP///////////////wAAAAABAAEAAQABAAEAAAD/////////////AAAAAAEAAQABAAEAAQAAAAAA/////////////wAAAQABAAEAAQABAAEAAAD//////v//////AAABAAEAAQABAAEAAAAAAAAA/////////////wAAAQABAAEAAQABAAAA/////////////wAAAAABAAEAAQABAAEAAAAAAP////////////8AAAAAAQABAAEAAQABAAAAAAD/////////////AAABAAEAAQABAAEAAAD/////////////AAABAAEAAQABAAEAAAAAAAAA/////////////wAAAAABAAEAAQABAAEAAAAAAP////////////8AAAEAAQABAAEAAQAAAAAA/////////////wAAAQABAAEAAQABAAAAAAD/////////////AAABAAEAAQABAAEAAAAAAP///////////////wAAAQABAAEAAQABAAAAAAD//////////wAAAAAAAAEAAQABAAEAAAAAAAAA//////////8AAAAAAQABAAEAAQAAAAAAAAD///////8AAAAAAAAAAAEAAQABAAEAAAAAAP//////////AAAAAAEAAQABAAEAAAAAAAAAAAD///////8AAAAAAAAAAAEAAQABAAAAAAAAAAAA////////AAAAAAAAAQABAAEAAQAAAAAA////////AAAAAAAAAAABAAEAAQAAAAAAAAAAAP///////wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP///////wAAAAABAAEAAQABAAAA//////////8AAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAD///////8AAAAAAQABAAEAAQAAAAAAAAD///////8AAAAAAAAAAAEAAQABAAAAAAAAAAAAAAD///////8AAAAAAQABAAEAAQAAAAAA//////////8AAAAAAAAAAAEAAQAAAAAAAAAAAAAA////////AAAAAAEAAQABAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQABAAEAAAAAAP///////wAAAAABAAEAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAEAAQABAAAAAAD//////////wAAAAABAAEAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAQAAAAAAAAAAAP///////wAAAAAAAAEAAQABAAAAAAAAAAAA////////AAAAAAAAAQABAAEAAAAAAAAA////////AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA////////AAAAAAAAAQABAAEAAAAAAP///////wAAAAAAAAAAAAAAAAAAAQABAAAAAAAAAP///////wAAAAAAAAEAAQABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/////wAAAAAAAAEAAQABAAAAAAAAAP////8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD///////8AAAAAAAABAAEAAAAAAAAAAAAAAAAAAAAAAP////8AAAAAAQABAAEAAQAAAAAA////////AAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAP//AAAAAAAAAQABAAEAAAAAAAAA////////AAAAAAAAAQABAAEAAAAAAAAAAAAAAP//AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD//wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/////wAAAAAAAAEAAQABAAAAAAD///////8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD//////////wAAAQABAAEAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAA////////AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/////wAAAAAAAAEAAQABAAAAAAD///////8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP////8AAAAAAAABAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD//wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/////AAAAAAAAAQABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/////wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQABAAAAAAAAAP////8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

let badgeQueue = []
let badgeShowing = false

function showBadgePopup(def) {
  badgeQueue.push(def)
  if (!badgeShowing) processNextBadge()
}

function processNextBadge() {
  if (badgeQueue.length === 0) { badgeShowing = false; return }
  badgeShowing = true
  const def = badgeQueue.shift()

  const existing = document.getElementById('badge-popup')
  if (existing) existing.remove()

  // Son Zelda
  try {
    const audio = new Audio(BADGE_SOUND_B64)
    audio.volume = 0.7
    audio.play().catch(() => {})
  } catch(e) {}

  const DURATION = 4000
  const popup = document.createElement('div')
  popup.id = 'badge-popup'
  popup.innerHTML = `
    <div class="bp-emoji">${def.emoji}</div>
    <div class="bp-text">
      <div class="bp-title">🏆 Badge débloqué</div>
      <div class="bp-name">${def.name}</div>
      <div class="bp-progress"><div class="bp-progress-bar" id="bp-bar"></div></div>
    </div>
  `
  document.body.appendChild(popup)

  // Barre de progression
  requestAnimationFrame(() => {
    const bar = document.getElementById('bp-bar')
    if (bar) {
      bar.style.transition = `width ${DURATION}ms linear`
      requestAnimationFrame(() => { bar.style.width = '0%' })
    }
  })

  const dismiss = () => {
    clearTimeout(timer)
    const p = document.getElementById('badge-popup')
    if (p) { p.classList.add('badge-hide'); setTimeout(() => { p.remove(); processNextBadge() }, 300) }
  }

  const timer = setTimeout(dismiss, DURATION)
  popup.onclick = dismiss
}

function checkBadges() {
  const hist = loadHist()
  if (hist.length >= 1) unlockBadge('first_session')
  const streak = computeStreak(hist)
  if (streak >= 7) unlockBadge('streak_7')
  if (streak >= 30) unlockBadge('streak_30')
  const totalPoses = hist.reduce((a, s) => a + (s.poses || 0), 0)
  if (totalPoses >= 100) unlockBadge('poses_100')
  if (totalPoses >= 500) unlockBadge('poses_500')
  if (totalPoses >= 1000) unlockBadge('poses_1000')
  const speed30 = hist.filter(s => s.type === 'pose' && s.subMode !== 'progressive').length
  if (speed30 >= 20) unlockBadge('speed_master')
  const cinemaSessions = hist.filter(s => s.type === 'cinema').length
  if (cinemaSessions >= 5) unlockBadge('cinephile')
  if (loadFavs().length >= 10) unlockBadge('collector')
  const hasAnim = hist.some(s => s.type === 'anim')
  const hasPose = hist.some(s => s.type === 'pose')
  const hasCinema = hist.some(s => s.type === 'cinema')
  if (hasAnim && hasPose && hasCinema) unlockBadge('explorer')
  const earlySession = hist.some(s => new Date(s.ts).getHours() < 8)
  if (earlySession) unlockBadge('early_bird')
  if (totalPoses >= 5000) unlockBadge('poses_5000')
}
function renderBadges() {
  const grid = document.getElementById('badges-grid'); if (!grid) return
  const unlocked = loadBadges(); grid.innerHTML = ''
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;margin-top:8px;'
  BADGES_DEF.forEach(def => {
    const isUnlocked = !!unlocked[def.id]
    const card = document.createElement('div')
    card.style.cssText = isUnlocked
      ? 'background:#1c1a08;border:0.5px solid #f0c040;border-radius:12px;padding:14px;text-align:center;'
      : 'background:#131f2e;border:0.5px solid #1e2d40;border-radius:12px;padding:14px;text-align:center;opacity:0.3;filter:grayscale(1);'
    const date = isUnlocked ? new Date(unlocked[def.id]).toLocaleDateString('fr-FR', { day:'numeric', month:'short' }) : def.desc
    const dateColor = isUnlocked ? '#f0c040' : '#4a6280'
    card.innerHTML = `<div style="font-size:28px;margin-bottom:6px;">${def.emoji}</div><div style="font-size:12px;font-weight:600;color:#fff;margin-bottom:3px;">${def.name}</div><div style="font-size:10px;color:${dateColor};line-height:1.4;">${isUnlocked ? '✓ ' + date : date}</div>`
    grid.appendChild(card)
  })
}
function toggleBadgesPanel() {
  const panel = document.getElementById('badges-panel')
  const isOpen = panel.style.display !== 'none'
  panel.style.display = isOpen ? 'none' : 'block'
  if (!isOpen) {
    renderBadges()
    const unlockedCount = Object.keys(loadBadges()).length
    document.getElementById('hist-badges-count').textContent = unlockedCount + ' / ' + BADGES_DEF.length
  }
}

// ─── MOBILE + TABLET — tap-to-toggle des controls flottants sur Session ─
// Sur mobile (≤767px) ET tablet (768-1199px), tap sur la photo pour
// (timer, dock, transform, fav). Comportement standard apps photo natives.
// Le clic est ignoré si on a tapé un vrai bouton (pour ne pas interférer).
;(function () {
  const photoArea = document.getElementById('photo-area')
  const sessionEl = document.getElementById('screen-session')
  if (!photoArea || !sessionEl) return
  let hintShown = false
  photoArea.addEventListener('click', (e) => {
    if (window.innerWidth > 1199) return
    if (e.target.closest('button')) return
    const willHide = !sessionEl.classList.contains('controls-hidden')
    sessionEl.classList.toggle('controls-hidden')
    // Hint « Tape pour révéler » : uniquement la 1re fois qu'on cache.
    if (willHide && !hintShown) {
      hintShown = true
      sessionEl.classList.add('show-hint')
      setTimeout(() => sessionEl.classList.remove('show-hint'), 2400)
    }
  })
  // Reset à chaque entrée en session : controls visibles, hint réarmé,
  // et nettoyage du display:none résiduel que askEnd() peut laisser sur
  // #controls si la session précédente a été quittée sans cancelEnd().
  const _origStartSession = window.startSession
  if (typeof _origStartSession === 'function') {
    window.startSession = function () {
      sessionEl.classList.remove('controls-hidden')
      sessionEl.classList.remove('show-hint')
      hintShown = false
      const ctrls = document.getElementById('controls')
      if (ctrls) ctrls.style.display = ''
      const cb = document.getElementById('confirm-bar')
      if (cb) cb.style.display = 'none'
      return _origStartSession.apply(this, arguments)
    }
  }
})()

// ─── MOBILE — Accordion sur les cards de l'écran Config ─────────────────
// Sur mobile, on transforme chaque .card de #screen-config en accordéon :
// le h3 devient un header cliquable, le reste du contenu est wrappé dans
// un .card-body qu'on collapse/expand. Première card de chaque mode reste
// ouverte par défaut. Desktop intouché car le CSS qui hide le body est
// uniquement dans @media (max-width: 767px).
;(function () {
  function setupConfigAccordion() {
    const screen = document.getElementById('screen-config')
    if (!screen) return
    const cards = screen.querySelectorAll('.card')
    cards.forEach((card) => {
      const h3 = card.querySelector(':scope > h3')
      if (!h3) return
      // Si déjà wrappé, ne pas refaire
      if (card.querySelector(':scope > .card-body')) return
      const body = document.createElement('div')
      body.className = 'card-body'
      // Déplacer tous les enfants après h3 dans body
      let n = h3.nextSibling
      while (n) {
        const next = n.nextSibling
        body.appendChild(n)
        n = next
      }
      card.appendChild(body)
      h3.addEventListener('click', () => {
        // Accordion-only sur mobile (≤767px). Sur tablet + desktop, le
        // clic est sans effet car le CSS n'a pas de .collapsed.
        if (window.innerWidth > 767) return
        card.classList.toggle('collapsed')
      })
    })
    // Première card de chaque conteneur reste ouverte, les autres collapsed
    // (uniquement à l'init et seulement en mobile).
    if (window.innerWidth <= 767) {
      ['pose-options', 'anim-options'].forEach((id) => {
        const wrap = document.getElementById(id)
        if (!wrap) return
        const cs = wrap.querySelectorAll('.card')
        cs.forEach((c, i) => { if (i > 0) c.classList.add('collapsed') })
      })
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupConfigAccordion)
  } else {
    setupConfigAccordion()
  }
})()
