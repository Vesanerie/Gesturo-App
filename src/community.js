
const COMMUNITY_EMOJIS = ['🔥', '💪', '🎨', '😍', '👏', '✨']
let reactionsCache = {}
let reactionUsers = {}
let myReactions = {}
let _communityEmail = ''
let _communityUsername = ''

async function loadReactions(postIds) {
  try {
    const res = await window.electronAPI.getReactions(postIds)
    const all = res?.reactions || []
    reactionsCache = {}
    reactionUsers = {}
    myReactions = {}
    const currentUser = _communityEmail
    all.forEach(r => {
      if (!reactionsCache[r.post_id]) reactionsCache[r.post_id] = {}
      if (!reactionUsers[r.post_id]) reactionUsers[r.post_id] = {}
      reactionsCache[r.post_id][r.emoji] = (reactionsCache[r.post_id][r.emoji] || 0) + 1
      if (!reactionUsers[r.post_id][r.emoji]) reactionUsers[r.post_id][r.emoji] = []
      const name = (r.user_email || '').split('@')[0] || 'anonyme'
      reactionUsers[r.post_id][r.emoji].push(name)
      if (r.user_email === currentUser) {
        if (!myReactions[r.post_id]) myReactions[r.post_id] = []
        myReactions[r.post_id].push(r.emoji)
      }
    })
  } catch(e) { /* silent */ }
}

async function toggleReaction(postId, emoji) {
  const btn = document.querySelector(`.community-reactions[data-post="${postId}"] .community-reaction-btn[data-emoji="${emoji}"]`)
  if (btn) btn.classList.toggle('active')
  try {
    const res = await window.electronAPI.toggleReaction(postId, emoji)
    if (!myReactions[postId]) myReactions[postId] = []
    if (!reactionsCache[postId]) reactionsCache[postId] = {}
    if (res.toggled === 'on') {
      myReactions[postId].push(emoji)
      reactionsCache[postId][emoji] = (reactionsCache[postId][emoji] || 0) + 1
    } else {
      myReactions[postId] = myReactions[postId].filter(e => e !== emoji)
      reactionsCache[postId][emoji] = Math.max(0, (reactionsCache[postId][emoji] || 1) - 1)
    }
    renderReactionButtons(postId)
    // Invalide le cache des stats pour déclencher la re-vérif des badges communauté
    _communityStats = null
    checkBadges()
  } catch(e) { if (btn) btn.classList.toggle('active') }
}

function renderReactionButtons(postId) {
  const container = document.querySelector(`.community-reactions[data-post="${postId}"]`)
  if (!container) return
  const mine = myReactions[postId] || []
  const counts = reactionsCache[postId] || {}
  const users = reactionUsers[postId] || {}
  container.querySelectorAll('.community-reaction-btn').forEach(btn => {
    const em = btn.dataset.emoji
    const count = counts[em] || 0
    btn.classList.toggle('active', mine.includes(em))
    const countEl = btn.querySelector('.count')
    if (countEl) countEl.textContent = count || ''
    // Tooltip with usernames
    let tooltip = btn.querySelector('.reaction-tooltip')
    const names = users[em] || []
    if (count > 0 && names.length > 0) {
      if (!tooltip) {
        tooltip = document.createElement('span')
        tooltip.className = 'reaction-tooltip'
        btn.appendChild(tooltip)
      }
      tooltip.textContent = names.slice(0, 8).join(', ') + (names.length > 8 ? '…' : '')
    } else if (tooltip) {
      tooltip.remove()
    }
  })
}

