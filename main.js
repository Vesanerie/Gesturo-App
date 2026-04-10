try { require('dotenv').config() } catch (e) {}
const { supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, clearAuthStorage } = require('./supabase')
const { app, BrowserWindow, ipcMain, dialog, protocol } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { shell } = require('electron')
const { autoUpdater } = require('electron-updater')

let mainWindow

// ── Chemins ──────────────────────────────────────────────────────────────────
const DEFAULT_LOCAL_FOLDER = path.join(os.homedir(), 'Desktop', 'Gesturo Photos', 'Sessions', 'current')

// ── Auth (Supabase) ───────────────────────────────────────────────────────────
const REDIRECT_URI = 'http://localhost:9876/auth/callback'
const ADMIN_MARKER_PATH = path.join(os.homedir(), '.gesturo-admin')
const WHITELIST_PATH = path.join(__dirname, 'whitelist.json')
const BETA_LANDING = 'https://gesturo.art'

// ── Whitelist ─────────────────────────────────────────────────────────────────
function getWhitelistData() {
  try {
    const raw = JSON.parse(fs.readFileSync(WHITELIST_PATH, 'utf8'))
    if (Array.isArray(raw)) return { expires: null, emails: raw, pro_emails: [] }
    return { pro_emails: [], ...raw }
  } catch(e) {
    return { expires: null, emails: [], pro_emails: [] }
  }
}

function isEmailAllowedLocal(email) {
  const { emails } = getWhitelistData()
  return emails.map(e => e.toLowerCase()).includes(email.toLowerCase())
}

async function isEmailAllowed(email) {
  // 1. Check local whitelist
  if (isEmailAllowedLocal(email)) return true
  // 2. Check Supabase waitlist table
  try {
    const { data } = await supabase
      .from('waitlist')
      .select('email')
      .eq('email', email.toLowerCase())
      .single()
    if (data) return true
  } catch(e) {}
  // 3. Check if user already has a profile in Supabase
  try {
    const { data } = await supabase
      .from('profiles')
      .select('email')
      .eq('email', email.toLowerCase())
      .single()
    if (data) return true
  } catch(e) {}
  return false
}

function isProEmail(email) {
  const { pro_emails } = getWhitelistData()
  if (!pro_emails) return false
  return pro_emails.map(e => e.toLowerCase()).includes(email.toLowerCase())
}

// Vérifie le statut Pro via Supabase (plan column)
async function checkProFromSupabase(email) {
  try {
    const { data } = await supabase
      .from('profiles')
      .select('plan, pro_expires_at')
      .eq('email', email.toLowerCase())
      .single()
    if (!data) return false
    if (data.plan !== 'pro') return false
    // Vérifier si l'abonnement n'est pas expiré
    if (data.pro_expires_at && new Date(data.pro_expires_at) < new Date()) return false
    return true
  } catch(e) {
    console.warn('checkProFromSupabase error:', e.message)
    return false
  }
}

// Payment Links Stripe
const STRIPE_LINK_MONTHLY = 'https://buy.stripe.com/test_dRmdR8cxg6xr7VQ1Yv1ck01'
const STRIPE_LINK_YEARLY = 'https://buy.stripe.com/test_dRmaEWbtccVP4JEbz51ck02'

function isBetaExpired() {
  const { expires } = getWhitelistData()
  if (!expires) return false
  return new Date() > new Date(expires + 'T23:59:59')
}

// ── Admin marker (local-only mode, bypasses Supabase) ────────────────────────
function isAdminMode() {
  try { return fs.existsSync(ADMIN_MARKER_PATH) } catch (e) { return false }
}
// Compat shims so the local-admin file handlers below keep working unchanged.
function loadToken() { return isAdminMode() ? { email: 'admin' } : null }
function isAdminToken(token) { return token && token.email === 'admin' }
function setAdminMode() {
  try { fs.writeFileSync(ADMIN_MARKER_PATH, '1', { mode: 0o600 }) } catch (e) {}
}
function clearAdminMode() {
  try { fs.unlinkSync(ADMIN_MARKER_PATH) } catch (e) {}
}

