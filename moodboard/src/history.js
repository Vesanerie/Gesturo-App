// Undo/redo via JSON snapshots of `photos`, plus clipboard paste handling
// for images and image URLs.

function snapshot() {
  if (historyMuted) return
  const state = JSON.stringify(photos)
  if (historyIndex >= 0 && history[historyIndex] === state) return
  history = history.slice(0, historyIndex + 1)
  history.push(state)
  if (history.length > 50) history.shift()
  historyIndex = history.length - 1
}

function restoreFrom(state) {
  historyMuted = true
  photos.forEach(ph => { const el = document.getElementById('photo-' + ph.id); if (el) el.remove() })
  photos = JSON.parse(state)
  idCounter = photos.reduce((m, ph) => Math.max(m, ph.id || 0), 0)
  photos.forEach(createPhotoEl)
  updateCount()
  document.getElementById('empty-state').style.display = photos.length === 0 && !currentProject ? 'none' : (photos.length === 0 ? 'block' : 'none')
  historyMuted = false
  scheduleSave()
  updateMinimap()
}

function undo() {
  if (historyIndex <= 0) return
  historyIndex--
  restoreFrom(history[historyIndex])
  showToast('Annulé')
}

function redo() {
  if (historyIndex >= history.length - 1) return
  historyIndex++
  restoreFrom(history[historyIndex])
  showToast('Rétabli')
}

// ─── Clipboard paste (image data + URLs) ───────────────────

document.addEventListener('paste', async (e) => {
  if (!currentProject) return
  if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return
  if (document.activeElement && document.activeElement.isContentEditable) return

  const items = Array.from(e.clipboardData.items)
  let handled = false
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) {
        const reader = new FileReader()
        reader.onload = ev => addPhoto(ev.target.result, file.name || 'clipboard')
        reader.readAsDataURL(file)
        handled = true
      }
    } else if (item.kind === 'string' && item.type === 'text/plain') {
      item.getAsString(text => {
        const url = text.trim()
        if (/^https?:\/\/.+\.(jpe?g|png|gif|webp|bmp|avif)(\?.*)?$/i.test(url)) {
          loadImageFromUrl(url)
        }
      })
      handled = true
    }
  }
  if (handled) e.preventDefault()
})

function loadImageFromUrl(url) {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => {
    const c = document.createElement('canvas')
    c.width = img.naturalWidth; c.height = img.naturalHeight
    c.getContext('2d').drawImage(img, 0, 0)
    try {
      addPhoto(c.toDataURL('image/png'), 'url-image')
    } catch {
      addPhoto(url, 'url-image')
    }
  }
  img.onerror = () => showToast('Impossible de charger l\'image')
  img.src = url
}
