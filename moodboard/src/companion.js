// Toast, shortcuts panel, presentation mode, and "companion" window features
// (always-on-top, window opacity, grayscale).

function showToast(msg) {
  const t = document.getElementById('toast')
  t.textContent = msg
  t.classList.add('visible')
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => t.classList.remove('visible'), 1800)
}

function showShortcuts() { document.getElementById('shortcuts-overlay').style.display = 'flex' }
function hideShortcuts() { document.getElementById('shortcuts-overlay').style.display = 'none' }

function togglePresentation() {
  document.body.classList.toggle('presenting')
  if (document.body.classList.contains('presenting')) {
    deselectAll()
    showToast('Mode présentation — Échap pour quitter')
  }
}

async function toggleAlwaysOnTop() {
  alwaysOnTop = !alwaysOnTop
  await window.electronAPI.setAlwaysOnTop(alwaysOnTop)
  document.getElementById('btn-pin').classList.toggle('active', alwaysOnTop)
  document.getElementById('opacity-wrap').style.display = alwaysOnTop ? 'flex' : 'none'
  if (!alwaysOnTop) {
    await window.electronAPI.setWindowOpacity(1)
    document.getElementById('win-opacity').value = 100
  }
  showToast(alwaysOnTop ? 'Mode compagnon activé' : 'Mode compagnon désactivé')
}

async function setWindowOpacityVal(val) {
  await window.electronAPI.setWindowOpacity(val / 100)
}

function toggleGrayscale() {
  grayscaleMode = !grayscaleMode
  document.body.classList.toggle('grayscale', grayscaleMode)
  document.getElementById('btn-grayscale').classList.toggle('active', grayscaleMode)
  showToast(grayscaleMode ? 'Niveaux de gris' : 'Couleurs')
}
