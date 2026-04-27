// ── Offline Pack Manager ─────────────────────────────────────────────────────
// Télécharge et stocke des packs de photos pour usage hors-ligne (Pro only).
// Utilise Capacitor Filesystem (Directory.DATA) pour persister entre les updates.
// Exposé globalement via window.__offlinePacks.
//
// Storage layout:
//   DATA/offline-packs/index.json          — master index
//   DATA/offline-packs/<catKey>/manifest.json
//   DATA/offline-packs/<catKey>/img_001.jpg
;(function () {
  'use strict'
  if (typeof window === 'undefined') return
  // Wait for Capacitor
  const POLL_MS = 200
  const MAX_WAIT = 5000
  let waited = 0
  const init = () => {
    const plugins = window.Capacitor?.Plugins
    const FS = plugins?.Filesystem
    if (!FS) {
      if (waited < MAX_WAIT) { waited += POLL_MS; setTimeout(init, POLL_MS) }
      return
    }
    const Dir = { DATA: 'DATA' }
    const BASE = 'offline-packs'
    const CONCURRENCY = 3

    // In-memory state
    let index = {} // { [catKey]: { fileCount, sizeBytes, downloadedAt, files: { r2Url: localPath } } }
    const urlToLocal = new Map() // r2Url → capacitor file URI
    const activeDownloads = new Map() // catKey → { progress, total, cancel }

    // ── Filesystem helpers ──────────────────────────────────────────────
    async function readJSON(path) {
      try {
        const r = await FS.readFile({ path, directory: Dir.DATA, encoding: 'utf8' })
        return JSON.parse(r.data)
      } catch { return null }
    }
    async function writeJSON(path, obj) {
      await FS.writeFile({ path, data: JSON.stringify(obj), directory: Dir.DATA, encoding: 'utf8' })
    }
    async function ensureDir(path) {
      try { await FS.mkdir({ path, directory: Dir.DATA, recursive: true }) } catch {}
    }
    async function deleteDir(path) {
      try { await FS.rmdir({ path, directory: Dir.DATA, recursive: true }) } catch {}
    }
    async function getUri(path) {
      try {
        const r = await FS.getUri({ path, directory: Dir.DATA })
        return r.uri
      } catch { return null }
    }

    // ── Index management ────────────────────────────────────────────────
    async function loadIndex() {
      const data = await readJSON(BASE + '/index.json')
      index = data || {}
      urlToLocal.clear()
      for (const [catKey, pack] of Object.entries(index)) {
        if (pack.files) {
          for (const [r2Url, localPath] of Object.entries(pack.files)) {
            const uri = await getUri(localPath)
            if (uri) urlToLocal.set(r2Url, window.Capacitor.convertFileSrc(uri))
          }
        }
      }
    }
    async function saveIndex() {
      await ensureDir(BASE)
      await writeJSON(BASE + '/index.json', index)
    }

    // ── Download a pack ─────────────────────────────────────────────────
    function download(catKey, r2Urls) {
      let cancelled = false
      let progress = 0
      const total = r2Urls.length
      const callbacks = { progress: [], complete: [], error: [] }
      const emit = (ev, data) => callbacks[ev].forEach(fn => fn(data))

      activeDownloads.set(catKey, { progress: 0, total, cancel: () => { cancelled = true } })

      const run = async () => {
        const dirPath = BASE + '/' + catKey
        await ensureDir(dirPath)
        const files = {}
        let sizeBytes = 0

        // Process in batches of CONCURRENCY
        for (let i = 0; i < r2Urls.length; i += CONCURRENCY) {
          if (cancelled) { emit('error', 'cancelled'); activeDownloads.delete(catKey); return }
          const batch = r2Urls.slice(i, i + CONCURRENCY)
          const results = await Promise.allSettled(batch.map(async (url) => {
            if (cancelled) return
            const filename = url.split('/').pop()
            const filePath = dirPath + '/' + filename
            try {
              const resp = await fetch(url)
              if (!resp.ok) throw new Error('HTTP ' + resp.status)
              const blob = await resp.blob()
              sizeBytes += blob.size
              const base64 = await blobToBase64(blob)
              await FS.writeFile({ path: filePath, data: base64, directory: Dir.DATA })
              files[url] = filePath
              const uri = await getUri(filePath)
              if (uri) urlToLocal.set(url, window.Capacitor.convertFileSrc(uri))
            } catch (e) {
              console.warn('[offline] failed:', filename, e.message)
            }
          }))
          progress += batch.length
          const dl = activeDownloads.get(catKey)
          if (dl) dl.progress = progress
          emit('progress', { progress, total })
        }

        // Save manifest + index
        const manifest = { fileCount: Object.keys(files).length, sizeBytes, downloadedAt: new Date().toISOString(), files }
        await writeJSON(dirPath + '/manifest.json', manifest)
        index[catKey] = { fileCount: manifest.fileCount, sizeBytes, downloadedAt: manifest.downloadedAt, files }
        await saveIndex()
        activeDownloads.delete(catKey)
        emit('complete', { fileCount: manifest.fileCount, sizeBytes })
      }
      run().catch(e => { activeDownloads.delete(catKey); emit('error', e.message) })

      return {
        cancel: () => { cancelled = true },
        onProgress: (fn) => { callbacks.progress.push(fn) },
        onComplete: (fn) => { callbacks.complete.push(fn) },
        onError: (fn) => { callbacks.error.push(fn) },
      }
    }

    // ── Delete a pack ───────────────────────────────────────────────────
    async function deletePack(catKey) {
      const pack = index[catKey]
      if (pack?.files) {
        for (const r2Url of Object.keys(pack.files)) urlToLocal.delete(r2Url)
      }
      await deleteDir(BASE + '/' + catKey)
      delete index[catKey]
      await saveIndex()
    }

    // ── Helpers ─────────────────────────────────────────────────────────
    function blobToBase64(blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onloadend = () => {
          const result = reader.result
          resolve(result.split(',')[1]) // strip data:...;base64, prefix
        }
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })
    }

    function formatSize(bytes) {
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' Ko'
      return (bytes / (1024 * 1024)).toFixed(1) + ' Mo'
    }

    // ── Public API ──────────────────────────────────────────────────────
    window.__offlinePacks = {
      isDownloaded: (catKey) => !!index[catKey],
      getAll: () => {
        const result = {}
        for (const [k, v] of Object.entries(index)) {
          result[k] = { fileCount: v.fileCount, sizeBytes: v.sizeBytes, downloadedAt: v.downloadedAt }
        }
        return result
      },
      download,
      delete: deletePack,
      resolveLocal: (r2Url) => urlToLocal.get(r2Url) || null,
      totalSize: () => Object.values(index).reduce((s, p) => s + (p.sizeBytes || 0), 0),
      activeDownloads,
      formatSize,
      ready: false,
    }

    // Boot
    loadIndex().then(() => {
      window.__offlinePacks.ready = true
      console.log('[offline] ready, ' + Object.keys(index).length + ' packs cached')
    }).catch(e => console.warn('[offline] init error:', e.message))
  }
  init()
})()
