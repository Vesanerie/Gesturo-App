
// ══ CATÉGORIES ══
const CAT_ICONS = { 'animals': '🐾', 'jambes-pieds': '🦵', 'mains': '🤲', 'nudite': '🔞', 'poses-dynamiques': '⚡', 'visage': '👤' }
function getCatIcon(cat) { return CAT_ICONS[cat.toLowerCase()] || '📁' }
function getCatLabel(cat) { const labels = { 'animals': 'Animaux', 'jambes-pieds': 'Jambes & Pieds', 'mains': 'Mains', 'nudite': 'Nudité', 'poses-dynamiques': 'Poses Dynamiques', 'visage': 'Visage' }; return labels[cat.toLowerCase()] || cat.charAt(0).toUpperCase() + cat.slice(1).replace(/-/g, ' ') }
const NUDITY_KW = ['nudité', 'nudite', 'nu ', 'nude', 'nsfw']
function isNudity(n) { return NUDITY_KW.some(k => n.toLowerCase().includes(k)) }
// Cats injectées côté client comme teasers lockés (non renvoyées par le
// backend aux users FREE). Historiquement juste 'nudite' — à étendre si
// on ajoute d'autres cats cachées dans R2.
const PRO_CATEGORIES = ['nudite']
// Catégories visibles uniquement par les users FREE (masquées pour les PRO)
// Vide pour l'instant — prêt à être rempli quand le catalogue aura un vrai split free/pro
const FREE_ONLY_CATEGORIES = []
// Whitelist : seules catégories RÉELLEMENT accessibles en FREE. Toutes les
// autres (mains, jambes-pieds, visage, animals, nudite, etc.) sont lockées
// et ouvrent la modale upgrade Pro au clic. On utilise une whitelist
// (plutôt qu'une blacklist) pour que toute nouvelle cat ajoutée au
// catalogue soit Pro par défaut — fail-safe pour la monétisation.
const FREE_ACCESSIBLE_CATEGORIES = ['poses-dynamiques']
function isProCategory(cat) {
  return !FREE_ACCESSIBLE_CATEGORIES.includes(cat.toLowerCase())
}
function isFreeOnlyCategory(cat) { return FREE_ONLY_CATEGORIES.includes(cat.toLowerCase()) }

function buildCatCard(cat, key, count, previewUrl, isSelected, hasSubs, nudity = false, locked = false) {
  const card = document.createElement('div')
  card.dataset.cat = key
  if (locked) card.classList.add('cat-locked')
  const borderColor = locked ? '#3a5570' : (isSelected ? (nudity ? '#E24B4A' : '#2983eb') : '#1e2d40')
  const borderStyle = locked ? 'dashed' : 'solid'
  card.style.cssText = `position:relative;border-radius:10px;overflow:hidden;cursor:${locked ? 'not-allowed' : 'pointer'};border:1.5px ${borderStyle} ${borderColor};background:#131f2e;aspect-ratio:4/3;transition:border-color 0.15s,transform 0.15s;${locked ? 'opacity:0.5;' : ''}`
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
  const labelText = getCatLabel(cat) + (locked ? ' 🔒' : '')
  overlay.appendChild(Object.assign(document.createElement('div'), { textContent: labelText, style: 'font-size:12px;font-weight:600;color:#fff;line-height:1.2;' }))
  const subText = locked ? 'Pro' : (count + ' poses')
  overlay.appendChild(Object.assign(document.createElement('div'), { textContent: subText, style: 'font-size:11px;color:#4a6280;margin-top:2px;' }))
  card.appendChild(overlay)
  if (!hasSubs && !locked) {
    const badge = document.createElement('div')
    badge.style.cssText = `position:absolute;top:8px;right:8px;width:20px;height:20px;border-radius:50%;background:${nudity ? '#E24B4A' : '#2983eb'};display:${isSelected ? 'flex' : 'none'};align-items:center;justify-content:center;font-size:11px;color:#fff;font-weight:700;`
    badge.textContent = '✓'
    card.appendChild(badge)
  }
  if (!locked) {
    card.addEventListener('mouseenter', () => { card.style.transform = 'translateY(-2px)' })
    card.addEventListener('mouseleave', () => { card.style.transform = '' })
  }
  return card
}