// ── Supabase OAuth (loopback PKCE) ───────────────────────────────────────────
// Replaces the previous direct Google OAuth flow. We ask Supabase Auth for
// the provider URL, open it in the system browser, catch the ?code=... on the
// loopback server, then exchange the code for a session via supabase-js.
let oauthServer = null

function startSupabaseOAuth() {
  return new Promise((resolve, reject) => {
    const http = require('http')

    if (oauthServer) {
      try { oauthServer.close() } catch (e) {}
      oauthServer = null
    }

    const server = http.createServer(async (req, res) => {
      console.log('[oauth] callback hit:', req.url)
      const url = new URL(req.url, REDIRECT_URI)
      if (url.pathname !== '/auth/callback') {
        res.writeHead(404); res.end('Not found'); return
      }
      const code = url.searchParams.get('code')
      const error = url.searchParams.get('error')
      const errorDescription = url.searchParams.get('error_description')
      console.log('[oauth] params:', { code: code ? 'present' : 'missing', error, errorDescription })

      const html = code
        ? `<html><body style="font-family:sans-serif;background:#111;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column"><h2>✅ Connexion réussie</h2><p style="color:#555;margin-top:12px">Vous pouvez fermer cet onglet et retourner dans l'app.</p></body></html>`
        : `<html><body style="font-family:sans-serif;background:#111;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><h2>❌ Connexion annulée</h2></body></html>`

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html)
      server.close()
      oauthServer = null

      if (error || !code) return reject(new Error((error || 'Code manquant') + (errorDescription ? ': ' + errorDescription : '')))

      try {
        const { data, error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code)
        if (exchangeErr) return reject(exchangeErr)
        resolve(data.session)
      } catch (e) { reject(e) }
    })

    oauthServer = server

    server.listen(9876, '127.0.0.1', async () => {
      try {
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: REDIRECT_URI,
            skipBrowserRedirect: true,
            queryParams: { prompt: 'select_account', access_type: 'offline' },
          },
        })
        if (error) { console.error('[oauth] signInWithOAuth error:', error); reject(error); return }
        console.log('[oauth] opening:', data.url)
        shell.openExternal(data.url)
      } catch (e) { reject(e) }
    })

    server.on('error', (e) => {
      if (e.code === 'EADDRINUSE') {
        reject(new Error('Port 9876 bloqué par un autre programme. Ferme-le et réessaie.'))
      } else {
        reject(e)
      }
    })
  })
}

// ── Edge Function helper (calls user-data with the current session JWT) ─────
async function callUserData(action, payload) {
  const { data: sess } = await supabase.auth.getSession()
  const accessToken = sess?.session?.access_token
  console.log('[callUserData]', action, 'session?', !!sess?.session, 'token len:', accessToken?.length || 0)
  if (!accessToken) throw new Error('not authenticated')
  const res = await fetch(`${SUPABASE_URL}/functions/v1/user-data`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ action, payload }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.warn('[callUserData] FAIL', action, res.status, body)
    throw new Error(`user-data ${action} ${res.status}`)
  }
  return res.json()
}

// Build the profile shape the renderer expects from a Supabase user.
async function buildProfile(user) {
  const email = user.email
  if (isBetaExpired()) return { authenticated: false, reason: 'expired', landingUrl: BETA_LANDING }
  if (!await isEmailAllowed(email)) return { authenticated: false, reason: 'not_allowed', email }
  let isPro = isProEmail(email)
  try {
    if (!isPro) {
      const supabasePro = await checkProFromSupabase(email)
      if (supabasePro) isPro = true
    }
  } catch (e) {}
  return {
    authenticated: true,
    email,
    name: user.user_metadata?.full_name || user.user_metadata?.name || email,
    picture: user.user_metadata?.avatar_url || user.user_metadata?.picture || null,
    isAdmin: false,
    isPro,
  }
}

