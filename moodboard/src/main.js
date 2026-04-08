// Global keyboard shortcut dispatch, top-level listeners, and bootstrap.
// Loaded last so all functions referenced here exist.

document.addEventListener('keydown', e => {
  const inInput = document.activeElement && (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) || document.activeElement.isContentEditable)
  const modalOpen = document.getElementById('modal-overlay').classList.contains('visible')
  const renameOpen = document.getElementById('rename-overlay').style.display === 'flex'
  const shortcutsOpen = document.getElementById('shortcuts-overlay').style.display === 'flex'

  if (modalOpen) {
    if (e.key === 'Escape') { e.preventDefault(); closeProjectModal(); return }
    if (e.key === 'Enter' && e.target.id !== 'inp-desc') { e.preventDefault(); submitProjectModal(); return }
    return
  }
  if (renameOpen) {
    if (e.key === 'Escape') { e.preventDefault(); hideRename(); return }
    if (e.key === 'Enter') { e.preventDefault(); submitRename(); return }
    return
  }
  if (shortcutsOpen) {
    if (e.key === 'Escape') { e.preventDefault(); hideShortcuts(); return }
    return
  }

  // Search overlay (Cmd+F)
  if ((e.metaKey || e.ctrlKey) && e.key === 'f' && !e.shiftKey) {
    e.preventDefault(); openSearch(); return
  }
  if (searchOpen && e.key === 'Escape') { e.preventDefault(); closeSearch(); return }
  if (searchOpen && document.activeElement && document.activeElement.id === 'search-input') return

  // Undo / Redo
  if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault()
    if (e.shiftKey) redo(); else undo()
    return
  }
  if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || e.key === 'Y')) {
    e.preventDefault(); redo(); return
  }

  if (inInput) return

  // Copy / Duplicate / Select all
  if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
    clipboardItems = multiSelected.length ? [...multiSelected] : (selected ? [selected] : [])
    if (clipboardItems.length) showToast(`${clipboardItems.length} copié${clipboardItems.length > 1 ? 's' : ''}`)
    return
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
    e.preventDefault()
    const list = multiSelected.length ? multiSelected : (selected ? [selected] : [])
    list.forEach(p => duplicatePhoto(p.id))
    return
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
    e.preventDefault()
    deselectAll()
    multiSelected = [...photos]
    multiSelected.forEach(p => {
      const el = document.getElementById('photo-' + p.id)
      if (el) el.classList.add('selected')
    })
    updateAlignToolbar()
    return
  }

  if (e.key === ' ' && !spaceHeld) {
    e.preventDefault()
    spaceHeld = true
    wrap.classList.add('pan-mode')
    return
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (multiSelected.length > 1) [...multiSelected].forEach(p => deletePhoto(p.id))
    else if (selected) deletePhoto(selected.id)
  }
  if (e.key === 'Escape') {
    deselectAll()
    if (panTool) togglePanTool()
    if (document.body.classList.contains('presenting')) togglePresentation()
  }
  if (e.key === ']') {
    const list = multiSelected.length ? multiSelected : (selected ? [selected] : [])
    if (list.length) { list.forEach(p => { if (e.shiftKey) bringToTop(p); else bringForward(p.id) }); snapshot(); scheduleSave() }
  }
  if (e.key === '[') {
    const list = multiSelected.length ? multiSelected : (selected ? [selected] : [])
    if (list.length) {
      if (e.shiftKey) {
        const minZ = Math.min(...photos.map(p => p.zIndex || 0))
        list.forEach(p => { p.zIndex = minZ - 1; updatePhotoEl(p) })
      } else list.forEach(p => sendBackward(p.id))
      snapshot(); scheduleSave()
    }
  }
  if (e.key === 't' || e.key === 'T') { addTextItem() }
  if (e.key === 'n' || e.key === 'N') { addNoteItem() }
  if (e.key === 'g' || e.key === 'G') { autoGridLayout() }
  if (e.key === 'p' || e.key === 'P') { togglePresentation() }
  if (e.key === '?') { showShortcuts() }
})

document.addEventListener('keyup', e => {
  if (e.key === ' ') {
    spaceHeld = false
    if (!panTool) wrap.classList.remove('pan-mode')
  }
})

// Dismiss the project context menu when clicking outside
document.addEventListener('mousedown', (e) => {
  const m = document.getElementById('ctx-menu')
  if (m.classList.contains('visible') && !m.contains(e.target)) hideContextMenu()
})

// Capture-phase mouseup: clears snap guides and triggers
// save/snapshot/minimap update after every drag/resize/rotate.
document.addEventListener('mouseup', () => {
  clearSnapGuides()
  scheduleSave()
  snapshot()
  updateMinimap()
}, true)

// Bootstrap
loadTheme()
applyView()
refreshProjectList()
document.getElementById('empty-state').style.display = 'none'
initTrashZone()
maybeShowOnboarding()