function renderCategories(parentCat = null) {
  const wrap = document.getElementById('categories-wrap')
  wrap.innerHTML = ''
  // Tri : cats accessibles d'abord (déverrouillées), puis les lockées —
  // pour qu'un user FREE voie immédiatement ce qu'il peut utiliser sans
  // scroller. Pour un user Pro, isCatLocked retourne false partout donc
  // l'ordre reste alphabétique.
  const cats = Object.keys(categories).sort((a, b) => {
    const aLocked = isCatLocked(a)
    const bLocked = isCatLocked(b)
    if (aLocked !== bLocked) return aLocked ? 1 : -1
    return a.localeCompare(b)
  })
  if (cats.length === 0) { selectedCats = new Set(['Sans catégorie']); return }
  const header = document.createElement('div')
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;'
  if (parentCat) {
    header.innerHTML = `<button class="cat-back-btn" onclick="renderCategories(null)"><span class="cat-back-arrow">‹</span> ${getCatLabel(parentCat)}</button><span style="font-size:12px;color:#3a5570;text-transform:uppercase;letter-spacing:0.8px;">Sous-collections</span>`
  } else {
    const selectableRoots = cats.filter(c => !isCatLocked(c))
    const allSelected = selectableRoots.length > 0 && selectableRoots.every(c => selectedCats.has(c))
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
      // Une catégorie est lockée si explicitement marquée, ou si c'est une Pro cat pour un user FREE
      const locked = (!Array.isArray(catData) && catData.locked) || (!currentUserIsPro && isProCategory(cat))
      // Deselect locked categories pour éviter qu'elles soient dans selectedCats
      if (locked && selectedCats.has(cat)) selectedCats.delete(cat)
      const card = buildCatCard(cat, cat, entries.length, entries[0]?.path || null, isSelected && !locked, hasSubs, nudity, locked)
      if (locked) {
        card.onclick = () => showUpgradeModal()
      } else if (hasSubs) {
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
  modal.innerHTML = `<div style="background:#1e1e1e;border:0.5px solid #333;border-radius:16px;padding:32px;width:360px;text-align:center;"><div style="font-size:28px;margin-bottom:12px;">⭐</div><h2 style="color:#fff;font-size:20px;margin-bottom:8px;">Gestur<span class="gesturo-o">o</span> Pro</h2><p style="color:#555;font-size:14px;line-height:1.6;margin-bottom:24px;">Accède à toutes les catégories, les animations et les poses de nudité académique.</p><button onclick="window.electronAPI.openExternal('https://gesturo.art')" style="width:100%;padding:13px;background:#fff;color:#111;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer;margin-bottom:10px;">Découvrir Pro</button><button onclick="document.getElementById('upgrade-modal').remove()" style="width:100%;padding:10px;background:transparent;color:#555;border:none;font-size:14px;cursor:pointer;">Pas maintenant</button></div>`
  document.body.appendChild(modal)
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove() })
}

// Applique l'état visuel (border, opacity, check) d'une catégorie card.
function applyCatVisual(card, selected, nudity) {
  if (selected) {
    card.style.borderColor = nudity ? '#E24B4A' : '#2983eb'
    const img = card.querySelector('img'); if (img) img.style.opacity = '1'
    card.lastElementChild.style.display = 'flex'
  } else {
    card.style.borderColor = '#1e2d40'
    const img = card.querySelector('img'); if (img) img.style.opacity = '0.35'
    card.lastElementChild.style.display = 'none'
  }
}

// Modale à 2 choix positifs (Ajouter / Remplacer) + fermeture. Utilisée
// quand l'user clique sur un 2e pack alors qu'une sélection existe déjà.
function showCatChoiceModal(catLabel, onAdd, onReplace) {
  let overlay = document.getElementById('generic-modal-overlay')
  if (overlay) overlay.remove()
  overlay = document.createElement('div')
  overlay.id = 'generic-modal-overlay'
  overlay.style.cssText = 'display:flex;position:fixed;inset:0;background:rgba(5,12,22,0.88);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);align-items:center;justify-content:center;z-index:9000;padding:24px;'
  overlay.innerHTML =
    '<div style="background:#131f2e;border:0.5px solid #1e2d40;border-radius:16px;padding:28px;max-width:380px;width:100%;text-align:center;">' +
    '<p style="font-size:15px;color:#fff;margin:0 0 8px;line-height:1.5;font-weight:600;">Ajouter « ' + catLabel + ' » ?</p>' +
    '<p style="font-size:13px;color:#8aaccc;margin:0 0 22px;line-height:1.5;">Tu as déjà une sélection. Veux-tu cumuler les packs ou repartir de zéro ?</p>' +
    '<div style="display:flex;flex-direction:column;gap:8px;">' +
    '<button id="gm-add" style="width:100%;min-height:48px;padding:14px;font-size:14px;border-radius:10px;background:#2983eb;border:none;color:#fff;font-weight:600;cursor:pointer;">➕ Ajouter à la sélection</button>' +
    '<button id="gm-replace" style="width:100%;min-height:48px;padding:14px;font-size:14px;border-radius:10px;background:rgba(255,255,255,0.06);border:0.5px solid rgba(255,255,255,0.1);color:rgba(255,255,255,0.85);cursor:pointer;">🔄 Remplacer la sélection</button>' +
    '<button id="gm-cancel-choice" style="width:100%;min-height:40px;padding:10px;font-size:13px;border-radius:10px;background:transparent;border:none;color:#4a6280;cursor:pointer;">Annuler</button>' +
    '</div></div>'
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove() })
  document.body.appendChild(overlay)
  document.getElementById('gm-add').onclick = () => { overlay.remove(); onAdd() }
  document.getElementById('gm-replace').onclick = () => { overlay.remove(); onReplace() }
  document.getElementById('gm-cancel-choice').onclick = () => overlay.remove()
}

