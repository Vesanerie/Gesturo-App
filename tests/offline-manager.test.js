import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'

// Mock Capacitor Filesystem
function createMockFS() {
  const files = {}
  return {
    _files: files,
    readFile: vi.fn(async ({ path: p }) => {
      if (!(p in files)) throw new Error('File not found: ' + p)
      return { data: files[p] }
    }),
    writeFile: vi.fn(async ({ path: p, data }) => {
      files[p] = data
    }),
    mkdir: vi.fn(async () => {}),
    rmdir: vi.fn(async ({ path: p }) => {
      for (const key of Object.keys(files)) {
        if (key.startsWith(p)) delete files[key]
      }
    }),
    getUri: vi.fn(async ({ path: p }) => ({ uri: 'file:///data/' + p })),
  }
}

function buildEnv() {
  const mockFS = createMockFS()
  // Setup globals that the IIFE reads
  globalThis.window = {
    Capacitor: {
      Plugins: { Filesystem: mockFS },
      convertFileSrc: (uri) => uri,
      getPlatform: () => 'web',
    },
    __offlinePacks: null,
  }
  // The IIFE checks `typeof window` and `window.Capacitor`
  // then sets window.__offlinePacks. We eval the source.
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'mobile', 'offline-manager.js'), 'utf8')
  // Remove the IIFE wrapper's window guard and Capacitor polling,
  // just run the inner init() directly
  const fn = new Function(src)
  fn()

  return { packs: globalThis.window.__offlinePacks, mockFS }
}

describe('offline-manager', () => {
  let packs, mockFS

  beforeEach(async () => {
    const env = buildEnv()
    packs = env.packs
    mockFS = env.mockFS
    // Wait for async init
    if (packs?.whenReady) await packs.whenReady
  })

  afterEach(() => {
    delete globalThis.window
  })

  describe('download()', () => {
    it('returns null if a download is already active for the same catKey', () => {
      const first = packs.download('animals', ['https://r2.example.com/a.jpg'])
      expect(first).not.toBeNull()
      const second = packs.download('animals', ['https://r2.example.com/b.jpg'])
      expect(second).toBeNull()
    })

    it('allows download for a different catKey', () => {
      const first = packs.download('animals', ['https://r2.example.com/a.jpg'])
      expect(first).not.toBeNull()
      const second = packs.download('hands', ['https://r2.example.com/b.jpg'])
      expect(second).not.toBeNull()
    })
  })

  describe('deletePack()', () => {
    it('calls cancel on active download before deleting', async () => {
      let cancelCalled = false
      packs.download('animals', ['https://r2.example.com/a.jpg'])
      const activeDl = packs.activeDownloads.get('animals')
      const origCancel = activeDl.cancel
      activeDl.cancel = () => { cancelCalled = true; origCancel() }

      await packs.delete('animals')
      expect(cancelCalled).toBe(true)
      expect(packs.activeDownloads.has('animals')).toBe(false)
    })
  })

  describe('saveCatalogCache()', () => {
    it('parallel calls do not lose data', async () => {
      const p1 = packs.saveCatalogCache([{ id: 'photo1' }], null)
      const p2 = packs.saveCatalogCache(null, [{ id: 'anim1' }])
      await Promise.all([p1, p2])

      const cache = await packs.loadCatalogCache()
      expect(cache.photos).toEqual([{ id: 'photo1' }])
      expect(cache.anims).toEqual([{ id: 'anim1' }])
    })
  })
})
