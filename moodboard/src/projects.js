// Project picker (list, search, ctx menu, rename), create/edit modal,
// open/back/save lifecycle.

async function refreshProjectList() {
  allProjectsCache = await window.electronAPI.listProjects()
  renderProjectList(allProjectsCache)
}

function filterProjects(query) {
  const q = query.trim().toLowerCase()
  if (!q) { renderProjectList(allProjectsCache); return }
  renderProjectList(allProjectsCache.filter(p =>
    (p.name || '').toLowerCase().includes(q) ||
    (p.description || '').toLowerCase().includes(q)
  ))
}

function renderProjectList(list) {
  const grid = document.getElementById('pp-grid')
  grid.innerHTML = ''
  const newCard = document.createElement('div')
  newCard.className = 'pp-card new'
  newCard.innerHTML = '<div style="font-size:28px;margin-bottom:4px">+</div><div>Nouveau projet</div>'
  newCard.onclick = createNewProject
  grid.appendChild(newCard)
  list.forEach(p => {
    const card = document.createElement('div')
    card.className = 'pp-card'
    const date = new Date(p.updatedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
    card.innerHTML = `
      <button class="pp-del" title="Supprimer">✕</button>
      <div class="pp-dot" style="background:${p.color || '#888'}"></div>
      <div class="pp-name"></div>
      <div class="pp-desc" style="font-size:11px;color:#666;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></div>
      <div class="pp-meta">${p.photoCount} photo${p.photoCount > 1 ? 's' : ''} · ${date}</div>
    `
    card.querySelector('.pp-name').textContent = p.name
    card.querySelector('.pp-desc').textContent = p.description || ''
    card.onclick = (e) => {
      if (e.target.classList.contains('pp-del')) return
      openProject(p)
    }
    card.ondblclick = (e) => {
      e.stopPropagation()
      openRename(p)
    }
    card.oncontextmenu = (e) => {
      e.preventDefault(); e.stopPropagation()
      showProjectContextMenu(e.clientX, e.clientY, p)
    }
    card.querySelector('.pp-del').onclick = async (e) => {
      e.stopPropagation()
      if (!confirm(`Supprimer "${p.name}" ?`)) return
      await window.electronAPI.deleteProject(p.file)
      refreshProjectList()
    }
    grid.appendChild(card)
  })
}

function showProjectContextMenu(x, y, p) {
  const menu = document.getElementById('ctx-menu')
  menu.innerHTML = `
    <div class="ctx-item" data-act="open">Ouvrir</div>
    <div class="ctx-item" data-act="rename">Renommer…</div>
    <div class="ctx-item" data-act="dup">Dupliquer</div>
    <div class="ctx-sep"></div>
    <div class="ctx-item danger" data-act="del">Supprimer</div>
  `
  menu.style.left = x + 'px'
  menu.style.top = y + 'px'
  menu.classList.add('visible')
  menu.querySelectorAll('.ctx-item').forEach(it => {
    it.onclick = async () => {
      hideContextMenu()
      const act = it.dataset.act
      if (act === 'open') openProject(p)
      else if (act === 'rename') openRename(p)
      else if (act === 'dup') {
        await window.electronAPI.duplicateProject(p.file)
        refreshProjectList()
        showToast('Projet dupliqué')
      }
      else if (act === 'del') {
        if (confirm(`Supprimer "${p.name}" ?`)) {
          await window.electronAPI.deleteProject(p.file)
          refreshProjectList()
        }
      }
    }
  })
}

function hideContextMenu() {
  document.getElementById('ctx-menu').classList.remove('visible')
}

function openRename(p) {
  renameTargetFile = p.file
  document.getElementById('inp-rename').value = p.name
  document.getElementById('rename-overlay').style.display = 'flex'
  setTimeout(() => { const i = document.getElementById('inp-rename'); i.focus(); i.select() }, 50)
}

function hideRename() {
  document.getElementById('rename-overlay').style.display = 'none'
  renameTargetFile = null
}

async function submitRename() {
  const name = document.getElementById('inp-rename').value.trim()
  if (!name || !renameTargetFile) { hideRename(); return }
  await window.electronAPI.renameProject(renameTargetFile, name)
  hideRename()
  refreshProjectList()
  showToast('Projet renommé')
}

// ─── Create / Edit project modal ───────────────────────────

function buildColorSwatches() {
  const row = document.getElementById('color-row')
  row.innerHTML = ''
  PROJECT_COLORS.forEach(c => {
    const sw = document.createElement('div')
    sw.className = 'color-swatch' + (c === modalSelectedColor ? ' selected' : '')
    sw.style.background = c
    sw.onclick = () => {
      modalSelectedColor = c
      row.querySelectorAll('.color-swatch').forEach(el => el.classList.remove('selected'))
      sw.classList.add('selected')
    }
    row.appendChild(sw)
  })
}

function openProjectModal() {
  modalSelectedColor = PROJECT_COLORS[0]
  buildColorSwatches()
  document.getElementById('inp-name').value = ''
  document.getElementById('inp-desc').value = ''
  document.getElementById('field-name').classList.remove('invalid')
  document.querySelector('#modal-overlay .modal-head h3').textContent = 'Nouveau projet'
  document.querySelector('#modal-overlay .modal-head p').textContent = 'Crées un nouveau moodboard vide'
  document.getElementById('btn-create').textContent = 'Créer'
  document.getElementById('btn-create').dataset.mode = 'create'
  document.getElementById('modal-overlay').classList.add('visible')
  setTimeout(() => document.getElementById('inp-name').focus(), 50)
}

function closeProjectModal() {
  document.getElementById('modal-overlay').classList.remove('visible')
}

async function submitProjectModal() {
  const name = document.getElementById('inp-name').value.trim()
  const desc = document.getElementById('inp-desc').value.trim()
  const field = document.getElementById('field-name')
  if (!name) {
    field.classList.add('invalid')
    document.getElementById('inp-name').focus()
    return
  }
  field.classList.remove('invalid')
  const btn = document.getElementById('btn-create')
  const mode = btn.dataset.mode || 'create'
  btn.disabled = true
  try {
    if (!window.electronAPI || !window.electronAPI.createProject) {
      alert('API Electron non disponible. Redémarre l\'app (npm start) pour charger les nouveaux handlers du main process.')
      return
    }
    if (mode === 'edit' && currentProject) {
      currentProject.name = name
      currentProject.description = desc
      currentProject.color = modalSelectedColor
      if (name !== currentProject.name) {
        await window.electronAPI.renameProject(currentProject.file, name)
      }
      await saveNow()
      document.getElementById('project-title').textContent = name
      document.getElementById('project-desc').textContent = desc ? '— ' + desc : ''
      closeProjectModal()
      showToast('Projet modifié')
      return
    }
    const proj = await window.electronAPI.createProject(name)
    await window.electronAPI.saveProject(proj.file, {
      name: proj.name,
      description: desc,
      color: modalSelectedColor,
      createdAt: Date.now(),
      photos: [],
    })
    closeProjectModal()
    await openProject({ file: proj.file, name: proj.name })
  } catch (err) {
    console.error('Project save failed:', err)
    alert('Erreur lors de l\'enregistrement du projet')
  } finally {
    btn.disabled = false
  }
}

function createNewProject() { openProjectModal() }

function openEditProject() {
  if (!currentProject) return
  modalSelectedColor = currentProject.color || PROJECT_COLORS[0]
  buildColorSwatches()
  document.getElementById('inp-name').value = currentProject.name
  document.getElementById('inp-desc').value = currentProject.description || ''
  document.getElementById('field-name').classList.remove('invalid')
  document.querySelector('#modal-overlay .modal-head h3').textContent = 'Modifier le projet'
  document.querySelector('#modal-overlay .modal-head p').textContent = 'Change le nom, la description ou la couleur'
  document.getElementById('btn-create').textContent = 'Enregistrer'
  document.getElementById('btn-create').dataset.mode = 'edit'
  document.getElementById('modal-overlay').classList.add('visible')
  setTimeout(() => document.getElementById('inp-name').focus(), 50)
}

// ─── Project session lifecycle ─────────────────────────────

async function openProject(p) {
  const data = await window.electronAPI.loadProject(p.file)
  if (!data) return
  currentProject = {
    file: p.file,
    name: data.name || p.name,
    description: data.description || '',
    color: data.color || '#888888',
    createdAt: data.createdAt || Date.now(),
  }
  document.getElementById('project-title').textContent = currentProject.name
  document.getElementById('project-desc').textContent = currentProject.description ? '— ' + currentProject.description : ''
  photos.forEach(ph => { const el = document.getElementById('photo-' + ph.id); if (el) el.remove() })
  photos = (data.photos || []).map(ph => ({ ...ph }))
  idCounter = photos.reduce((m, ph) => Math.max(m, ph.id || 0), 0)
  groups = (data.groups || []).map(g => ({ ...g }))
  guides = []
  photos.forEach(createPhotoEl)
  const gl = document.getElementById('guides-layer'); if (gl) gl.innerHTML = ''
  updateCount()
  document.getElementById('empty-state').style.display = photos.length === 0 ? 'block' : 'none'
  document.getElementById('project-picker').style.display = 'none'
  if (data.view) {
    zoom = data.view.zoom || 1
    panX = data.view.panX || 0
    panY = data.view.panY || 0
    applyView()
  } else {
    resetZoom()
  }
  history = []; historyIndex = -1
  snapshot()
  updateMinimap()
}

function backToProjects() {
  if (saveTimer) { clearTimeout(saveTimer); saveNow() }
  currentProject = null
  deselectAll()
  document.getElementById('project-picker').style.display = 'flex'
  refreshProjectList()
}

function scheduleSave() {
  if (!currentProject) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(saveNow, 500)
}

async function saveNow() {
  if (!currentProject) return
  saveTimer = null
  await window.electronAPI.saveProject(currentProject.file, {
    name: currentProject.name,
    description: currentProject.description || '',
    color: currentProject.color || '#888888',
    createdAt: currentProject.createdAt,
    photos,
    groups,
    guides: [],
    view: { zoom, panX, panY },
    updatedAt: Date.now(),
  })
}
