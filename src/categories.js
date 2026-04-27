
// ══ THUMBNAIL PROXY ══
// wsrv.nl redimensionne + convertit en webp à la volée, CDN caché.
// Utilisé pour les previews animation (petites images au lieu de full-size).
function thumbUrl(url, w = 200) {
  if (!url || !url.startsWith('http')) return url
  return 'https://wsrv.nl/?url=' + encodeURIComponent(url) + '&w=' + w + '&output=webp&q=60'
}

// ══ CATÉGORIES ══
const CAT_ICONS = { 'animals': '🐾', 'jambes-pieds': '🦵', 'mains': '🤲', 'nudite': '🔞', 'poses-dynamiques': '⚡', 'visage': '👤' }
function getCatIcon(cat) { return CAT_ICONS[cat.toLowerCase()] || '📁' }
function getCatLabel(cat) { const labels = { 'animals': 'Animaux', 'jambes-pieds': 'Jambes & Pieds', 'mains': 'Mains', 'nudite': 'Nudité', 'poses-dynamiques': 'Poses Dynamiques', 'visage': 'Visage' }; return labels[cat.toLowerCase()] || getSeqLabel(cat) }
const SEQ_LABELS = { 'locomotion': 'Locomotion', 'combat': 'Combat', 'accessoires': 'Accessoires', 'corps': 'Corps', 'sport': 'Sport', 'walk': 'Marche homme', 'wwalk': 'Marche femme', 'run': 'Course homme', 'wrun': 'Course femme', 'gratuit': 'Marche homme', 'sword-lunge': 'Escrime fente', 'sword-strike': 'Frappe épée', 'swing': 'Swing bâton', 'weapon': 'Chorégraphie arme', 'abdo': 'Caisses debout', 'porter': 'Porter caisse', 'jump': 'Saut', 'main': 'Ouverture main', 'skate1': 'Skate 1', 'skate2': 'Skate 2', 'skate3': 'Skate 3' }
function getSeqLabel(name) { return SEQ_LABELS[name.toLowerCase()] || name.charAt(0).toUpperCase() + name.slice(1).replace(/-/g, ' ') }
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
  const borderColor = locked ? '#4a5870' : (isSelected ? (nudity ? '#E24B4A' : '#b8a0d8') : '#182034')
  const borderStyle = locked ? 'dashed' : 'solid'
  card.style.cssText = `position:relative;border-radius:10px;overflow:hidden;cursor:${locked ? 'not-allowed' : 'pointer'};border:1.5px ${borderStyle} ${borderColor};background:#111828;aspect-ratio:4/3;transition:border-color 0.15s,transform 0.15s;${locked ? 'opacity:0.5;' : ''}`
  if (previewUrl) {
    const img = document.createElement('img')
    img.src = previewUrl; img.loading = 'lazy'
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;opacity:0;transition:opacity 0.3s;'
    img.onload = () => { img.style.opacity = isSelected ? '1' : '0.35' }
    img.onerror = () => { img.style.display = 'none' }
    card.appendChild(img)
  }
  const overlay = document.createElement('div')
  overlay.style.cssText = 'position:absolute;inset:0;background:linear-gradient(to top, rgba(10,14,24,0.95) 0%, rgba(10,14,24,0.3) 60%, transparent 100%);display:flex;flex-direction:column;justify-content:flex-end;padding:10px;'
  overlay.appendChild(Object.assign(document.createElement('div'), { textContent: getCatIcon(cat), style: 'font-size:18px;margin-bottom:4px;' }))
  const labelText = getCatLabel(cat) + (locked ? ' 🔒' : '')
  overlay.appendChild(Object.assign(document.createElement('div'), { textContent: labelText, style: 'font-size:12px;font-weight:600;color:#fff;line-height:1.2;' }))
  const subText = locked ? 'Pro' : (count + ' poses')
  overlay.appendChild(Object.assign(document.createElement('div'), { textContent: subText, style: 'font-size:11px;color:#4a5870;margin-top:2px;' }))
  card.appendChild(overlay)
  if (!hasSubs && !locked) {
    const badge = document.createElement('div')
    badge.style.cssText = `position:absolute;top:8px;right:8px;width:20px;height:20px;border-radius:50%;background:${nudity ? '#E24B4A' : '#b8a0d8'};display:${isSelected ? 'flex' : 'none'};align-items:center;justify-content:center;font-size:11px;color:#fff;font-weight:700;`
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
    header.innerHTML = `<button class="cat-back-btn" onclick="renderCategories(null)"><span class="cat-back-arrow">‹</span> ${getCatLabel(parentCat)}</button><span style="font-size:12px;color:#4a5870;text-transform:uppercase;letter-spacing:0.8px;">Sous-collections</span>`
  } else {
    const selectableRoots = cats.filter(c => !isCatLocked(c))
    const allSelected = selectableRoots.length > 0 && selectableRoots.every(c => selectedCats.has(c))
    header.innerHTML = `<span style="font-size:12px;color:#4a5870;text-transform:uppercase;letter-spacing:0.8px;">Collections</span><button id="cat-all" onclick="toggleAllCats()" style="font-size:12px;background:transparent;border:0.5px solid #182034;border-radius:6px;color:${allSelected ? '#b8a0d8' : '#4a5870'};padding:4px 10px;cursor:pointer;">${allSelected ? '✓ Tout' : 'Tout sélectionner'}</button>`
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
        arrow.style.cssText = 'position:absolute;top:8px;left:8px;background:rgba(10,14,24,0.7);border-radius:4px;padding:2px 6px;font-size:10px;color:#8898b0;'
        arrow.textContent = Object.keys(subs).length + ' collections →'
        card.appendChild(arrow)
      } else { card.onclick = () => toggleCat(cat, card) }
      grid.appendChild(card)
    })
  }
  renderSelectionPile()
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
    card.style.borderColor = nudity ? '#E24B4A' : '#b8a0d8'
    const img = card.querySelector('img'); if (img) img.style.opacity = '1'
    card.lastElementChild.style.display = 'flex'
  } else {
    card.style.borderColor = '#182034'
    const img = card.querySelector('img'); if (img) img.style.opacity = '0.35'
    card.lastElementChild.style.display = 'none'
  }
}

