// ════════════════════════════════
//  MODULE CINÉMA
// ════════════════════════════════

const FILMS = {
  theshining:       { title: 'The Shining',         emoji: '🏨', frames: 5907,  base: 'https://res.cloudinary.com/dmy21mg7g/image/upload/v1541253320/Shining/',      prefix: 'Shining_',       suffix: '.jpg' },
  interstellar:     { title: 'Interstellar',         emoji: '🚀', frames: 9237,  base: 'https://res.cloudinary.com/dz24lmtby/image/upload/v1541253320/Interstellar/', prefix: 'Interstellar_',  suffix: '.jpg' },
  thegodfather:     { title: 'The Godfather',        emoji: '🌹', frames: 9773,  base: 'https://res.cloudinary.com/dhfdso9tc/image/upload/v1541253320/Godfather/',    prefix: 'Godfather_',     suffix: '.jpg' },
  barrylyndon:      { title: 'Barry Lyndon',         emoji: '🕯️', frames: 8977,  base: 'https://res.cloudinary.com/dmy21mg7g/image/upload/v1541253320/Barry/',       prefix: 'Barry_',         suffix: '.jpg' },
  drive:            { title: 'Drive',                emoji: '🚗', frames: 5111,  base: 'https://res.cloudinary.com/dmoz2zj22/image/upload/v1541253320/Drive/',        prefix: 'Drive_',         suffix: '.jpg' },
  wolfofwallstreet: { title: 'Le Loup de Wall Street', emoji: '💰', frames: 8000,  base: 'https://res.cloudinary.com/dmoz2zj22/image/upload/v1541253320/Wolf/',         prefix: 'Wolf_',          suffix: '.jpg' },
  thematrix:        { title: 'The Matrix',           emoji: '💊', frames: 7507,  base: 'https://res.cloudinary.com/df0nig2sf/image/upload/v1541253320/Matrix/',       prefix: 'Matrix_',        suffix: '.jpg' },
  bladerunner2049:  { title: 'Blade Runner 2049',    emoji: '🌆', frames: 8820,  base: 'https://res.cloudinary.com/dxminysyw/image/upload/v1541253320/Blade/',        prefix: 'Blade_',         suffix: '.jpg' },
  aclockworkorange: { title: 'A Clockwork Orange',   emoji: '🎩', frames: 6831,  base: 'https://res.cloudinary.com/dfaqfbscb/image/upload/v1541253320/Clockwork/',    prefix: 'Clockwork_',     suffix: '.jpg' },
  thegrandbudapest: { title: 'Grand Budapest Hotel', emoji: '🏩', frames: 5419,  base: 'https://res.cloudinary.com/dxminysyw/image/upload/v1541253320/Grand/',        prefix: 'Grand_',         suffix: '.jpg' },
  spiritedaway:     { title: 'Spirited Away',        emoji: '🐉', frames: 7194,  base: 'https://drwzfjhojt14u.cloudfront.net/spirited_away/',                        prefix: 'spirited_away_', suffix: '.png' },
  amelie:           { title: 'Amélie',               emoji: '🌻', frames: 7046,  base: 'https://drwzfjhojt14u.cloudfront.net/amelie/',                               prefix: 'amelie_',        suffix: '.jpg' },
}

let cinemaState = {
  film: null, frameCount: 10, frames: [], index: 0, maxIndex: 0,
  gridVisible: false, bwMode: false, flipH: false,
}

function initFilmGrid() {
  const grid = document.getElementById('film-grid')
  if (!grid || grid.children.length > 0) return
  grid.innerHTML = ''
  Object.entries(FILMS).forEach(([key, film]) => {
    const card = document.createElement('div')
    card.className = 'film-card'; card.dataset.key = key
    card.innerHTML = `<div class="film-card-thumb-placeholder">${film.emoji}</div><div class="film-card-info"><div class="film-card-title">${film.title}</div><div class="film-card-frames">${film.frames.toLocaleString()} frames</div></div><div class="film-card-check">✓</div>`
    card.onclick = () => selectFilm(key)
    grid.appendChild(card)
  })
  document.querySelectorAll('#cinema-chips .chip').forEach(chip => {
    chip.onclick = () => {
      document.querySelectorAll('#cinema-chips .chip').forEach(c => c.classList.remove('selected'))
      chip.classList.add('selected')
      const val = chip.dataset.val
      if (val === 'custom-cinema') document.getElementById('cinema-custom-row').style.display = 'flex'
      else { document.getElementById('cinema-custom-row').style.display = 'none'; cinemaState.frameCount = parseInt(val) }
    }
  })
}