function formatPostDate(ts) {
  const d = new Date(ts)
  const now = new Date()
  const diff = Math.floor((now - d) / 1000)
  if (diff < 3600) return Math.floor(diff / 60) + ' min'
  if (diff < 86400) return Math.floor(diff / 3600) + ' h'
  if (diff < 604800) return Math.floor(diff / 86400) + ' j'
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

// ── Challenges ──
let _activeChallenges = []
let _selectedChallengeFilter = ''

async function loadChallenges() {
  try {
    const res = await window.electronAPI.getChallenges()
    _activeChallenges = res?.challenges || []
  } catch(e) { _activeChallenges = [] }
  renderChallengeBanner()
  renderChallengeFilter()
}

let _dailyChallengeTriggered = false
async function triggerDailyChallenge() {
  if (_dailyChallengeTriggered) return
  _dailyChallengeTriggered = true
  try {
    const sb = window.__gesturoAuth
      ? await window.__gesturoAuth.getSupabase()
      : null
    if (sb) {
      await sb.functions.invoke('daily-challenge')
    } else {
      // Desktop: call via electronAPI helper or direct fetch
      await window.electronAPI.triggerDailyChallenge()
    }
  } catch(e) { /* silent — challenge is optional */ }
}

function renderChallengeBanner() {
  const banner = document.getElementById('challenge-banner')
  if (!_activeChallenges.length) { banner.style.display = 'none'; return }
  banner.style.display = ''
  banner.innerHTML = ''
  _activeChallenges.forEach((c, i) => {
    const card = document.createElement('div')
    card.className = 'challenge-card'
    if (i > 0) card.classList.add('challenge-card-compact')
    card.innerHTML = `
      <div class="challenge-ref">
        <img src="${c.ref_image_url || ''}" alt="Ref">
      </div>
      <div class="challenge-info">
        <div class="challenge-label">CHALLENGE</div>
        <h3>${c.title || ''}</h3>
        <div class="challenge-deadline" data-challenge-id="${c.id}"></div>
        <div class="challenge-participants" data-challenge-id="${c.id}"></div>
        <button class="end-btn end-btn-share" onclick="participateChallenge('${c.id}')">Participer</button>
      </div>
    `
    banner.appendChild(card)
  })
  updateChallengeCountdown()
}

function updateChallengeCountdown() {
  _activeChallenges.forEach(c => {
    const el = document.querySelector(`.challenge-deadline[data-challenge-id="${c.id}"]`)
    if (!el) return
    const dl = new Date(c.deadline)
    const diff = dl - new Date()
    if (diff <= 0) { el.textContent = 'Dernière chance !'; return }
    const days = Math.floor(diff / 86400000)
    const hours = Math.floor((diff % 86400000) / 3600000)
    if (days > 0) el.textContent = days + 'j ' + hours + 'h restants'
    else el.textContent = hours + 'h restantes'
  })
}

function updateChallengeParticipants(allPosts) {
  _activeChallenges.forEach(c => {
    const el = document.querySelector(`.challenge-participants[data-challenge-id="${c.id}"]`)
    if (!el) return
    const count = allPosts.filter(p => p.challenge_id === c.id).length
    el.textContent = count > 0 ? count + ' participant' + (count > 1 ? 's' : '') : ''
  })
}

function renderChallengeFilter() {
  const filter = document.getElementById('challenge-filter')
  const select = document.getElementById('challenge-select')
  if (!_activeChallenges.length) { filter.style.display = 'none'; return }
  filter.style.display = ''
  select.innerHTML = '<option value="">Tous les posts</option>'
  _activeChallenges.forEach(c => {
    const opt = document.createElement('option')
    opt.value = c.id
    opt.textContent = 'Challenge: ' + c.title
    select.appendChild(opt)
  })
}

function filterByChallenge() {
  _selectedChallengeFilter = document.getElementById('challenge-select').value
  renderCommunity(true)
}

let _challengeSession = false

function participateChallenge(challengeId) {
  const c = challengeId
    ? _activeChallenges.find(ch => ch.id === challengeId)
    : _activeChallenges[0]
  if (!c || !c.ref_image_url) return
  // Build a single-image session with the challenge ref
  sessionEntries = [{ type: 'image', path: c.ref_image_url, category: 'Challenge', isR2: true }]
  currentIndex = 0; sessionLog = []; _challengeSession = true
  // imgCache gardé entre sessions (les URLs R2 ne changent pas, re-download inutile)
  mainMode = 'pose'; currentSubMode = 'class'
  closeEndConfirm()
  document.getElementById('controls').style.display = 'flex'
  showScreen('screen-session'); loadAndShow(0)
}

// ── Upload from Community tab ──
let _communityBlob = null

function openCommunityUpload() {
  const overlay = document.getElementById('community-upload-overlay')
  overlay.style.display = 'flex'
  document.getElementById('community-preview-img').style.display = 'none'
  document.getElementById('community-upload-actions').style.display = 'none'
  document.getElementById('community-upload-status').style.display = 'none'
  document.getElementById('community-upload-label').style.display = 'inline-flex'
  document.getElementById('community-file-input').value = ''
  _communityBlob = null
  // Show scan button on mobile only
  const scanBtn = document.getElementById('community-scan-btn')
  if (scanBtn) scanBtn.style.display = (_isMobile && (window.__isAndroid || window.__isIOS)) ? 'inline-flex' : 'none'
  const desc = document.querySelector('#community-upload-overlay .share-drawing-box p')
  if (desc && _activeChallenges.length) {
    desc.textContent = 'Challenge en cours : ' + _activeChallenges[0].title + ' — ton dessin sera inscrit !'
  } else if (desc) {
    desc.textContent = 'Prends en photo ton croquis pour le montrer à la communauté !'
  }
}

// ── Scan via document scanner plugin (iOS / Android) ──
async function scanCommunityDrawing() {
  if (!window.electronAPI?.scanDocument) { alert('Scan non disponible sur cet appareil.'); return }
  const res = await window.electronAPI.scanDocument()
  if (!res || !res.dataUrl) return
  // Load the scanned image into the existing flow
  const img = new Image()
  img.onload = function() {
    const canvas = document.createElement('canvas')
    const maxW = 1200
    let w = img.width, h = img.height
    if (w > maxW) { h = Math.round(h * maxW / w); w = maxW }
    canvas.width = w; canvas.height = h
    canvas.getContext('2d').drawImage(img, 0, 0, w, h)
    canvas.toBlob(function(blob) {
      _communityBlob = blob
      const preview = document.getElementById('community-preview-img')
      if (preview.src && preview.src.startsWith('blob:')) URL.revokeObjectURL(preview.src)
      preview.src = URL.createObjectURL(blob)
      preview.style.display = 'block'
      document.getElementById('community-upload-label').style.display = 'none'
      document.getElementById('community-scan-btn').style.display = 'none'
      document.getElementById('community-upload-actions').style.display = 'flex'
    }, 'image/jpeg', 0.9)
  }
  img.src = res.dataUrl
}

async function scanShareDrawing() {
  if (!window.electronAPI?.scanDocument) { alert('Scan non disponible sur cet appareil.'); return }
  const res = await window.electronAPI.scanDocument()
  if (!res || !res.dataUrl) return
  const img = new Image()
  img.onload = function() {
    const canvas = document.createElement('canvas')
    const maxW = 1200
    let w = img.width, h = img.height
    if (w > maxW) { h = Math.round(h * maxW / w); w = maxW }
    canvas.width = w; canvas.height = h
    canvas.getContext('2d').drawImage(img, 0, 0, w, h)
    canvas.toBlob(function(blob) {
      _shareBlob = blob
      const preview = document.getElementById('share-preview-img')
      if (preview.src && preview.src.startsWith('blob:')) URL.revokeObjectURL(preview.src)
      preview.src = URL.createObjectURL(blob)
      preview.style.display = 'block'
      document.getElementById('share-upload-label').style.display = 'none'
      document.getElementById('share-scan-btn').style.display = 'none'
      document.getElementById('share-actions').style.display = 'flex'
    }, 'image/jpeg', 0.9)
  }
  img.src = res.dataUrl
}

function closeCommunityUpload() {
  document.getElementById('community-upload-overlay').style.display = 'none'
}

function handleCommunityFile(input) {
  const file = input.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = function(e) {
    const img = new Image()
    img.onload = function() {
      const canvas = document.createElement('canvas')
      const maxW = 1200
      let w = img.width, h = img.height
      if (w > maxW) { h = Math.round(h * maxW / w); w = maxW }
      canvas.width = w; canvas.height = h
      canvas.getContext('2d').drawImage(img, 0, 0, w, h)
      canvas.toBlob(function(blob) {
        _communityBlob = blob
        const preview = document.getElementById('community-preview-img')
        if (preview.src && preview.src.startsWith('blob:')) URL.revokeObjectURL(preview.src)
        preview.src = URL.createObjectURL(blob)
        preview.style.display = 'block'
        document.getElementById('community-upload-label').style.display = 'none'
        document.getElementById('community-upload-actions').style.display = 'flex'
      }, 'image/jpeg', 0.8)
    }
    img.src = e.target.result
  }
  reader.readAsDataURL(file)
}

function _blobToBase64(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result.split(',')[1])
    reader.readAsDataURL(blob)
  })
}
const _isMobile = !window.electronAPI?.pickFolder || typeof Capacitor !== 'undefined'
let _uploading = false