function toggleCat(cat, card) {
  const nudity = isNudity(cat)
  if (selectedCats.has(cat)) {
    selectedCats.delete(cat)
    applyCatVisual(card, false, nudity)
  } else {
    selectedCats.add(cat)
    applyCatVisual(card, true, nudity)
  }
  updateAllBtn()
  renderSelectionPile()
}

function toggleSubCat(parentCat, sub, card) {
  const key = parentCat + '/' + sub
  const nudity = isNudity(parentCat)
  if (selectedCats.has(key)) {
    selectedCats.delete(key)
    applyCatVisual(card, false, nudity)
  } else {
    selectedCats.add(key)
    applyCatVisual(card, true, nudity)
  }
  renderSelectionPile()
}

// ── Pile de sélection ──
// Affiche en temps réel les packs sélectionnés dans un panel latéral (desktop/tablet)
// ou une mini barre résumé (mobile). Appelée à chaque modification de selectedCats.
function renderSelectionPile() {
  const pile = document.getElementById('selection-pile')
  const miniBar = document.getElementById('pile-mini-bar')
  const cardsWrap = document.getElementById('pile-cards')
  const totalEl = document.getElementById('pile-total')
  const miniText = document.getElementById('pile-mini-text')
  if (!pile) return

  const items = []
  for (const key of selectedCats) {
    const parts = key.split('/')
    const isSubCat = parts.length > 1
    const rootCat = parts[0]
    const subName = isSubCat ? parts[1] : null
    let count = 0, previewUrl = null, label = ''

    if (isSubCat) {
      const catData = categories[rootCat]
      const subs = catData?.subcategories || {}
      const entries = subs[subName] || []
      count = entries.length
      previewUrl = entries[0]?.path || null
      label = getCatLabel(subName)
    } else {
      const catData = categories[rootCat]
      const entries = Array.isArray(catData) ? catData : (catData?.entries || [])
      const subs = Array.isArray(catData) ? {} : (catData?.subcategories || {})
      count = entries.length
      if (Object.keys(subs).length > 0 && count === 0) {
        for (const s of Object.values(subs)) count += s.length
        const firstSub = Object.values(subs)[0]
        previewUrl = firstSub?.[0]?.path || null
      } else {
        previewUrl = entries[0]?.path || null
      }
      label = getCatLabel(rootCat)
    }
    items.push({ key, label, count, previewUrl, icon: getCatIcon(isSubCat ? subName : rootCat) })
  }

  const screenConfig = document.getElementById('screen-config')

  // Masquer si rien de sélectionné
  if (items.length === 0) {
    pile.classList.add('pile-hidden')
    if (miniBar) miniBar.classList.add('pile-hidden')
    if (screenConfig) screenConfig.classList.remove('has-pile')
    const overlay = document.getElementById('pile-sheet-overlay')
    if (overlay) overlay.classList.remove('visible')
    pile.classList.remove('sheet-open')
    if (miniBar) miniBar.classList.remove('sheet-open')
    return
  }

  // Afficher
  pile.classList.remove('pile-hidden')
  if (screenConfig) screenConfig.classList.add('has-pile')

  const totalCount = items.reduce((s, i) => s + i.count, 0)
  cardsWrap.innerHTML = ''

  for (const item of items) {
    const card = document.createElement('div')
    card.className = 'pile-card'
    const thumb = document.createElement(item.previewUrl ? 'img' : 'div')
    thumb.className = 'pile-card-thumb'
    if (item.previewUrl) {
      thumb.src = item.previewUrl
      thumb.loading = 'lazy'
      thumb.onerror = function() { this.style.display = 'none' }
    } else {
      thumb.style.cssText = 'display:flex;align-items:center;justify-content:center;font-size:18px;'
      thumb.textContent = item.icon
    }
    card.appendChild(thumb)

    const info = document.createElement('div')
    info.className = 'pile-card-info'
    const name = document.createElement('div')
    name.className = 'pile-card-name'
    name.textContent = item.label
    const count = document.createElement('div')
    count.className = 'pile-card-count'
    count.textContent = item.count + ' images'
    info.appendChild(name)
    info.appendChild(count)
    card.appendChild(info)

    const removeBtn = document.createElement('button')
    removeBtn.className = 'pile-card-remove'
    removeBtn.title = 'Retirer'
    removeBtn.textContent = '×'
    card.appendChild(removeBtn)

    removeBtn.onclick = (e) => {
      e.stopPropagation()
      card.classList.add('removing')
      setTimeout(() => {
        selectedCats.delete(item.key)
        // Mettre à jour la card correspondante dans la grille sans full rebuild
        const catCard = document.querySelector('[data-cat="' + item.key + '"]')
        if (catCard) {
          const nudity = isNudity(item.key.split('/')[0])
          applyCatVisual(catCard, false, nudity)
        }
        updateAllBtn()
        renderSelectionPile()
      }, 150)
    }
    cardsWrap.appendChild(card)
  }

  totalEl.textContent = totalCount + ' image' + (totalCount > 1 ? 's' : '') + ' au total'

  // Mini barre mobile
  if (miniBar) {
    const isMobile = window.innerWidth <= 767
    if (isMobile) {
      miniBar.classList.remove('pile-hidden')
      miniText.textContent = items.length + ' pack' + (items.length > 1 ? 's' : '') + ' · ' + totalCount + ' images'
    } else {
      miniBar.classList.add('pile-hidden')
    }
  }
}