function toggleCat(cat, card) {
  const nudity = isNudity(cat)
  // Cas 1 : catégorie déjà sélectionnée → retirer (peut ramener à 0)
  if (selectedCats.has(cat)) {
    selectedCats.delete(cat)
    applyCatVisual(card, false, nudity)
    updateAllBtn()
    return
  }
  // Cas 2 : rien de sélectionné → ajouter directement
  if (selectedCats.size === 0) {
    selectedCats.add(cat)
    applyCatVisual(card, true, nudity)
    updateAllBtn()
    return
  }
  // Cas 3 : d'autres packs déjà sélectionnés → demander Ajouter / Remplacer
  showCatChoiceModal(getCatLabel(cat),
    () => {
      // Ajouter à la sélection existante
      selectedCats.add(cat)
      applyCatVisual(card, true, nudity)
      updateAllBtn()
    },
    () => {
      // Remplacer : on clear et on ne garde que celle-ci.
      // renderCategories() rebuild la grille → visuels réinitialisés proprement.
      selectedCats.clear()
      selectedCats.add(cat)
      renderCategories()
    }
  )
}

function toggleSubCat(parentCat, sub, card) {
  const key = parentCat + '/' + sub
  const nudity = isNudity(parentCat)
  // Cas 1 : déjà sélectionnée → retirer
  if (selectedCats.has(key)) {
    selectedCats.delete(key)
    applyCatVisual(card, false, nudity)
    return
  }
  // Cas 2 : rien de sélectionné → ajouter directement
  if (selectedCats.size === 0) {
    selectedCats.add(key)
    applyCatVisual(card, true, nudity)
    return
  }
  // Cas 3 : d'autres packs sélectionnés → demander
  showCatChoiceModal(sub,
    () => {
      selectedCats.add(key)
      applyCatVisual(card, true, nudity)
    },
    () => {
      selectedCats.clear()
      selectedCats.add(key)
      renderCategories(parentCat)
    }
  )
}

// Retourne true si une catégorie racine est verrouillée (Pro-only pour un
// user Free, ou flag locked explicite). Même logique que renderCategories.
function isCatLocked(cat) {
  const catData = categories[cat]
  const explicit = !Array.isArray(catData) && catData && catData.locked
  return explicit || (!currentUserIsPro && isProCategory(cat))
}

function toggleAllCats() {
  // On ignore les catégories verrouillées : sinon `every()` ne peut jamais
  // être true pour un user Free (les lockées sont re-supprimées de
  // selectedCats au render → bascule cassée).
  const selectable = Object.keys(categories).filter(c => !isCatLocked(c))
  if (selectable.length === 0) return
  const all = selectable.every(c => selectedCats.has(c))
  if (all) selectedCats.clear()
  else selectable.forEach(c => selectedCats.add(c))
  renderCategories()
}