async function confirmCommunityUpload() {
  if (!_communityBlob || _uploading) return
  _uploading = true
  const status = document.getElementById('community-upload-status')
  status.style.display = 'block'
  status.style.color = '#8898b0'
  status.textContent = 'Envoi en cours...'
  document.getElementById('community-upload-actions').style.display = 'none'
  try {
    const postData = {
      refImageUrl: null,
      username: _communityUsername || (_communityEmail ? _communityEmail.split('@')[0] : 'anonyme'),
    }
    if (_isMobile) postData.imageBase64 = await _blobToBase64(_communityBlob)
    const res = await window.electronAPI.submitCommunityPost(postData)
    if (res.error) throw new Error(res.error)
    if (!res.uploaded && res.uploadUrl) {
      await fetch(res.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        body: _communityBlob,
      })
      // Desktop: run auto-moderation after upload
      if (res.needsModeration && res.postId) {
        status.textContent = 'Vérification du contenu...'
        const modRes = await window.electronAPI.moderateCommunityPost(res.postId)
        if (modRes && !modRes.ok) throw new Error(modRes.reason || 'Image refusée par la modération automatique.')
      }
    }
    if (_activeChallenges.length && res.postId) {
      try { await window.electronAPI.tagPostToChallenge(res.postId, _activeChallenges[0].id) } catch(e) {}
    }
    status.textContent = 'Publié !'
    status.style.color = '#a8d090'
    _communityStats = null; checkBadges()
    setTimeout(() => { _uploading = false; closeCommunityUpload(); renderCommunity(true) }, 1500)
  } catch(e) {
    _uploading = false
    status.textContent = 'Erreur : ' + (e.message || 'échec')
    status.style.color = '#e74c3c'
    document.getElementById('community-upload-actions').style.display = 'flex'
  }
}

// ── Share drawing (Recap screen) ──
let _lastRefUrl = ''
let _activeChallenge = null
function setLastRefUrl(url) { _lastRefUrl = url }

// Ref de la pose sélectionnée par l'user pour le partage (étape "choisis
// la pose correspondant à ton dessin"). Reset à chaque nouveau partage.
let _selectedShareRef = null

// Ouvre le partage. Étape 1 : sélection de la pose de référence (parmi
// celles de la session qui vient de se terminer). Étape 2 : upload du
// dessin. Si un challenge est actif, on skip la sélection (la ref vient
// du challenge).
function openShareDrawing() {
  _selectedShareRef = null
  // Challenge actif → ref imposée par le challenge, on skip la sélection
  if (_activeChallenges.length) {
    _openShareUploadOverlay()
    return
  }
  // Sinon, on affiche le sélecteur de pose
  openSharePoseSelector()
}

// Étape 1 du partage : grille des poses de la session pour que l'user
// choisisse laquelle correspond à son dessin. On lit directement depuis
// #recap-grid (source unique, marche pour pose et anim sans différencier).
function openSharePoseSelector() {
  const recapItems = document.querySelectorAll('#recap-grid .recap-item')
  const poses = Array.from(recapItems)
    .map((item, i) => {
      const img = item.querySelector('img')
      // Frames cinema ont la classe cinema-frame (ratio 16/9), le reste
      // est en 3/4. On propage pour que la miniature de sélection garde
      // le bon format.
      const isCinema = item.classList.contains('cinema-frame')
      return { src: img ? img.src : '', index: i, isCinema }
    })
    .filter(p => p.src && !p.src.endsWith('#') && p.src !== window.location.href)

  // Pas de poses exploitables → passer direct à l'upload sans ref
  if (poses.length === 0) {
    _openShareUploadOverlay()
    return
  }

  let overlay = document.getElementById('share-pose-selector')
  if (overlay) overlay.remove()
  overlay = document.createElement('div')
  overlay.id = 'share-pose-selector'
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(10,14,24,0.9);z-index:1000;display:flex;align-items:center;justify-content:center;padding:24px;'

  const box = document.createElement('div')
  box.className = 'share-drawing-box'
  box.style.cssText = 'max-width:640px;width:100%;max-height:90vh;display:flex;flex-direction:column;gap:14px;padding:28px;overflow:hidden;'
  box.innerHTML =
    '<button class="share-close" id="sps-close" aria-label="Fermer">×</button>' +
    '<h3 style="margin:0;text-align:center;">Choisis la pose correspondante</h3>' +
    '<p style="margin:0;text-align:center;">Sélectionne la photo qui a servi de référence à ton dessin.</p>' +
    '<div id="sps-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;overflow-y:auto;padding:4px;"></div>' +
    '<button id="sps-skip" style="background:transparent;border:none;color:#8898b0;font-size:13px;cursor:pointer;padding:8px;text-decoration:underline;">Partager sans référence</button>'

  overlay.appendChild(box)
  document.body.appendChild(overlay)

  const grid = document.getElementById('sps-grid')
  poses.forEach(pose => {
    const item = document.createElement('div')
    const ratio = pose.isCinema ? '16/9' : '3/4'
    const label = pose.isCinema ? 'Frame ' : 'Pose '
    item.style.cssText = 'position:relative;aspect-ratio:' + ratio + ';background:#111828;border:1.5px solid transparent;border-radius:8px;overflow:hidden;cursor:pointer;transition:border-color 0.15s, transform 0.1s;'
    item.innerHTML = '<img src="' + pose.src + '" style="width:100%;height:100%;object-fit:cover;display:block;"><div style="position:absolute;bottom:4px;left:4px;background:rgba(17,24,40,0.85);border-radius:4px;padding:2px 6px;font-size:10px;color:#d8ccc4;">' + label + (pose.index + 1) + '</div>'
    item.onmouseover = () => { item.style.borderColor = '#b8a0d8'; item.style.transform = 'scale(1.02)' }
    item.onmouseout = () => { item.style.borderColor = 'transparent'; item.style.transform = 'none' }
    item.onclick = () => {
      _selectedShareRef = pose.src
      overlay.remove()
      _openShareUploadOverlay()
    }
    grid.appendChild(item)
  })

  document.getElementById('sps-close').onclick = () => overlay.remove()
  document.getElementById('sps-skip').onclick = () => {
    _selectedShareRef = null
    overlay.remove()
    _openShareUploadOverlay()
  }
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove() })
}

