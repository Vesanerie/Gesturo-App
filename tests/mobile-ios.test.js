import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const ROOT = path.resolve(__dirname, '..')
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')

// Collect all CSS
const stylesDir = path.join(ROOT, 'styles')
function readCssRecursive(dir) {
  let css = ''
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) css += readCssRecursive(full)
    else if (entry.name.endsWith('.css')) css += fs.readFileSync(full, 'utf8') + '\n'
  }
  return css
}
const allCss = readCssRecursive(stylesDir)

// Collect all JS
const srcDir = path.join(ROOT, 'src')
const allJs = fs.readdirSync(srcDir)
  .filter(f => f.endsWith('.js'))
  .map(f => fs.readFileSync(path.join(srcDir, f), 'utf8'))
  .join('\n')

const mobileDir = path.join(ROOT, 'mobile')
const mobileJs = fs.readdirSync(mobileDir)
  .filter(f => f.endsWith('.js'))
  .map(f => fs.readFileSync(path.join(mobileDir, f), 'utf8'))
  .join('\n')

// ── HTML meta tags ──

describe('iOS meta tags', () => {
  it('has viewport with viewport-fit=cover', () => {
    expect(html).toMatch(/viewport-fit=cover/)
  })

  it('has apple-mobile-web-app-capable', () => {
    expect(html).toMatch(/apple-mobile-web-app-capable.*yes/)
  })

  it('has apple-mobile-web-app-status-bar-style', () => {
    expect(html).toMatch(/apple-mobile-web-app-status-bar-style/)
  })

  it('has theme-color meta', () => {
    expect(html).toMatch(/name="theme-color"/)
  })

  it('disables user-scalable', () => {
    expect(html).toMatch(/user-scalable=no/)
  })
})

// ── Capacitor config ──

describe('Capacitor iOS config', () => {
  const capConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'capacitor.config.json'), 'utf8'))

  it('iosScheme is https', () => {
    expect(capConfig.server.iosScheme).toBe('https')
  })

  it('webDir is www', () => {
    expect(capConfig.webDir).toBe('www')
  })

  it('has StatusBar plugin config', () => {
    expect(capConfig.plugins.StatusBar).toBeDefined()
  })

  it('has SplashScreen plugin config', () => {
    expect(capConfig.plugins.SplashScreen).toBeDefined()
  })

  it('has Keyboard plugin config', () => {
    expect(capConfig.plugins.Keyboard).toBeDefined()
  })
})

// ── Safe area insets ──

describe('safe-area-inset usage', () => {
  it('CSS uses safe-area-inset-top', () => {
    expect(allCss).toMatch(/safe-area-inset-top/)
  })

  it('CSS uses safe-area-inset-bottom', () => {
    expect(allCss).toMatch(/safe-area-inset-bottom/)
  })

  it('safe-area-insets have fallback values', () => {
    // env(safe-area-inset-*, 0px) pattern
    const insets = allCss.match(/env\(safe-area-inset-\w+/g) || []
    const withFallback = allCss.match(/env\(safe-area-inset-\w+\s*,\s*\d+px\)/g) || []
    expect(insets.length).toBeGreaterThan(0)
    expect(withFallback.length).toBe(insets.length)
  })
})

// ── Touch targets ──

describe('mobile touch targets', () => {
  it('bottom-tab-bar has safe-area padding in CSS', () => {
    expect(allCss).toMatch(/bottom-tab-bar[\s\S]*?safe-area-inset-bottom/)
  })

  it('no hover-only interactions (all hover has equivalent click)', () => {
    // Check that onmouseover/onmouseout are not in HTML
    expect(html).not.toMatch(/\bonmouseover=/)
    expect(html).not.toMatch(/\bonmouseout=/)
  })
})

// ── Responsive breakpoints ──

describe('responsive breakpoints', () => {
  it('has phone breakpoint (max-width: 767px)', () => {
    expect(allCss).toMatch(/max-width:\s*767px/)
  })

  it('has tablet breakpoint (768px-1399px)', () => {
    expect(allCss).toMatch(/min-width:\s*768px/)
  })

  it('has desktop breakpoint (min-width: 1400px)', () => {
    expect(allCss).toMatch(/min-width:\s*1400px/)
  })
})

// ── Mobile-specific files ──

describe('mobile build files', () => {
  it('mobile-shim.js exists', () => {
    expect(fs.existsSync(path.join(mobileDir, 'mobile-shim.js'))).toBe(true)
  })

  it('auth-mobile.js exists', () => {
    expect(fs.existsSync(path.join(mobileDir, 'auth-mobile.js'))).toBe(true)
  })

  it('offline-manager.js exists', () => {
    expect(fs.existsSync(path.join(mobileDir, 'offline-manager.js'))).toBe(true)
  })
})

// ── CSP for mobile ──

describe('CSP compatibility', () => {
  it('script-src does not have unsafe-inline', () => {
    const cspMatch = html.match(/script-src\s+([^;]+)/)
    expect(cspMatch).toBeTruthy()
    expect(cspMatch[1]).not.toContain('unsafe-inline')
  })

  it('connect-src allows https: and wss:', () => {
    const cspMatch = html.match(/connect-src\s+([^;]+)/)
    expect(cspMatch).toBeTruthy()
    expect(cspMatch[1]).toContain('https:')
    expect(cspMatch[1]).toContain('wss:')
  })

  it('img-src allows https: and blob:', () => {
    const cspMatch = html.match(/img-src\s+([^;]+)/)
    expect(cspMatch).toBeTruthy()
    expect(cspMatch[1]).toContain('https:')
    expect(cspMatch[1]).toContain('blob:')
  })
})

// ���─ iOS-specific UI ──

describe('iOS UI patterns', () => {
  it('user-select: none is set for mobile', () => {
    expect(allCss).toMatch(/user-select:\s*none/)
  })

  it('-webkit-touch-callout: none is set', () => {
    expect(allCss).toMatch(/-webkit-touch-callout:\s*none/)
  })

  it('moodboard is hidden on phone', () => {
    // tab-moodboard should be hidden on mobile
    expect(allCss).toMatch(/tab-moodboard[\s\S]*?display:\s*none/)
  })
})

// ── www build integrity for iOS ──

describe('www build for iOS', () => {
  const wwwDir = path.join(ROOT, 'www')

  it('www/ directory exists', () => {
    expect(fs.existsSync(wwwDir)).toBe(true)
  })

  it('www/index.html has no inline onclick handlers', () => {
    const wwwHtml = fs.readFileSync(path.join(wwwDir, 'index.html'), 'utf8')
    expect(wwwHtml).not.toMatch(/\bonclick=/)
    expect(wwwHtml).not.toMatch(/\boninput=/)
    expect(wwwHtml).not.toMatch(/\bonchange=/)
  })

  it('www/src/theme-preload.js exists', () => {
    expect(fs.existsSync(path.join(wwwDir, 'src', 'theme-preload.js'))).toBe(true)
  })

  it('www/index.html references theme-preload.js', () => {
    const wwwHtml = fs.readFileSync(path.join(wwwDir, 'index.html'), 'utf8')
    expect(wwwHtml).toContain('theme-preload.js')
  })

  it('www/index.html has mobile scripts injected', () => {
    const wwwHtml = fs.readFileSync(path.join(wwwDir, 'index.html'), 'utf8')
    expect(wwwHtml).toContain('auth-mobile.js')
    expect(wwwHtml).toContain('mobile-shim.js')
    expect(wwwHtml).toContain('offline-manager.js')
    expect(wwwHtml).toContain('supabase-config.js')
  })
})