function updateAllBtn() {
  const btn = document.getElementById('cat-all'); if (!btn) return
  const selectable = Object.keys(categories).filter(c => !isCatLocked(c))
  const allSelected = selectable.length > 0 && selectable.every(c => selectedCats.has(c))
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
    header.innerHTML = `<button class="cat-back-btn" onclick="renderSequences(${parentPath.split('/').slice(0,-1).join('/') ? "'"+parentPath.split('/').slice(0,-1).join('/')+"'" : 'null'})"><span class="cat-back-arrow">‹</span> ${label}</button><span style="font-size:12px;color:#3a5570;text-transform:uppercase;letter-spacing:0.8px;">Séquences</span>`
  } else {
    header.innerHTML = `<span style="font-size:12px;color:#3a5570;text-transform:uppercase;letter-spacing:0.8px;">Collections</span>`
  }
  wrap.appendChild(header)
  const grid = document.createElement('div')
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;'
  wrap.appendChild(grid)
  const folders = new Map(); const leafSequences = []
  for (const [seq, data] of Object.entries(sequences)) {
    // PRO users : masquer complètement les séquences du dossier free/
    if (currentUserIsPro && isR2Mode && seq.startsWith('current/free')) continue
    const seqParts = seq.split('/')
    if (parentPath) {
      const parentParts = parentPath.split('/')
      if (!seqParts.slice(0, parentParts.length).join('/').startsWith(parentPath)) continue
      const remaining = seqParts.slice(parentParts.length)
      if (remaining.length === 1) leafSequences.push(seq)
      else if (remaining.length > 1) { const fn = parentPath + '/' + remaining[0]; if (!folders.has(fn)) folders.set(fn, data.paths[0]) }
    } else {
      const tier = seqParts.slice(0, 2).join('/')
      // Cas spécial : une séquence rangée directement dans current/pro/ (ex.
      // current/pro/sequence_1, sans sous-dossier Men/Women/etc.) a length=3.
      // Sans ce garde-fou, elle apparaîtrait comme leaf au root, à côté du
      // folder "pro" — incohérent visuellement et fait fuiter qu'une seq Pro
      // existe sans la cacher derrière le cadenas du folder. On la regroupe
      // toujours sous le folder "current/pro".
      if (seqParts.length === 3 && tier !== 'current/pro') {
        leafSequences.push(seq)
      } else {
        if (!folders.has(tier)) folders.set(tier, data.paths[0])
      }
    }
  }
  // Helpers pour render — extraits pour permettre un ordre custom selon plan
  const renderFolder = (previewUrl, folderPath) => {
    const label = folderPath.split('/').pop()
    const card = buildSeqCard(label, previewUrl, false, false, true)
    card.onclick = () => renderSequences(folderPath)
    const count = Object.keys(sequences).filter(s => s.startsWith(folderPath + '/')).length
    const arrow = document.createElement('div')
    arrow.style.cssText = 'position:absolute;top:8px;left:8px;background:rgba(5,10,18,0.7);border-radius:4px;padding:2px 6px;font-size:10px;color:#8aaccc;'
    arrow.textContent = count + ' séquences →'
    card.appendChild(arrow); grid.appendChild(card)
  }
  const renderLeaf = (seq) => {
    const data = sequences[seq]
    // FREE : seule _freeAllowedSeq est unlocked. Tout le reste = lock + upgrade modal.
    // Les seqs Pro apparaissent via le backend avec {locked:true} — on force le lock
    // même si le client a reçu leur preview (sécu redondante).
    const isLocked = !currentUserIsPro && isR2Mode && (seq !== _freeAllowedSeq || data.locked)
    const isSelected = selectedSeq === seq
    const previewUrl = isR2Mode ? data.paths[0] : 'file://' + data.paths[0]
    const label = seq.split('/').pop()
    const card = buildSeqCard(label, previewUrl, isSelected, isLocked, false, data.paths.length, seq)
    card.onclick = () => {
      if (isLocked) { showUpgradeModal(); return }
      selectedSeq = seq; renderSequences(parentPath); selectSeqPreload(seq)
    }
    grid.appendChild(card)
  }

  // Ordre : pour un user FREE, on remonte la séquence accessible tout en
  // haut (avant les folders) pour qu'il voie immédiatement ce qu'il peut
  // utiliser. Pour un Pro, ordre standard (folders puis leafs).
  const isFreeView = !currentUserIsPro && isR2Mode
  if (isFreeView) {
    const accessibleLeafs = leafSequences.filter(s => s === _freeAllowedSeq && !sequences[s].locked)
    const lockedLeafs = leafSequences.filter(s => !accessibleLeafs.includes(s))
    accessibleLeafs.forEach(renderLeaf)
    folders.forEach(renderFolder)
    lockedLeafs.forEach(renderLeaf)
  } else {
    folders.forEach(renderFolder)
    leafSequences.forEach(renderLeaf)
  }
  if (leafSequences.length > 0 && !selectedSeq) {
    const first = leafSequences.find(s => !(!currentUserIsPro && isR2Mode && s !== _freeAllowedSeq)) || leafSequences[0]
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
  // Skip si on est déjà dans ce mode — évite de relancer un render sur tap répété
  if (mainMode === mode) return
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
  if (mode !== 'community') {
    if (communityInterval) { clearInterval(communityInterval); communityInterval = null }
    if (_countdownInterval) { clearInterval(_countdownInterval); _countdownInterval = null }
  }
  // Sync bottom tab bar (mobile) — Démarrer = tout sauf community
  const btabStart = document.getElementById('btab-start')
  const btabCommu = document.getElementById('btab-community')
  if (btabStart && btabCommu) {
    btabStart.classList.toggle('active', mode !== 'community')
    btabCommu.classList.toggle('active', mode === 'community')
  }
}

const preloadCache = {}