// Étape 2 : overlay d'upload du dessin (ancien corps de openShareDrawing).
function _openShareUploadOverlay() {
  document.getElementById('share-drawing-overlay').style.display = 'flex'
  document.getElementById('share-preview-img').style.display = 'none'
  document.getElementById('share-actions').style.display = 'none'
  document.getElementById('share-status').style.display = 'none'
  document.getElementById('share-upload-label').style.display = 'inline-flex'
  document.getElementById('share-file-input').value = ''
  // Show scan button on mobile only
  const scanBtn = document.getElementById('share-scan-btn')
  if (scanBtn) scanBtn.style.display = (_isMobile && (window.__isAndroid || window.__isIOS)) ? 'inline-flex' : 'none'
  // Update message if challenge is active
  const desc = document.querySelector('#share-drawing-overlay .share-drawing-box p')
  if (desc && _activeChallenges.length) {
    desc.textContent = 'Challenge en cours : ' + _activeChallenges[0].title + ' — ton dessin sera automatiquement inscrit !'
  } else if (desc) {
    desc.textContent = 'Prends en photo ton croquis pour le montrer à la communauté !'
  }
}

function closeShareDrawing() {
  document.getElementById('share-drawing-overlay').style.display = 'none'
}

let _shareBlob = null
function handleShareFile(input) {
  const file = input.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = function(e) {
    const img = new Image()
    img.onload = function() {
      // Compress: max 1200px, JPEG 80%
      const canvas = document.getElementById('share-preview-canvas')
      const maxW = 1200
      let w = img.width, h = img.height
      if (w > maxW) { h = Math.round(h * maxW / w); w = maxW }
      canvas.width = w; canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, w, h)
      canvas.toBlob(function(blob) {
        _shareBlob = blob
        const preview = document.getElementById('share-preview-img')
        if (preview.src && preview.src.startsWith('blob:')) URL.revokeObjectURL(preview.src)
        preview.src = URL.createObjectURL(blob)
        preview.style.display = 'block'
        document.getElementById('share-upload-label').style.display = 'none'
        document.getElementById('share-actions').style.display = 'flex'
      }, 'image/jpeg', 0.8)
    }
    img.src = e.target.result
  }
  reader.readAsDataURL(file)
}

async function confirmShareDrawing() {
  if (!_shareBlob || _uploading) return
  _uploading = true
  const status = document.getElementById('share-status')
  status.style.display = 'block'
  status.textContent = 'Envoi en cours...'
  document.getElementById('share-actions').style.display = 'none'
  try {
    const postData = {
      // Priorité : pose choisie explicitement par l'user dans la modale
      // de sélection, sinon fallback sur _lastRefUrl (dernière pose vue).
      refImageUrl: _selectedShareRef || _lastRefUrl || null,
      username: _communityUsername || (_communityEmail ? _communityEmail.split('@')[0] : 'anonyme'),
    }
    if (_isMobile) postData.imageBase64 = await _blobToBase64(_shareBlob)
    const res = await window.electronAPI.submitCommunityPost(postData)
    if (res.error) throw new Error(res.error)
    if (!res.uploaded && res.uploadUrl) {
      await fetch(res.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        body: _shareBlob,
      })
      // Desktop: run auto-moderation after upload
      if (res.needsModeration && res.postId) {
        status.textContent = 'Vérification du contenu...'
        const modRes = await window.electronAPI.moderateCommunityPost(res.postId)
        if (modRes && !modRes.ok) throw new Error(modRes.reason || 'Image refusée par la modération automatique.')
      }
    }
    if (_activeChallenges.length && res.postId) {
      try { await window.electronAPI.tagPostToChallenge(res.postId, _activeChallenges[0].id) } catch(e) { /* silent */ }
    }
    status.textContent = 'Publié ! Ton dessin est visible dans la Communauté.'
    status.style.color = '#a8d090'
    _communityStats = null; checkBadges()
    setTimeout(() => { _uploading = false; closeShareDrawing() }, 2000)
  } catch(e) {
    _uploading = false
    status.textContent = 'Erreur : ' + (e.message || 'échec upload')
    status.style.color = '#e74c3c'
    document.getElementById('share-actions').style.display = 'flex'
  }
}