// ── R2 : délégué aux Edge Functions Supabase ─────────────────────────────────
// Les credentials R2 ne vivent QUE côté serveur (Supabase Function secrets).
// Le client desktop n'appelle plus jamais l'API S3 directement.
async function callEdgeFunction(name, body) {
  // Auth-gated Edge Functions: pass the current user's JWT, not the
  // publishable key. requireUser() on the server validates the email and
  // server-side resolves Pro status — the client cannot grant itself Pro.
  const { data: sess } = await supabase.auth.getSession()
  const accessToken = sess?.session?.access_token
  if (!accessToken) throw new Error('not authenticated')
  const url = `${SUPABASE_URL}/functions/v1/${name}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_PUBLISHABLE_KEY,
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body || {}),
  })
  if (!res.ok) throw new Error(`${name} ${res.status}`)
  return res.json()
}

async function listR2Photos(isPro) {
  // Ne PAS swallow les erreurs ici : si l'Edge Function renvoie 401 ou
  // timeout, on veut que le renderer le sache pour afficher un vrai message
  // d'erreur. Avant ce fix, on retournait [] silencieusement et l'UI disait
  // "0 photos chargées ✓", ce qui était trompeur.
  const data = await callEdgeFunction('list-r2-photos', { isPro: !!isPro })
  return Array.isArray(data) ? data : []
}

async function listR2Animations(isPro) {
  const data = await callEdgeFunction('list-r2-animations', { isPro: !!isPro })
  return Array.isArray(data) ? data : []
}

// ── App ───────────────────────────────────────────────────────────────────────
// NOTE: Le rafraîchissement du token Instagram est désormais géré côté Supabase
// (Edge Function user-data + cron). Le desktop ne stocke plus le token.

app.whenReady().then(() => {
  protocol.registerFileProtocol('file', (request, callback) => {
    const filePath = decodeURIComponent(request.url.replace('file://', ''))
    callback({ path: filePath })
  })
  createWindow()
  autoUpdater.checkForUpdatesAndNotify()
})

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 900, minWidth: 360, minHeight: 600,
    titleBarStyle: 'hiddenInset', backgroundColor: '#111111',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      webviewTag: true,
      preload: path.join(__dirname, 'preload.js')
    }
  })
  mainWindow.loadFile('index.html')
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
  callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [''] } })
})
  mainWindow.webContents.on('did-finish-load', async () => {
    if (isAdminMode()) {
      mainWindow.webContents.send('auth-success', { email: 'admin', name: 'Admin', picture: null, isAdmin: true, isPro: true })
      setTimeout(() => {
        if (fs.existsSync(DEFAULT_LOCAL_FOLDER)) {
          mainWindow.webContents.send('auto-load-folder', DEFAULT_LOCAL_FOLDER)
        } else {
          mainWindow.webContents.send('use-r2-mode', { isPro: true })
        }
      }, 500)
      return
    }
    const { data } = await supabase.auth.getSession()
    const user = data?.session?.user
    if (!user) { mainWindow.webContents.send('auth-required'); return }
    const profile = await buildProfile(user)
    if (profile.authenticated) {
      mainWindow.webContents.send('auth-success', profile)
      setTimeout(() => mainWindow.webContents.send('use-r2-mode', { isPro: profile.isPro }), 500)
    } else if (profile.reason === 'expired') {
      mainWindow.webContents.send('auth-expired', { email: user.email, landingUrl: BETA_LANDING })
    } else if (profile.reason === 'not_allowed') {
      mainWindow.webContents.send('auth-not-allowed', user.email)
    } else {
      mainWindow.webContents.send('auth-required')
    }
  })
}

// ── IPC Auth ──────────────────────────────────────────────────────────────────
ipcMain.handle('auth-google', async () => {
  try {
    const session = await startSupabaseOAuth()
    const user = session?.user
    if (!user) return { success: false, reason: 'error', message: 'Session vide' }
    const profile = await buildProfile(user)
    if (!profile.authenticated) return { success: false, reason: profile.reason, email: user.email, landingUrl: profile.landingUrl }
    // Best-effort upsert into profiles (idempotent)
    try {
      await supabase.from('profiles').upsert({ email: user.email }, { onConflict: 'email', ignoreDuplicates: true })
    } catch (e) {}
    return { success: true, ...profile }
  } catch (e) {
    console.error('❌ auth-google error:', e)
    return { success: false, reason: 'error', message: e.message }
  }
})

ipcMain.handle('auth-logout', async () => {
  try { await supabase.auth.signOut() } catch (e) {}
  clearAuthStorage()
  clearAdminMode()
  mainWindow.webContents.send('auth-required')
  return true
})

// auth-admin handler removed (P0 audit 2026-04-10) — admin access is now
// exclusively via admin-web (magic link + requireAdmin server-side).

ipcMain.handle('auth-check', async () => {
  if (isAdminMode()) return { authenticated: true, email: 'admin', name: 'Admin', picture: null, isAdmin: true, isPro: true }
  const { data } = await supabase.auth.getSession()
  const user = data?.session?.user
  if (!user) return { authenticated: false }
  return await buildProfile(user)
})

ipcMain.handle('get-app-version', () => {
  return app.getVersion()
})

// ── Gesturo Moodboard (in-app, via webview) ──────────────────────────────────
// Renderer files vivent dans ./moodboard/ et le preload dans ./moodboard-preload.js
// Tous les channels sont préfixés "mb:" pour éviter les collisions avec
// les handlers de l'app parent (notamment open-external).

ipcMain.handle('mb:get-preload-path', () => path.join(__dirname, 'moodboard-preload.js'))

function mbProjectsDir() {
  const dir = path.join(app.getPath('userData'), 'moodboard-projects')
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

ipcMain.handle('mb:pick-images', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'avif'] }],
  })
  if (result.canceled) return []
  return result.filePaths.map(fp => ({ path: fp, name: path.basename(fp), dataUrl: 'file://' + fp }))
})

const MB_IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'avif'])
ipcMain.handle('mb:read-file-as-dataurl', async (_, filePath) => {
  const ext = path.extname(String(filePath || '')).toLowerCase().slice(1)
  if (!MB_IMAGE_EXTS.has(ext)) throw new Error('Unsupported file type')
  const buf = fs.readFileSync(filePath)
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
ipcMain.handle('mb:set-always-on-top', async (_, flag) => { if (mainWindow) mainWindow.setAlwaysOnTop(flag, 'floating'); return flag })
ipcMain.handle('mb:set-window-opacity', async (_, opacity) => { if (mainWindow) mainWindow.setOpacity(opacity); return opacity })

ipcMain.handle('mb:list-projects', async () => {
  const dir = mbProjectsDir()
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'))
  return files.map(f => {
    const fp = path.join(dir, f)
    try {
      const data = JSON.parse(fs.readFileSync(fp, 'utf8'))
      const stat = fs.statSync(fp)
      return { file: f, name: data.name || f.replace(/\.json$/, ''), description: data.description || '', color: data.color || '#888888', updatedAt: stat.mtimeMs, photoCount: (data.photos || []).length }
    } catch { return null }
  }).filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt)
})

ipcMain.handle('mb:create-project', async (_, name) => {
  const dir = mbProjectsDir()
  const base = mbSafeName(name)
  let file = base + '.json', i = 1
  while (fs.existsSync(path.join(dir, file))) { file = `${base}-${i++}.json` }
  const data = { name: base, createdAt: Date.now(), photos: [] }
  fs.writeFileSync(path.join(dir, file), JSON.stringify(data))
  return { file, name: base }
})

ipcMain.handle('mb:load-project', async (_, file) => {
  const fp = path.join(mbProjectsDir(), mbSafeFile(file))
  if (!fs.existsSync(fp)) return null
  return JSON.parse(fs.readFileSync(fp, 'utf8'))
})

ipcMain.handle('mb:save-project', async (_, file, data) => {
  fs.writeFileSync(path.join(mbProjectsDir(), mbSafeFile(file)), JSON.stringify(data))
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
  const data = JSON.parse(fs.readFileSync(fp, 'utf8'))
  data.name = mbSafeName(newName)
  fs.writeFileSync(fp, JSON.stringify(data))
  return true
})

ipcMain.handle('mb:duplicate-project', async (_, file) => {
  const dir = mbProjectsDir()
  const fp = path.join(dir, mbSafeFile(file))
  if (!fs.existsSync(fp)) return null
  const data = JSON.parse(fs.readFileSync(fp, 'utf8'))
  const base = mbSafeName((data.name || 'projet') + ' copie')
  let newFile = base + '.json', i = 1
  while (fs.existsSync(path.join(dir, newFile))) { newFile = `${base}-${i++}.json` }
  data.name = base
  data.createdAt = Date.now()
  fs.writeFileSync(path.join(dir, newFile), JSON.stringify(data))
  return { file: newFile, name: base }
})

ipcMain.handle('mb:save-png', async (_, defaultName, dataUrl) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Exporter en PNG',
    defaultPath: (defaultName || 'moodboard') + '.png',
    filters: [{ name: 'Image PNG', extensions: ['png'] }],
  })
  if (result.canceled || !result.filePath) return false
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')
  fs.writeFileSync(result.filePath, Buffer.from(base64, 'base64'))
  return result.filePath
})

ipcMain.handle('mb:save-pdf', async (_, defaultName, jpegDataUrl, w, h) => {
  const result = await dialog.showSaveDialog(mainWindow, {
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
  fs.writeFileSync(result.filePath, Buffer.concat(chunks))
  return result.filePath
})

ipcMain.handle('get-favorites', async () => {
  if (isAdminMode()) return []
  try {
    const data = await callUserData('getFavorites')
    return (data && data.favs) || []
  } catch (e) { return [] }
})

ipcMain.handle('save-favorites', async (event, favs) => {
  if (isAdminMode()) return
  try {
    await callUserData('saveFavorites', Array.isArray(favs) ? favs : [])
  } catch (e) { console.warn('save-favorites error:', e.message) }
})

// Liste les animations R2 — laisse remonter l'erreur au renderer pour que
// loadR2() puisse afficher un vrai message (et pas "0 chargées ✓").
ipcMain.handle('list-r2-animations', async (event, { isPro }) => {
  try {
    return await listR2Animations(isPro)
  } catch(e) {
    console.warn('list-r2-animations error:', e.message)
    throw e
  }
})

// Liste les photos R2 — idem, on propage l'erreur.
ipcMain.handle('list-r2-photos', async (event, { isPro }) => {
  try {
    return await listR2Photos(isPro)
  } catch(e) {
    console.warn('list-r2-photos error:', e.message)
    throw e
  }
})

// Mode local (admin uniquement) — liste les fichiers locaux
ipcMain.handle('list-files', (event, folderPath) => {
  const token = loadToken()
  if (!isAdminToken(token)) return [] // Sécurité : admin only

  const supported = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf']
  const results = []

  function walk(dir, category) {
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch(e) { return }
    const sorted = entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    for (const entry of sorted) {
      if (entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full, entry.name)
      } else {
        const ext = path.extname(entry.name).toLowerCase()
        if (!supported.includes(ext)) continue
        results.push({ path: full, category: category || 'Sans catégorie', sequence: null, animCategory: null, isR2: false })
      }
    }
  }

  walk(folderPath, null)
  return results
})

// Switcher mode local ↔ R2 (admin uniquement)
ipcMain.handle('admin-switch-source', (event, { useLocal }) => {
  const token = loadToken()
  if (!isAdminToken(token)) return { success: false }
  if (useLocal) {
    if (fs.existsSync(DEFAULT_LOCAL_FOLDER)) {
      mainWindow.webContents.send('auto-load-folder', DEFAULT_LOCAL_FOLDER)
    } else {
      return { success: false, reason: 'Dossier local introuvable : ' + DEFAULT_LOCAL_FOLDER }
    }
  } else {
    mainWindow.webContents.send('use-r2-mode', { isPro: true })
  }
  return { success: true }
})

// Choisir un dossier local custom (admin)
ipcMain.handle('pick-folder', async () => {
  const token = loadToken()
  if (!isAdminToken(token)) return null
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

// Lire un fichier local en base64 (admin mode local)
ipcMain.handle('read-file-base64', (event, filePath) => {
  const token = loadToken()
  if (!isAdminToken(token)) return null
  const buf = fs.readFileSync(filePath)
  const ext = path.extname(filePath).toLowerCase()
  const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' }
  return `data:${mimeMap[ext] || 'image/jpeg'};base64,${buf.toString('base64')}`
})

ipcMain.handle('read-file-buffer', (event, filePath) => {
  const token = loadToken()
  if (!isAdminToken(token)) return null
  const buf = fs.readFileSync(filePath)
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
})

// ── IPC Sessions & Streak (delegated to user-data Edge Function) ──────────────
ipcMain.handle('save-session', async (event, sessionData) => {
  if (isAdminMode()) return { success: true }
  try {
    return await callUserData('saveSession', sessionData)
  } catch (e) {
    console.warn('save-session error:', e.message)
    return { success: false }
  }
})

ipcMain.handle('get-streak', async () => {
  if (isAdminMode()) return { streak: 0 }
  try {
    return await callUserData('getStreak')
  } catch (e) {
    console.warn('get-streak error:', e.message)
    return { streak: 0 }
  }
})

function safeOpenExternal(url) {
  try {
    const u = new URL(String(url))
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    shell.openExternal(u.toString())
    return true
  } catch { return false }
}
ipcMain.handle('open-external', (event, url) => safeOpenExternal(url))

ipcMain.handle('get-payment-links', async () => {
  let email = ''
  try {
    const { data } = await supabase.auth.getSession()
    email = data?.session?.user?.email || ''
  } catch (e) {}
  const q = email ? '?prefilled_email=' + encodeURIComponent(email) : ''
  return { monthly: STRIPE_LINK_MONTHLY + q, yearly: STRIPE_LINK_YEARLY + q }
})

ipcMain.handle('refresh-pro-status', async () => {
  if (isAdminMode()) return { isPro: true }
  try {
    return await callUserData('refreshProStatus')
  } catch (e) {
    console.warn('refresh-pro-status error:', e.message)
    return { isPro: false }
  }
})

ipcMain.handle('get-instagram-posts', async () => {
  try {
    const data = await callEdgeFunction('list-instagram-posts')
    return Array.isArray(data) ? data : []
  } catch (e) {
    console.warn('[insta] error:', e.message)
    return []
  }
})

ipcMain.handle('get-reactions', async (_e, postIds) => {
  try {
    return await callUserData('getReactions', { postIds })
  } catch (e) {
    console.warn('[reactions] get error:', e.message)
    return { reactions: [] }
  }
})

ipcMain.handle('toggle-reaction', async (_e, postId, emoji) => {
  try {
    return await callUserData('toggleReaction', { postId, emoji })
  } catch (e) {
    console.warn('[reactions] toggle error:', e.message)
    return { toggled: 'error' }
  }
})

ipcMain.handle('submit-community-post', async (_e, data) => {
  try {
    return await callUserData('submitCommunityPost', data)
  } catch (e) {
    console.warn('[community] submit error:', e.message)
    return { error: e.message }
  }
})

ipcMain.handle('get-community-posts', async () => {
  try {
    return await callUserData('getCommunityPosts')
  } catch (e) {
    console.warn('[community] get error:', e.message)
    return { posts: [] }
  }
})

ipcMain.handle('get-community-leaderboard', async () => {
  try {
    return await callUserData('getCommunityLeaderboard')
  } catch (e) {
    console.warn('[community] leaderboard error:', e.message)
    return { leaderboard: [] }
  }
})

ipcMain.handle('delete-community-post', async (_e, postId) => {
  try {
    return await callUserData('deleteCommunityPost', { postId })
  } catch (e) {
    console.warn('[community] delete error:', e.message)
    return { error: e.message }
  }
})

ipcMain.handle('get-challenges', async () => {
  try {
    return await callUserData('getChallenges')
  } catch (e) {
    console.warn('[challenges] get error:', e.message)
    return { challenges: [] }
  }
})

ipcMain.handle('tag-post-to-challenge', async (_e, postId, challengeId) => {
  try {
    return await callUserData('tagPostToChallenge', { postId, challengeId })
  } catch (e) {
    console.warn('[challenges] tag error:', e.message)
    return { error: e.message }
  }
})

ipcMain.handle('trigger-daily-challenge', async () => {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/daily-challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    if (!res.ok) return { ok: false }
    return await res.json()
  } catch (e) {
    console.warn('[daily-challenge] trigger error:', e.message)
    return { ok: false }
  }
})

app.on('window-all-closed', () => {
  if (oauthServer) { try { oauthServer.close() } catch(e) {} oauthServer = null }
  if (process.platform !== 'darwin') app.quit()
})
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })