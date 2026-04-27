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

    // Serialize catalog cache writes to avoid read-modify-write race (Bug #7)
    let _catalogWriteChain = Promise.resolve()

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
    async function fileExists(path) {
      try {
        await FS.stat({ path, directory: Dir.DATA })
        return true
      } catch { return false }
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
      let baseUri = null
      try {
        const r = await FS.getUri({ path: BASE, directory: Dir.DATA })
        baseUri = r.uri
      } catch {}
      if (!baseUri) return

      // Bug #3 fix: verify files actually exist, remove stale entries
      const staleKeys = []
      for (const [catKey, pack] of Object.entries(index)) {
        if (!pack.files) { staleKeys.push(catKey); continue }
        const dirExists = await fileExists(BASE + '/' + catKey)
        if (!dirExists) { staleKeys.push(catKey); continue }
        let validCount = 0
        for (const [r2Url, localPath] of Object.entries(pack.files)) {
          const exists = await fileExists(localPath)
          if (exists) {
            const filename = localPath.split('/').pop()
            const fileUri = baseUri + '/' + catKey + '/' + encodeURIComponent(filename)
            urlToLocal.set(r2Url, window.Capacitor.convertFileSrc(fileUri))
            validCount++
          } else {
            delete pack.files[r2Url]
          }
        }
        if (validCount === 0) {
          staleKeys.push(catKey)
        } else {
          pack.fileCount = validCount
        }
      }
      if (staleKeys.length > 0) {
        for (const k of staleKeys) {
          await deleteDir(BASE + '/' + k)
          delete index[k]
        }
        await saveIndex()
        console.log('[offline] cleaned ' + staleKeys.length + ' stale packs')
      }
    }
    async function saveIndex() {
      await ensureDir(BASE)
      await writeJSON(BASE + '/index.json', index)
    }

    // ── R2 catalog cache (for offline boot) ─────────────────────────────
    // Bug #7 fix: serialize writes to avoid read-modify-write race
    async function saveCatalogCache(photos, anims) {
      _catalogWriteChain = _catalogWriteChain.then(async () => {
        try {
          await ensureDir(BASE)
          const existing = await readJSON(BASE + '/catalog-cache.json') || {}
          if (photos) existing.photos = photos
          if (anims) existing.anims = anims
          existing.savedAt = new Date().toISOString()
          await writeJSON(BASE + '/catalog-cache.json', existing)
        } catch (e) { console.warn('[offline] saveCatalogCache error:', e.message) }
      })
      return _catalogWriteChain
    }
    async function loadCatalogCache() {
      return await readJSON(BASE + '/catalog-cache.json')
    }

    // ── Download a pack ─────────────────────────────────────────────────
    function download(catKey, r2Urls) {
      // Bug #1 fix: prevent double download of same pack
      if (activeDownloads.has(catKey)) {
        console.warn('[offline] download already in progress for', catKey)
        return null
      }

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
        let successCount = 0

        for (let i = 0; i < r2Urls.length; i += CONCURRENCY) {
          if (cancelled) { emit('error', 'cancelled'); activeDownloads.delete(catKey); return }
          const batch = r2Urls.slice(i, i + CONCURRENCY)
          await Promise.allSettled(batch.map(async (url) => {
            if (cancelled) return
            const filename = url.split('/').pop()
            const filePath = dirPath + '/' + filename
            try {
              const resp = await fetch(url)
              if (!resp.ok) throw new Error('HTTP ' + resp.status)
              const blob = await resp.blob()
              const base64 = await blobToBase64(blob)
              await FS.writeFile({ path: filePath, data: base64, directory: Dir.DATA })
              // Bug #13 fix: only count size after successful write
              sizeBytes += blob.size
              files[url] = filePath
              successCount++
              const uri = await getUri(filePath)
              if (uri) urlToLocal.set(url, window.Capacitor.convertFileSrc(uri))
            } catch (e) {
              console.warn('[offline] failed:', filename, e.message)
            }
          }))
          // Bug #2 fix: progress reflects actual successes
          progress = successCount
          const dl = activeDownloads.get(catKey)
          if (dl) dl.progress = progress
          emit('progress', { progress: successCount, total })
        }

        // Save manifest + index
        if (successCount > 0) {
          const manifest = { fileCount: successCount, sizeBytes, downloadedAt: new Date().toISOString(), files }
          await writeJSON(dirPath + '/manifest.json', manifest)
          index[catKey] = { fileCount: successCount, sizeBytes, downloadedAt: manifest.downloadedAt, files }
          await saveIndex()
        }
        activeDownloads.delete(catKey)
        emit('complete', { fileCount: successCount, sizeBytes })
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
      // Bug #21 fix: cancel active download before deleting
      const active = activeDownloads.get(catKey)
      if (active) {
        active.cancel()
        activeDownloads.delete(catKey)
      }
      const pack = index[catKey]
      if (pack?.files) {
        for (const r2Url of Object.keys(pack.files)) urlToLocal.delete(r2Url)
      }
      await deleteDir(BASE + '/' + catKey)
      delete index[catKey]
      await saveIndex()
    }

    // ── Cleanup orphaned directories (Bug #4) ──────────────────────────
    async function cleanupOrphans() {
      try {
        const result = await FS.readdir({ path: BASE, directory: Dir.DATA })
        for (const entry of result.files) {
          if (entry.type === 'directory' && !index[entry.name]) {
            console.log('[offline] removing orphan:', entry.name)
            await deleteDir(BASE + '/' + entry.name)
          }
        }
      } catch {}
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
    let _readyResolve
    const _readyPromise = new Promise(r => { _readyResolve = r })

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
      saveCatalogCache,
      loadCatalogCache,
      whenReady: _readyPromise,
      ready: false,
    }

    // Boot
    loadIndex().then(() => {
      return cleanupOrphans()
    }).then(() => {
      window.__offlinePacks.ready = true
      _readyResolve()
      console.log('[offline] ready, ' + Object.keys(index).length + ' packs cached')
    }).catch(e => { _readyResolve(); console.warn('[offline] init error:', e.message) })
  }
  init()
})()
