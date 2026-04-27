import { describe, it, expect, beforeAll } from 'vitest'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

const ROOT = path.resolve(__dirname, '..')
const WWW = path.join(ROOT, 'www')

// Run sync-web once before all tests
beforeAll(() => {
  execSync('node scripts/sync-web.js', { cwd: ROOT, stdio: 'pipe' })
})

describe('sync-web build integrity', () => {
  it('www/index.html contains supabase-config.js script', () => {
    const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8')
    expect(html).toContain('supabase-config.js')
  })

  it('www/index.html contains auth-mobile.js script', () => {
    const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8')
    expect(html).toContain('auth-mobile.js')
  })

  it('www/index.html contains mobile-shim.js script', () => {
    const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8')
    expect(html).toContain('mobile-shim.js')
  })

  it('www/index.html contains offline-manager.js script', () => {
    const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8')
    expect(html).toContain('offline-manager.js')
  })

  it('www/assets/icon.png exists', () => {
    expect(fs.existsSync(path.join(WWW, 'assets', 'icon.png'))).toBe(true)
  })

  it('www/src/app.js exists', () => {
    expect(fs.existsSync(path.join(WWW, 'src', 'app.js'))).toBe(true)
  })

  it('www/styles/base.css exists', () => {
    expect(fs.existsSync(path.join(WWW, 'styles', 'base.css'))).toBe(true)
  })
})