// ── Community compare view (clic sur un post community) ──
let _ccCurrentPost = null

function openCommunityCompare(post) {
  if (!post) return
  _ccCurrentPost = post
  const overlay = document.getElementById('community-compare')
  if (!overlay) return
  const drawingUrl = post.image_url || post.media_url
  const refUrl = post.ref_image_url
  document.getElementById('cc-drawing').src = drawingUrl || ''
  const refImg = document.getElementById('cc-ref')
  const refWrap = document.getElementById('cc-ref-wrap')
  if (refUrl) {
    refImg.src = refUrl
    refWrap.style.display = ''
    overlay.classList.remove('cc-single')
  } else {
    refImg.src = ''
    refWrap.style.display = 'none'
    overlay.classList.add('cc-single')
  }
  document.getElementById('cc-user').textContent = post.username || 'anonyme'
  document.getElementById('cc-date').textContent = formatPostDate(post.timestamp || post.created_at)
  // Reactions (visual only, clickable to toggle)
  const reactionsEl = document.getElementById('cc-reactions')
  reactionsEl.innerHTML = ''
  reactionsEl.dataset.post = post.id
  const mine = myReactions[post.id] || []
  const counts = reactionsCache[post.id] || {}
  COMMUNITY_EMOJIS.forEach(em => {
    const btn = document.createElement('button')
    const count = counts[em] || 0
    btn.className = 'community-reaction-btn' + (mine.includes(em) ? ' active' : '')
    btn.dataset.emoji = em
    btn.innerHTML = em + '<span class="count">' + (count || '') + '</span>'
    btn.onclick = () => toggleReaction(post.id, em)
    reactionsEl.appendChild(btn)
  })
  // Show/hide draw button based on ref availability
  document.getElementById('cc-draw-btn').style.display = refUrl ? 'block' : 'none'
  overlay.style.display = 'flex'
  document.addEventListener('keydown', _ccEscHandler)
}

function closeCommunityCompare() {
  const overlay = document.getElementById('community-compare')
  if (overlay) overlay.style.display = 'none'
  document.removeEventListener('keydown', _ccEscHandler)
  _ccCurrentPost = null
}

function _ccEscHandler(e) { if (e.key === 'Escape') closeCommunityCompare() }

function drawFromRefUrl(refUrl) {
  if (!refUrl) return
  // Same pattern as participateChallenge: single-image session with the ref
  sessionEntries = [{ type: 'image', path: refUrl, category: 'Communauté', isR2: true }]
  currentIndex = 0; sessionLog = []; _challengeSession = true
  // imgCache gardé entre sessions (les URLs R2 ne changent pas, re-download inutile)
  mainMode = 'pose'; currentSubMode = 'class'
  closeEndConfirm()
  document.getElementById('controls').style.display = 'flex'
  showScreen('screen-session'); loadAndShow(0)
}

function drawFromCompare() {
  if (!_ccCurrentPost || !_ccCurrentPost.ref_image_url) return
  const refUrl = _ccCurrentPost.ref_image_url
  closeCommunityCompare()
  drawFromRefUrl(refUrl)
}

async function shareFromCompare() {
  if (!_ccCurrentPost) return
  const btn = document.getElementById('cc-share-btn')
  const origText = btn.textContent
  btn.textContent = '⏳ Chargement...'
  btn.disabled = true

  const imgUrl = _ccCurrentPost.image_url
  const shareText = 'Dessin réalisé avec Gesturo ✏️ gesturo.art\n#gesturo #gesturedrawing #art #sketch'

  try {
    if (window.electronAPI?.shareImage) {
      const res = await window.electronAPI.shareImage({ imageUrl: imgUrl, text: shareText })
      if (res.ok) {
        btn.textContent = '✅ Partagé !'
        setTimeout(() => { btn.textContent = origText; btn.disabled = false }, 2000)
        return
      }
      if (res.error) {
        btn.textContent = '❌ ' + res.error
        setTimeout(() => { btn.textContent = origText; btn.disabled = false }, 4000)
        return
      }
    } else {
      await navigator.clipboard?.writeText(shareText)
      showAlertModal('Texte copié ! Enregistre l\'image et colle le texte sur Instagram.')
    }
  } catch (e) {
    btn.textContent = '❌ Erreur'
    setTimeout(() => { btn.textContent = origText; btn.disabled = false }, 3000)
    return
  }

  btn.textContent = origText
  btn.disabled = false
}