function clearSelectionPile() {
  selectedCats.clear()
  renderCategories()
  renderSelectionPile()
}

function togglePileSheet() {
  const pile = document.getElementById('selection-pile')
  const miniBar = document.getElementById('pile-mini-bar')
  if (!pile) return
  const isOpen = pile.classList.contains('sheet-open')

  let overlay = document.getElementById('pile-sheet-overlay')
  if (!overlay) {
    overlay = document.createElement('div')
    overlay.id = 'pile-sheet-overlay'
    overlay.onclick = () => togglePileSheet()
    document.body.appendChild(overlay)
  }

  if (isOpen) {
    pile.classList.remove('sheet-open')
    if (miniBar) miniBar.classList.remove('sheet-open')
    overlay.classList.remove('visible')
  } else {
    pile.classList.add('sheet-open')
    if (miniBar) miniBar.classList.add('sheet-open')
    overlay.classList.add('visible')
  }
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
  renderSelectionPile()
}

function updateAllBtn() {
  const btn = document.getElementById('cat-all'); if (!btn) return
  const selectable = Object.keys(categories).filter(c => !isCatLocked(c))
  const allSelected = selectable.length > 0 && selectable.every(c => selectedCats.has(c))
  btn.style.color = allSelected ? '#b8a0d8' : '#4a5870'
  btn.textContent = allSelected ? '✓ Tout' : 'Tout sélectionner'
}

