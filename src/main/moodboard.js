const { ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const { shell } = require('electron')

function safeOpenExternal(url) {
  try {
    const u = new URL(String(url))
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    shell.openExternal(u.toString())
    return true
  } catch { return false }
}

function registerMoodboardIPC(getMainWindow, getApp) {
  function mbProjectsDir() {
    const dir = path.join(getApp().getPath('userData'), 'moodboard-projects')
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    return dir
  }
  function mbSafeName(name) {
    return String(name || '').replace(/[^a-zA-Z0-9-_ ]/g, '').trim().slice(0, 80) || 'projet'
  }
  function mbSafeFile(file) {
    const f = String(file || '')
    if (f !== path.basename(f) || !f.endsWith('.json') || f.includes('..')) {
      throw new Error('Invalid moodboard project file')
    }
    return f
  }

  ipcMain.handle('mb:get-preload-path', () => path.join(__dirname, '..', '..', 'moodboard-preload.js'))

  ipcMain.handle('mb:pick-images', async () => {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'avif'] }],
    })
    if (result.canceled) return []
    return result.filePaths.map(fp => ({ path: fp, name: path.basename(fp), dataUrl: 'file://' + fp }))
  })

  const MB_IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'avif'])
  const os = require('os')
  ipcMain.handle('mb:read-file-as-dataurl', async (_, filePath) => {
    const ext = path.extname(String(filePath || '')).toLowerCase().slice(1)
    if (!MB_IMAGE_EXTS.has(ext)) throw new Error('Unsupported file type')
    const resolved = path.resolve(String(filePath))
    const mbBase = mbProjectsDir()
    const homeDir = os.homedir()
    if (!resolved.startsWith(mbBase) && !resolved.startsWith(homeDir)) {
      throw new Error('Path outside allowed directories')
    }
    const buf = await fs.promises.readFile(resolved)
    const mime = ext === 'png' ? 'image/png'
      : ext === 'gif' ? 'image/gif'
      : ext === 'webp' ? 'image/webp'
      : ext === 'bmp' ? 'image/bmp'
      : ext === 'tiff' ? 'image/tiff'
      : ext === 'avif' ? 'image/avif'
      : 'image/jpeg'
    return `data:${mime};base64,${buf.toString('base64')}`
  })

  ipcMain.handle('mb:open-external', async (_, url) => safeOpenExternal(url))
  ipcMain.handle('mb:set-always-on-top', async (_, flag) => { const w = getMainWindow(); if (w) w.setAlwaysOnTop(flag, 'floating'); return flag })
  ipcMain.handle('mb:set-window-opacity', async (_, opacity) => { const w = getMainWindow(); if (w) w.setOpacity(opacity); return opacity })

  ipcMain.handle('mb:list-projects', async () => {
    const dir = mbProjectsDir()
    const files = (await fs.promises.readdir(dir)).filter(f => f.endsWith('.json'))
    const results = []
    for (const f of files) {
      const fp = path.join(dir, f)
      try {
        const data = JSON.parse(await fs.promises.readFile(fp, 'utf8'))
        const stat = await fs.promises.stat(fp)
        results.push({ file: f, name: data.name || f.replace(/\.json$/, ''), description: data.description || '', color: data.color || '#888888', updatedAt: stat.mtimeMs, photoCount: (data.photos || []).length })
      } catch { /* skip corrupt files */ }
    }
    return results.sort((a, b) => b.updatedAt - a.updatedAt)
  })

  ipcMain.handle('mb:create-project', async (_, name) => {
    const dir = mbProjectsDir()
    const base = mbSafeName(name)
    let file = base + '.json', i = 1
    while (fs.existsSync(path.join(dir, file))) { file = `${base}-${i++}.json` }
    const data = { name: base, createdAt: Date.now(), photos: [] }
    await fs.promises.writeFile(path.join(dir, file), JSON.stringify(data))
    return { file, name: base }
  })

  ipcMain.handle('mb:load-project', async (_, file) => {
    const fp = path.join(mbProjectsDir(), mbSafeFile(file))
    if (!fs.existsSync(fp)) return null
    return JSON.parse(await fs.promises.readFile(fp, 'utf8'))
  })

  ipcMain.handle('mb:save-project', async (_, file, data) => {
    await fs.promises.writeFile(path.join(mbProjectsDir(), mbSafeFile(file)), JSON.stringify(data))
    return true
  })

  ipcMain.handle('mb:delete-project', async (_, file) => {
    const fp = path.join(mbProjectsDir(), mbSafeFile(file))
    if (fs.existsSync(fp)) fs.unlinkSync(fp)
    return true
  })

  ipcMain.handle('mb:rename-project', async (_, file, newName) => {
    const fp = path.join(mbProjectsDir(), mbSafeFile(file))
    if (!fs.existsSync(fp)) return false
    const data = JSON.parse(await fs.promises.readFile(fp, 'utf8'))
    data.name = mbSafeName(newName)
    await fs.promises.writeFile(fp, JSON.stringify(data))
    return true
  })

  ipcMain.handle('mb:duplicate-project', async (_, file) => {
    const dir = mbProjectsDir()
    const fp = path.join(dir, mbSafeFile(file))
    if (!fs.existsSync(fp)) return null
    const data = JSON.parse(await fs.promises.readFile(fp, 'utf8'))
    const base = mbSafeName((data.name || 'projet') + ' copie')
    let newFile = base + '.json', i = 1
    while (fs.existsSync(path.join(dir, newFile))) { newFile = `${base}-${i++}.json` }
    data.name = base
    data.createdAt = Date.now()
    await fs.promises.writeFile(path.join(dir, newFile), JSON.stringify(data))
    return { file: newFile, name: base }
  })

  ipcMain.handle('mb:save-png', async (_, defaultName, dataUrl) => {
    const result = await dialog.showSaveDialog(getMainWindow(), {
      title: 'Exporter en PNG',
      defaultPath: (defaultName || 'moodboard') + '.png',
      filters: [{ name: 'Image PNG', extensions: ['png'] }],
    })
    if (result.canceled || !result.filePath) return false
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')
    await fs.promises.writeFile(result.filePath, Buffer.from(base64, 'base64'))
    return result.filePath
  })

  ipcMain.handle('mb:save-pdf', async (_, defaultName, jpegDataUrl, w, h) => {
    const result = await dialog.showSaveDialog(getMainWindow(), {
      title: 'Exporter en PDF',
      defaultPath: (defaultName || 'moodboard') + '.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (result.canceled || !result.filePath) return false
    const jpeg = Buffer.from(jpegDataUrl.replace(/^data:image\/jpeg;base64,/, ''), 'base64')
    const sw = Math.max(1, Math.min(20000, Number(w) || 1))
    const sh = Math.max(1, Math.min(20000, Number(h) || 1))
    const pageW = Math.min(800, sw)
    const pageH = (sh / sw) * pageW
    const chunks = []; let offset = 0; const offsets = []
    const push = (s) => { const b = typeof s === 'string' ? Buffer.from(s, 'binary') : s; chunks.push(b); offset += b.length }
    push('%PDF-1.4\n%\xff\xff\xff\xff\n')
    offsets[1] = offset; push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
    offsets[2] = offset; push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n')
    offsets[3] = offset
    push(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`)
    offsets[4] = offset
    push(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${sw} /Height ${sh} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`)
    push(jpeg)
    push('\nendstream\nendobj\n')
    offsets[5] = offset
    const content = `q ${pageW} 0 0 ${pageH} 0 0 cm /Im0 Do Q`
    push(`5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`)
    const xrefOffset = offset
    let xref = 'xref\n0 6\n0000000000 65535 f \n'
    for (let i = 1; i <= 5; i++) xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n'
    push(xref)
    push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`)
    await fs.promises.writeFile(result.filePath, Buffer.concat(chunks))
    return result.filePath
  })
}

module.exports = { registerMoodboardIPC }