function buildPostCard(post, i) {
  const card = document.createElement('div')
  card.className = 'community-post'
  card.style.animationDelay = (i * 60) + 'ms'

  // Image
  const img = document.createElement('img')
  img.className = 'community-post-img'
  img.src = post.image_url || post.media_url
  img.alt = post.username || 'Post'
  img.loading = 'lazy'
  if (post.source === 'community') {
    img.onclick = () => openCommunityCompare(post)
  } else if (post.permalink) {
    img.onclick = () => window.electronAPI.openExternal(post.permalink)
  }
  card.appendChild(img)

  // Badge
  if (post.source === 'tagged' || post.source === 'community') {
    const badge = document.createElement('div')
    badge.className = 'community-post-badge'
    badge.textContent = post.source === 'community' ? 'Dessin' : 'Communauté'
    card.appendChild(badge)
  }

  // Featured post badge
  if (post.featured) {
    card.classList.add('community-post-featured')
    const pinBadge = document.createElement('div')
    pinBadge.className = 'community-post-pin'
    pinBadge.textContent = '📌'
    card.appendChild(pinBadge)
  }

  // Info bar
  const info = document.createElement('div')
  info.className = 'community-post-info'

  const header = document.createElement('div')
  header.className = 'community-post-header'

  const user = document.createElement('span')
  user.className = 'community-post-user'
  user.textContent = post.source === 'community' ? (post.username || 'anonyme') : ('@' + (post.username || 'gesturo.art'))
  if (post.user_featured) {
    const star = document.createElement('span')
    star.className = 'community-user-star'
    star.textContent = ' ⭐'
    star.title = 'Coup de cœur Gesturo'
    user.appendChild(star)
  }
  if (post.permalink) user.onclick = () => window.electronAPI.openExternal('https://www.instagram.com/' + (post.username || 'gesturo.art'))

  const date = document.createElement('span')
  date.className = 'community-post-date'
  date.textContent = formatPostDate(post.timestamp || post.created_at)

  header.appendChild(user)
  header.appendChild(date)
  info.appendChild(header)

  // Likes (IG only)
  if (post.like_count !== undefined) {
    const likes = document.createElement('div')
    likes.className = 'community-post-likes'
    likes.textContent = '❤️ ' + (post.like_count || 0)
    info.appendChild(likes)
  }

  card.appendChild(info)

  // Ref image + "Dessiner cette ref" (community posts only)
  if (post.source === 'community' && post.ref_image_url) {
    const refRow = document.createElement('div')
    refRow.className = 'community-post-ref'
    const refThumb = document.createElement('img')
    refThumb.src = post.ref_image_url
    refThumb.alt = 'Ref'
    refThumb.className = 'community-ref-thumb'
    refRow.appendChild(refThumb)
    const refLabel = document.createElement('span')
    refLabel.className = 'community-ref-label'
    refLabel.textContent = 'Réf utilisée'
    refRow.appendChild(refLabel)
    const refBtn = document.createElement('button')
    refBtn.className = 'community-ref-btn'
    refBtn.textContent = 'Dessiner cette ref'
    refBtn.onclick = (e) => { e.stopPropagation(); drawFromRefUrl(post.ref_image_url) }
    refRow.appendChild(refBtn)
    card.appendChild(refRow)
  }

  // Emoji reactions
  const reactions = document.createElement('div')
  reactions.className = 'community-reactions'
  reactions.dataset.post = post.id
  const mine = myReactions[post.id] || []
  const counts = reactionsCache[post.id] || {}
  const users = reactionUsers[post.id] || {}
  COMMUNITY_EMOJIS.forEach(em => {
    const btn = document.createElement('button')
    const count = counts[em] || 0
    btn.className = 'community-reaction-btn' + (mine.includes(em) ? ' active' : '')
    btn.dataset.emoji = em
    btn.innerHTML = em + '<span class="count">' + (count || '') + '</span>'
    const names = users[em] || []
    if (count > 0 && names.length > 0) {
      const tooltip = document.createElement('span')
      tooltip.className = 'reaction-tooltip'
      tooltip.textContent = names.slice(0, 8).join(', ') + (names.length > 8 ? '…' : '')
      btn.appendChild(tooltip)
    }
    btn.onclick = () => toggleReaction(post.id, em)
    reactions.appendChild(btn)
  })
  card.appendChild(reactions)

  return card
}

let _communityToken = 0
let _lastCommunityHash = ''
async function renderCommunity(forceRebuild = false) {
  const token = ++_communityToken
  const feed = document.getElementById('community-feed')
  const empty = document.getElementById('community-empty')
  feed.innerHTML = ''; empty.style.display = 'block'; empty.textContent = 'Chargement...'
  try {
    // Fetch IG posts + community posts + challenges in parallel
    const [igPosts, communityRes] = await Promise.all([
      window.electronAPI.getInstagramPosts().catch(() => []),
      window.electronAPI.getCommunityPosts().catch(() => ({ posts: [] })),
    ])
    if (token !== _communityToken) return

    // Load challenges (once, cached in _activeChallenges)
    // If none exist, trigger daily-challenge to auto-create one
    if (!_activeChallenges.length) {
      await loadChallenges()
      if (!_activeChallenges.length) {
        try { await triggerDailyChallenge(); await loadChallenges() } catch(e) { /* silent */ }
      }
    }
    if (token !== _communityToken) return

    empty.style.display = 'none'

    // Normalize IG posts
    const allPosts = []
    const seen = new Set()
    ;(igPosts || []).forEach(post => {
      if (post.media_type !== 'IMAGE' && post.media_type !== 'CAROUSEL_ALBUM') return
      if (seen.has(post.id)) return; seen.add(post.id)
      allPosts.push({ ...post, _sort: new Date(post.timestamp).getTime() })
    })

    // Normalize community posts
    ;(communityRes.posts || []).forEach(post => {
      allPosts.push({
        id: post.id,
        image_url: post.image_url,
        username: post.username,
        created_at: post.created_at,
        ref_image_url: post.ref_image_url,
        challenge_id: post.challenge_id || null,
        featured: post.featured || false,
        user_featured: post.user_featured || false,
        source: 'community',
        _sort: new Date(post.created_at).getTime(),
      })
    })

    // Update participants count in banner
    updateChallengeParticipants(allPosts)

    // Filter by challenge if selected
    let filtered = allPosts
    const hero = document.getElementById('challenge-hero')
    if (_selectedChallengeFilter) {
      filtered = allPosts.filter(p => p.challenge_id === _selectedChallengeFilter)
      const ch = _activeChallenges.find(c => c.id === _selectedChallengeFilter)
      if (ch && hero) {
        hero.style.display = ''
        hero.innerHTML = '<div class="challenge-hero-card">'
          + '<img class="challenge-hero-img" src="' + ch.ref_image_url + '" alt="Ref">'
          + '<div class="challenge-hero-overlay">'
          + '<div class="challenge-label">CHALLENGE</div>'
          + '<h2>' + ch.title + '</h2>'
          + '<div class="challenge-hero-count">' + filtered.length + ' dessin' + (filtered.length > 1 ? 's' : '') + '</div>'
          + '</div></div>'
      }
    } else if (hero) {
      hero.style.display = 'none'
      hero.innerHTML = ''
    }

    if (filtered.length === 0) { empty.style.display = 'block'; empty.textContent = _selectedChallengeFilter ? 'Aucun dessin pour ce challenge.' : 'Aucune photo pour le moment.'; return }

    // Sort: featured first, then by date descending
    filtered.sort((a, b) => {
      if (a.featured && !b.featured) return -1
      if (!a.featured && b.featured) return 1
      return b._sort - a._sort
    })

    // Skip DOM rebuild si le feed n'a pas changé (refresh auto 60s)
    const hash = filtered.map(p => p.id).join(',')
    if (!forceRebuild && hash === _lastCommunityHash && feed.children.length > 0) {
      empty.style.display = 'none'
      return
    }
    _lastCommunityHash = hash

    // Load reactions
    await loadReactions(filtered.map(p => p.id))
    if (token !== _communityToken) return
    feed.innerHTML = ''

    // If active challenge and no filter, split into challenge/other sections
    const activeChId = !_selectedChallengeFilter && _activeChallenges.length ? _activeChallenges[0].id : null
    if (activeChId) {
      const challengePosts = filtered.filter(p => p.challenge_id === activeChId)
      const otherPosts = filtered.filter(p => p.challenge_id !== activeChId)
      let idx = 0
      if (challengePosts.length) {
        const sep1 = document.createElement('div')
        sep1.className = 'feed-separator'
        sep1.innerHTML = '<span>Dessins du challenge · ' + challengePosts.length + ' participant' + (challengePosts.length > 1 ? 's' : '') + '</span>'
        feed.appendChild(sep1)
        challengePosts.forEach(p => feed.appendChild(buildPostCard(p, idx++)))
      }
      if (otherPosts.length) {
        const sep2 = document.createElement('div')
        sep2.className = 'feed-separator'
        sep2.innerHTML = '<span>Autres dessins</span>'
        feed.appendChild(sep2)
        otherPosts.forEach(p => feed.appendChild(buildPostCard(p, idx++)))
      }
    } else {
      filtered.forEach((post, i) => feed.appendChild(buildPostCard(post, i)))
    }
  } catch(e) {
    if (token !== _communityToken) return
    empty.style.display = 'block'; empty.textContent = 'Erreur de chargement.'
  }
}