function renderSequences(parentPath = null) {
  const wrap = document.getElementById('sequences-wrap')
  // Nettoyer les intervals de preview animation avant de détruire les cards
  wrap.querySelectorAll('div').forEach(card => {
    if (card._previewInterval) { clearInterval(card._previewInterval); card._previewInterval = null }
  })
  wrap.innerHTML = ''
  if (Object.keys(sequences).length === 0) {
    wrap.innerHTML = '<div style="font-size:13px;color:#4a5870;text-align:center;padding:20px 0;">Aucune séquence disponible.</div>'; return
  }
  const header = document.createElement('div')
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;'
  if (parentPath) {
    const label = getSeqLabel(parentPath.split('/').pop())
    // Le back doit remonter d'un niveau, ou revenir au root si plus rien.
    const rawParent = parentPath.split('/').slice(0, -1).join('/')
    const backTarget = rawParent ? "'" + rawParent + "'" : 'null'
    header.innerHTML = `<button class="cat-back-btn" onclick="renderSequences(${backTarget})"><span class="cat-back-arrow">‹</span> ${label}</button><span style="font-size:12px;color:#4a5870;text-transform:uppercase;letter-spacing:0.8px;">Séquences</span>`
  } else {
    header.innerHTML = `<span style="font-size:12px;color:#4a5870;text-transform:uppercase;letter-spacing:0.8px;">Séquences</span>`
  }
  wrap.appendChild(header)
  const grid = document.createElement('div')
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;'
  wrap.appendChild(grid)
  const folders = new Map(); const leafSequences = []
  // Séquences R2 arrivent déjà sans préfixe (ex: "walk", "combat/sword-lunge").
  // En local : même chose, pas de préfixe.
  for (const [seq, data] of Object.entries(sequences)) {
    // PRO users : masquer la séquence free (la seule non-lockée parmi les non-pro)
    if (currentUserIsPro && isR2Mode && !data.locked && _freeAllowedSeq === seq) continue
    const seqParts = seq.split('/')
    const meaningful = seqParts
    if (parentPath) {
      const parentParts = parentPath.split('/')
      if (!seqParts.slice(0, parentParts.length).join('/').startsWith(parentPath)) continue
      const remaining = seqParts.slice(parentParts.length)
      if (remaining.length === 1) leafSequences.push(seq)
      else if (remaining.length > 1) { const fn = parentPath + '/' + remaining[0]; if (!folders.has(fn)) folders.set(fn, data.paths[0]) }
    } else {
      // Au root : grouper par le 1er segment thématique (combat, locomotion, etc.)
      if (meaningful.length === 1) {
        // Séquence directement à la racine thématique → leaf
        leafSequences.push(seq)
      } else {
        // Dossier thématique → folder au 1er segment
        const folderPath = seqParts[0]
        if (!folders.has(folderPath)) folders.set(folderPath, data.paths[0])
      }
    }
  }
  // Helpers pour render — extraits pour permettre un ordre custom selon plan
  const renderFolder = (previewUrl, folderPath) => {
    const label = getSeqLabel(folderPath.split('/').pop())
    const card = buildSeqCard(label, isR2Mode ? thumbUrl(previewUrl, 250) : previewUrl, false, false, true)
    card.onclick = () => renderSequences(folderPath)
    const count = Object.keys(sequences).filter(s => s.startsWith(folderPath + '/')).length
    const arrow = document.createElement('div')
    arrow.style.cssText = 'position:absolute;top:8px;left:8px;background:rgba(10,14,24,0.7);border-radius:4px;padding:2px 6px;font-size:10px;color:#8898b0;'
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
    const previewUrl = isR2Mode ? thumbUrl(data.paths[0], 250) : 'file://' + data.paths[0]
    const label = getSeqLabel(seq.split('/').pop())
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
  card.style.cssText = `position:relative;border-radius:10px;overflow:hidden;cursor:pointer;border:1.5px solid ${isSelected ? '#b8a0d8' : '#182034'};background:#111828;aspect-ratio:4/3;transition:border-color 0.15s,transform 0.15s;`
  const img = document.createElement('img')
  img.loading = 'lazy'
  img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;opacity:0;transition:opacity 0.3s;'
  if (previewUrl) { img.src = previewUrl; img.onload = () => { img.style.opacity = isSelected ? '1' : '0.45' }; img.onerror = () => { img.style.opacity = '0' } }
  card.appendChild(img)
  const overlay = document.createElement('div')
  overlay.style.cssText = 'position:absolute;inset:0;background:linear-gradient(to top, rgba(10,14,24,0.95) 0%, rgba(10,14,24,0.3) 60%, transparent 100%);display:flex;flex-direction:column;justify-content:flex-end;padding:10px;'
  overlay.appendChild(Object.assign(document.createElement('div'), { textContent: isFolder ? '📁' : (isLocked ? '🔒' : '▶'), style: 'font-size:18px;margin-bottom:4px;' }))
  overlay.appendChild(Object.assign(document.createElement('div'), { textContent: label.replace(/-/g, ' '), style: 'font-size:12px;font-weight:600;color:#fff;line-height:1.2;' }))
  if (frameCount) overlay.appendChild(Object.assign(document.createElement('div'), { textContent: frameCount + ' frames', style: 'font-size:11px;color:#4a5870;margin-top:2px;' }))
  card.appendChild(overlay)
  if (!isFolder && isSelected) {
    const badge = document.createElement('div')
    badge.style.cssText = 'position:absolute;top:8px;right:8px;width:20px;height:20px;border-radius:50%;background:#b8a0d8;display:flex;align-items:center;justify-content:center;font-size:11px;color:#fff;font-weight:700;'
    badge.textContent = '✓'; card.appendChild(badge)
  }
  if (!isFolder && seq && sequences[seq]) {
    // Preview animation : se lance uniquement sur la card sélectionnée (au clic).
    // renderSequences() recrée les cards → seule la card avec isSelected=true joue.
    if (isSelected) {
      let frameIdx = 0; const previewFrames = []
      // Échantillonner 10 frames réparties sur toute la séquence
      const allPaths = sequences[seq].paths
      const sampleCount = Math.min(10, allPaths.length)
      const paths = []
      for (let i = 0; i < sampleCount; i++) {
        paths.push(allPaths[Math.floor(i * allPaths.length / sampleCount)])
      }
      Promise.all(paths.map(p => new Promise(resolve => {
        const i = new Image(); const src = isR2Mode ? thumbUrl(p, 200) : 'file://' + p
        i.onload = () => { previewFrames.push(src); resolve() }; i.onerror = resolve; i.src = src
      }))).then(() => {
        if (previewFrames.length === 0) return
        frameIdx = 0; img.src = previewFrames[0]; img.style.opacity = '1'; img.style.transition = 'none'
        card._previewInterval = setInterval(() => { frameIdx = (frameIdx + 1) % previewFrames.length; img.src = previewFrames[frameIdx] }, 150)
      })
    }
    card.addEventListener('mouseenter', () => { card.style.transform = 'translateY(-2px)' })
    card.addEventListener('mouseleave', () => { card.style.transform = '' })
  } else {
    card.addEventListener('mouseenter', () => { card.style.transform = 'translateY(-2px)' })
    card.addEventListener('mouseleave', () => { card.style.transform = '' })
  }
  return card
}

async function selectSeqPreload(seq) {
  if (preloadCache[seq]) return
  const paths = sequences[seq].paths
  // Charger par batches de 10 pour ne pas saturer les connexions réseau
  const BATCH = 10
  for (let i = 0; i < paths.length; i += BATCH) {
    await Promise.all(paths.slice(i, i + BATCH).map(p => new Promise(resolve => {
      const img = new Image(); img.onload = img.onerror = resolve; img.src = isR2Mode ? p : 'file://' + p
    })))
  }
  preloadCache[seq] = true; _evictPreloadCache()
}

async function selectSeq(seq, el) {
  document.querySelectorAll('.seq-item').forEach(i => i.classList.remove('selected'))
  el.classList.add('selected'); selectedSeq = seq
  if (preloadCache[seq]) return
  const paths = sequences[seq].paths || sequences[seq]
  const check = el.querySelector('.seq-check'); if (check) check.textContent = '...'
  const BATCH = 10
  for (let i = 0; i < paths.length; i += BATCH) {
    await Promise.all(paths.slice(i, i + BATCH).map(p => new Promise(resolve => {
      const img = new Image(); img.onload = img.onerror = resolve; img.src = isR2Mode ? p : 'file://' + p
    })))
  }
  preloadCache[seq] = true; _evictPreloadCache(); el.classList.add('ready'); if (check) check.textContent = '✓'
}

// ══ MODES ══
function switchMainMode(mode) {
  // Skip si on est déjà dans ce mode — évite de relancer un render sur tap répété
  if (mainMode === mode) return
  // Kill les preview intervals des séquences quand on quitte le mode anim
  if (mainMode === 'anim') {
    const seqWrap = document.getElementById('sequences-wrap')
    if (seqWrap) seqWrap.querySelectorAll('div').forEach(card => {
      if (card._previewInterval) { clearInterval(card._previewInterval); card._previewInterval = null }
    })
  }
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
  // Pile de sélection visible uniquement en mode Poses
  const pile = document.getElementById('selection-pile')
  const miniBar = document.getElementById('pile-mini-bar')
  const screenConfig = document.getElementById('screen-config')
  if (mode === 'pose') {
    renderSelectionPile()
  } else {
    if (pile) pile.classList.add('pile-hidden')
    if (miniBar) miniBar.classList.add('pile-hidden')
    if (screenConfig) screenConfig.classList.remove('has-pile')
  }
  if (mode === 'favs') renderFavsConfig()
  if (mode === 'hist') renderHist()
  if (mode === 'community') { renderCommunity(true); startCommunityRefresh() }
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
const PRELOAD_CACHE_MAX = 20
function _evictPreloadCache() {
  const keys = Object.keys(preloadCache)
  if (keys.length <= PRELOAD_CACHE_MAX) return
  // Supprimer les plus anciennes entrées (FIFO)
  const toRemove = keys.slice(0, keys.length - PRELOAD_CACHE_MAX)
  toRemove.forEach(k => delete preloadCache[k])
}

function _initCategoriesListeners() {
  document.getElementById('tab-pose').addEventListener('click', function() { switchMainMode('pose') })
  document.getElementById('tab-anim').addEventListener('click', function() { switchMainMode('anim') })
  document.getElementById('tab-cinema').addEventListener('click', function() { switchMainMode('cinema') })
  document.getElementById('tab-moodboard').addEventListener('click', openMoodboard)
  document.getElementById('tab-favs').addEventListener('click', function() { switchMainMode('favs') })
  document.getElementById('tab-hist').addEventListener('click', function() { switchMainMode('hist') })
  document.getElementById('tab-community').addEventListener('click', function() { switchMainMode('community') })
  document.getElementById('pile-clear').addEventListener('click', clearSelectionPile)
  document.getElementById('pile-mini-bar').addEventListener('click', togglePileSheet)
  document.getElementById('btab-start').addEventListener('click', function() { switchMainMode('pose') })
  document.getElementById('btab-community').addEventListener('click', function() { switchMainMode('community') })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initCategoriesListeners)
} else {
  _initCategoriesListeners()
}