function selectFilm(key) {
  cinemaState.film = key
  document.querySelectorAll('.film-card').forEach(c => c.classList.remove('selected'))
  document.querySelector(`.film-card[data-key="${key}"]`).classList.add('selected')
  const btn = document.getElementById('btn-cinema-start')
  if (btn) btn.disabled = !cinemaState.film
}

function getCinemaFrameCount() {
  const custom = document.getElementById('cinema-custom-row')
  if (custom && custom.style.display !== 'none') return parseInt(document.getElementById('cinema-custom-count').value) || 10
  const sel = document.querySelector('#cinema-chips .chip.selected')
  return sel ? parseInt(sel.dataset.val) || 10 : 10
}

function startCinemaSession() {
  if (!cinemaState.film) return
  const film = FILMS[cinemaState.film]
  const count = getCinemaFrameCount()
  const allNums = Array.from({length: film.frames}, (_, i) => i + 1)
  for (let i = allNums.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allNums[i], allNums[j]] = [allNums[j], allNums[i]]
  }
  cinemaState.frames = allNums.slice(0, count)
  cinemaState.index = 0; cinemaState.maxIndex = 0; cinemaState.gridVisible = false; cinemaState.bwMode = false; cinemaState.flipH = false
  showScreen('screen-cinema')
  document.getElementById('cinema-film-badge').textContent = film.title
  document.getElementById('cinema-film-name').textContent = film.title
  document.getElementById('cinema-grid-overlay').classList.remove('visible')
  document.getElementById('cinema-grid-btn').classList.remove('grid-active')
  cinemaLoadFrame()
}

function cinemaLoadFrame() {
  if (cinemaState.index > cinemaState.maxIndex) cinemaState.maxIndex = cinemaState.index
  const film = FILMS[cinemaState.film]
  const num = cinemaState.frames[cinemaState.index]
  const url = `${film.base}${film.prefix}${num}${film.suffix}`
  const img = document.getElementById('cinema-img'); const loader = document.getElementById('cinema-loader')
  loader.classList.add('visible'); img.style.opacity = '0'
  applyCinemaTransforms()
  const tmp = new Image()
  tmp.onload = () => { img.src = url; img.style.opacity = '1'; loader.classList.remove('visible'); updateCinemaUI() }
  tmp.onerror = () => { loader.classList.remove('visible'); img.style.opacity = '1'; updateCinemaUI() }
  tmp.src = url
  if (cinemaState.index + 1 < cinemaState.frames.length) {
    const nextNum = cinemaState.frames[cinemaState.index + 1]
    new Image().src = `${film.base}${film.prefix}${nextNum}${film.suffix}`
  }
}

// PATCH 2 : updateCinemaUI avec updateCinemaFavBtn
function updateCinemaUI() {
  const total = cinemaState.frames.length; const current = cinemaState.index + 1
  document.getElementById('cinema-frame-counter').textContent = `${current} / ${total}`
  document.getElementById('cinema-progress-bar').style.width = `${(current / total) * 100}%`
  document.getElementById('cinema-btn-prev').disabled = cinemaState.index === 0
  document.getElementById('cinema-btn-next').disabled = cinemaState.index >= total - 1
  updateCinemaFavBtn() // ← PATCH 2
}

function cinemaNext() {
  if (cinemaState.index >= cinemaState.frames.length - 1) return
  cinemaState.index++; cinemaLoadFrame()
}

function cinemaPrev() {
  if (cinemaState.index <= 0) return
  cinemaState.index--; cinemaLoadFrame()
}