let communityInterval = null
let _countdownInterval = null
let _communityTab = 'feed'

function startCommunityRefresh() {
  if (communityInterval) clearInterval(communityInterval)
  communityInterval = setInterval(() => { if (mainMode === 'community' && _communityTab === 'feed' && !_uploading) renderCommunity() }, 60 * 1000)
  // Live countdown update every second
  if (_countdownInterval) clearInterval(_countdownInterval)
  _countdownInterval = setInterval(updateChallengeCountdown, 1000)
}

function switchCommunityTab(tab) {
  // Re-clic sur le tab déjà actif → refresh la vue (comme Instagram / Twitter).
  // Sinon (1er clic sur un autre tab) : switch normal.
  if (_communityTab === tab) {
    if (tab === 'feed') renderCommunity(true)
    else if (tab === 'mine') renderMyPosts()
    else if (tab === 'leaderboard') renderLeaderboard()
    return
  }
  _communityTab = tab
  document.getElementById('ctab-feed').classList.toggle('active', tab === 'feed')
  document.getElementById('ctab-mine').classList.toggle('active', tab === 'mine')
  document.getElementById('ctab-leaderboard').classList.toggle('active', tab === 'leaderboard')
  document.getElementById('community-feed').style.display = tab === 'feed' ? '' : 'none'
  document.getElementById('community-mine').style.display = tab === 'mine' ? '' : 'none'
  document.getElementById('community-leaderboard').style.display = tab === 'leaderboard' ? '' : 'none'
  document.getElementById('community-empty').style.display = 'none'
  if (tab === 'feed') renderCommunity(true)
  else if (tab === 'mine') renderMyPosts()
  else if (tab === 'leaderboard') renderLeaderboard()
}

let _myPostsToken = 0
async function renderMyPosts() {
  const token = ++_myPostsToken
  const grid = document.getElementById('community-mine')
  const empty = document.getElementById('community-empty')
  const oldStats = grid.parentNode.querySelector('.my-posts-stats')
  if (oldStats) oldStats.remove()
  grid.innerHTML = ''; empty.style.display = 'block'; empty.textContent = 'Chargement...'
  try {
    const res = await window.electronAPI.getCommunityPosts()
    if (token !== _myPostsToken) return
    const myPosts = (res.posts || []).filter(p => p.user_email === _communityEmail)
    empty.style.display = 'none'
    if (myPosts.length === 0) {
      grid.innerHTML = '<div class="mine-empty">Tu n\'as pas encore partage de dessin.<br>Fais une session et partage depuis le Recap !</div>'
      return
    }

    await loadReactions(myPosts.map(p => p.id))
    if (token !== _myPostsToken) return
    grid.innerHTML = ''
    const existingStats = grid.parentNode.querySelector('.my-posts-stats')
    if (existingStats) existingStats.remove()

    // Stats header
    let totalReactions = 0
    myPosts.forEach(p => {
      const counts = reactionsCache[p.id] || {}
      Object.values(counts).forEach(c => { totalReactions += c })
    })
    const statsEl = document.createElement('div')
    statsEl.className = 'my-posts-stats'
    statsEl.innerHTML = '<span>📝 ' + myPosts.length + ' dessin' + (myPosts.length > 1 ? 's' : '') + '</span>'
      + '<span>💬 ' + totalReactions + ' reaction' + (totalReactions > 1 ? 's' : '') + ' reçue' + (totalReactions > 1 ? 's' : '') + '</span>'
    grid.parentNode.insertBefore(statsEl, grid)

    myPosts.forEach((post, i) => {
      const card = buildPostCard({
        id: post.id,
        image_url: post.image_url,
        username: post.username,
        created_at: post.created_at,
        source: 'community',
      }, i)

      // Add delete button
      const del = document.createElement('button')
      del.className = 'community-post-delete'
      del.textContent = '×'
      del.title = 'Supprimer'
      del.onclick = (e) => {
        e.stopPropagation()
        showConfirmModal('Supprimer ce dessin ?', async () => {
          try {
            await window.electronAPI.deleteCommunityPost(post.id)
            renderMyPosts()
          } catch(err) { /* silent */ }
        }, { confirmText: 'Supprimer', danger: true })
      }
      card.appendChild(del)

      grid.appendChild(card)
    })
  } catch(e) {
    if (token !== _myPostsToken) return
    empty.style.display = 'block'; empty.textContent = 'Erreur de chargement.'
  }
}

const LEADERBOARD_MEDALS = ['🥇', '🥈', '🥉']

let _leaderboardToken = 0
async function renderLeaderboard() {
  const token = ++_leaderboardToken
  const container = document.getElementById('community-leaderboard')
  const empty = document.getElementById('community-empty')
  container.innerHTML = ''; empty.style.display = 'block'; empty.textContent = 'Chargement...'
  try {
    const res = await window.electronAPI.getCommunityLeaderboard()
    // Race guard : si un autre renderLeaderboard a été lancé entre temps, on abandonne
    if (token !== _leaderboardToken) return
    const rawList = res.leaderboard || []
    // Dédupe défensif par username (ceinture + bretelles)
    const seen = new Set()
    const list = rawList.filter(e => {
      const key = (e.username || '').toLowerCase()
      if (!key || seen.has(key)) return false
      seen.add(key); return true
    })
    empty.style.display = 'none'
    if (list.length === 0) {
      container.innerHTML = '<div class="mine-empty">Pas encore de classement.<br>Partage tes dessins pour apparaitre ici !</div>'
      return
    }
    const table = document.createElement('div')
    table.className = 'leaderboard-list'
    list.forEach((entry, i) => {
      const row = document.createElement('div')
      row.className = 'leaderboard-row' + (i < 3 ? ' leaderboard-top' : '')
      row.style.animationDelay = (i * 50) + 'ms'

      const rank = document.createElement('span')
      rank.className = 'leaderboard-rank'
      rank.textContent = i < 3 ? LEADERBOARD_MEDALS[i] : '#' + (i + 1)

      const name = document.createElement('span')
      name.className = 'leaderboard-name'
      name.textContent = entry.username

      const stats = document.createElement('span')
      stats.className = 'leaderboard-stats'
      stats.innerHTML = '<span class="lb-posts">' + entry.posts + ' post' + (entry.posts > 1 ? 's' : '') + '</span>'
        + '<span class="lb-reactions">' + entry.reactions + ' reaction' + (entry.reactions > 1 ? 's' : '') + '</span>'

      row.appendChild(rank)
      row.appendChild(name)
      row.appendChild(stats)
      table.appendChild(row)
    })
    // Dernière vérif avant append : race guard
    if (token !== _leaderboardToken) return
    container.innerHTML = ''
    container.appendChild(table)
  } catch(e) {
    if (token !== _leaderboardToken) return
    empty.style.display = 'block'; empty.textContent = 'Erreur de chargement.'
  }
}

function _initCommunityListeners() {
  document.getElementById('btn-community-upload').addEventListener('click', openCommunityUpload)
  document.getElementById('link-instagram').addEventListener('click', function(e) { e.preventDefault(); window.electronAPI.openExternal('https://www.instagram.com/gesturo.art') })
  document.getElementById('link-discord-community').addEventListener('click', function(e) { e.preventDefault(); window.electronAPI.openExternal('https://discord.gg/f9pf3vmgg2') })
  document.getElementById('ctab-feed').addEventListener('click', function() { switchCommunityTab('feed') })
  document.getElementById('ctab-mine').addEventListener('click', function() { switchCommunityTab('mine') })
  document.getElementById('ctab-leaderboard').addEventListener('click', function() { switchCommunityTab('leaderboard') })
  document.getElementById('challenge-select').addEventListener('change', filterByChallenge)
  document.getElementById('community-upload-overlay').addEventListener('click', function(e) { if (e.target === this) closeCommunityUpload() })
  document.getElementById('community-file-input').addEventListener('change', function() { handleCommunityFile(this) })
  document.getElementById('community-scan-btn').addEventListener('click', scanCommunityDrawing)
  document.getElementById('btn-confirm-community-upload').addEventListener('click', confirmCommunityUpload)
  document.getElementById('btn-cancel-community-upload').addEventListener('click', closeCommunityUpload)
  document.getElementById('btn-close-community-upload').addEventListener('click', closeCommunityUpload)
  document.getElementById('btn-share-drawing').addEventListener('click', openShareDrawing)
  document.getElementById('share-drawing-overlay').addEventListener('click', function(e) { if (e.target === this) closeShareDrawing() })
  document.getElementById('share-file-input').addEventListener('change', function() { handleShareFile(this) })
  document.getElementById('share-scan-btn').addEventListener('click', scanShareDrawing)
  document.getElementById('btn-confirm-share').addEventListener('click', confirmShareDrawing)
  document.getElementById('btn-cancel-share').addEventListener('click', closeShareDrawing)
  document.getElementById('btn-close-share').addEventListener('click', closeShareDrawing)
  document.getElementById('community-compare').addEventListener('click', function(e) { if (!e.target.closest('button, a')) closeCommunityCompare() })
  document.getElementById('cc-close-btn').addEventListener('click', closeCommunityCompare)
  document.getElementById('cc-draw-btn').addEventListener('click', drawFromCompare)
  document.getElementById('cc-share-btn').addEventListener('click', shareFromCompare)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initCommunityListeners)
} else {
  _initCommunityListeners()
}
