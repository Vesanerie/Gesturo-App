import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const ROOT = path.resolve(__dirname, '..')
const preloadSrc = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8')
const shimSrc = fs.readFileSync(path.join(ROOT, 'mobile', 'mobile-shim.js'), 'utf8')

// Extract keys from contextBridge.exposeInMainWorld('electronAPI', { ... })
function extractPreloadKeys(src) {
  const objMatch = src.match(/exposeInMainWorld\s*\(\s*'electronAPI'\s*,\s*\{([\s\S]+)\}\s*\)/)
  if (!objMatch) return []
  const body = objMatch[1]
  const keyRe = /^\s+(\w+)\s*:/gm
  const keys = new Set()
  let m
  while ((m = keyRe.exec(body)) !== null) {
    keys.add(m[1])
  }
  return [...keys].sort()
}

// Extract keys from window.electronAPI = { ... } in the shim
function extractShimKeys(src) {
  const start = src.indexOf('window.electronAPI = {')
  if (start === -1) return []
  const sub = src.slice(start)
  // Match property keys — both "key:" and shorthand "key," or "key\n"
  // Properties in this object are indented with 4 spaces
  const keyRe = /^\s{4}(\w+)\s*[,:]/gm
  const keys = new Set()
  let m
  while ((m = keyRe.exec(sub)) !== null) {
    keys.add(m[1])
  }
  return [...keys].sort()
}

describe('preload / mobile-shim parity', () => {
  const preloadKeys = extractPreloadKeys(preloadSrc)
  const shimKeys = extractShimKeys(shimSrc)

  it('preload exposes at least 1 key (sanity)', () => {
    expect(preloadKeys.length).toBeGreaterThan(0)
  })

  it('shim exposes at least 1 key (sanity)', () => {
    expect(shimKeys.length).toBeGreaterThan(0)
  })

  for (const key of preloadKeys) {
    it(`shim implements preload method: ${key}`, () => {
      expect(shimKeys).toContain(key)
    })
  }
})