// PATCH 3 : endCinemaSession avec récap
function endCinemaSession() {
  const film = FILMS[cinemaState.film]
  const viewedFrames = cinemaState.frames.slice(0, cinemaState.maxIndex + 1)
  // Header récap
  document.getElementById('recap-title').textContent = '🎬 ' + film.title
  document.getElementById('stat-poses').textContent = viewedFrames.length
  document.getElementById('stat-poses-label').textContent = 'frames'
  document.getElementById('stat-time').textContent = film.title
  document.getElementById('stat-time-label').textContent = ''
  // Log session cinéma
  logSession({ type: 'cinema', poses: viewedFrames.length, minutes: 0, film: film.title })
  // Grille récap
  const grid = document.getElementById('recap-grid'); grid.innerHTML = ''
  viewedFrames.forEach((num, i) => {
    const url = `${film.base}${film.prefix}${num}${film.suffix}`
    const item = document.createElement('div')
    item.className = 'recap-item cinema-frame' // aspect-ratio 16/9

    const img = document.createElement('img')
    img.src = url; img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;'
    item.appendChild(img)

    const numBadge = document.createElement('div')
    numBadge.className = 'recap-num'; numBadge.textContent = 'F' + num; item.appendChild(numBadge)

    const star = document.createElement('button')
    star.className = 'recap-star' + (isFaved(url) ? ' faved' : '')
    star.textContent = isFaved(url) ? '★' : '☆'; star.title = 'Favori'
    star.onclick = (e) => {
      e.stopPropagation()
      const label = film.title + ' — Frame ' + num
      if (isFaved(url)) { removeFav(url); star.textContent = '☆'; star.classList.remove('faved') }
      else { addFav(url, label); star.textContent = '★'; star.classList.add('faved') }
      star.classList.add('bump'); setTimeout(() => star.classList.remove('bump'), 250)
    }
    item.appendChild(star)
    item.addEventListener('click', () => openLightbox(url, i, 0))
    grid.appendChild(item)
  })
  showScreen('screen-end')
}

// PATCH 4 : fonctions favoris cinéma
function toggleFavCinema() {
  const img = document.getElementById('cinema-img'); if (!img || !img.src) return
  const src = img.src; const btn = document.getElementById('cinema-fav-btn')
  const film = FILMS[cinemaState.film]
  const label = film.title + ' — Frame ' + cinemaState.frames[cinemaState.index]
  if (isFaved(src)) { removeFav(src); btn.textContent = '☆'; btn.classList.remove('active') }
  else { addFav(src, label); btn.textContent = '★'; btn.classList.add('active') }
  btn.classList.add('bump'); setTimeout(() => btn.classList.remove('bump'), 300)
}

function updateCinemaFavBtn() {
  const img = document.getElementById('cinema-img'); const btn = document.getElementById('cinema-fav-btn')
  if (!img || !btn) return
  const faved = isFaved(img.src); btn.textContent = faved ? '★' : '☆'; btn.classList.toggle('active', faved)
}

// Outils composition cinéma
function toggleCinemaGrid() {
  cinemaState.gridVisible = !cinemaState.gridVisible
  document.getElementById('cinema-grid-overlay').classList.toggle('visible', cinemaState.gridVisible)
  document.getElementById('cinema-grid-btn').classList.toggle('grid-active', cinemaState.gridVisible)
}

function toggleCinemaBW() {
  cinemaState.bwMode = !cinemaState.bwMode
  document.getElementById('cinema-bw-btn').classList.toggle('grid-active', cinemaState.bwMode)
  applyCinemaTransforms()
}

function flipCinemaH() { cinemaState.flipH = !cinemaState.flipH; applyCinemaTransforms() }

function applyCinemaTransforms() {
  const img = document.getElementById('cinema-img'); if (!img) return
  img.style.transform = cinemaState.flipH ? 'scaleX(-1)' : ''
  img.style.filter = cinemaState.bwMode ? 'grayscale(100%)' : ''
}
