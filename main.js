require('dotenv').config()
const { supabase } = require('./supabase')
const crypto = require('crypto')
const { app, BrowserWindow, ipcMain, dialog, protocol } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const https = require('https')
const { shell } = require('electron')
const { autoUpdater } = require('electron-updater')

let mainWindow

// ── Chemins ──────────────────────────────────────────────────────────────────
const DEFAULT_LOCAL_FOLDER = path.join(os.homedir(), 'Desktop', 'Gesturo Photos', 'Sessions', 'current')
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || ''
const R2_BASE = R2_PUBLIC_URL ? `${R2_PUBLIC_URL}/sessions/current` : ''
const R2_ANIM_BASE = R2_PUBLIC_URL ? `${R2_PUBLIC_URL}/animations/current` : ''

// Catégories nudité → Pro uniquement
const NUDITY_CATEGORIES = ['nudite']

// ── OAuth ─────────────────────────────────────────────────────────────────────
let OAUTH_CREDS = { client_id: '', client_secret: '' }
try {
  const raw = fs.readFileSync(path.join(__dirname, 'oauth_credentials.json'), 'utf8')
  const parsed = JSON.parse(raw)
  const creds = parsed.installed || parsed.web || parsed
  OAUTH_CREDS.client_id = creds.client_id
  OAUTH_CREDS.client_secret = creds.client_secret
} catch(e) {
  console.warn('oauth_credentials.json introuvable ou invalide:', e.message)
}

const REDIRECT_URI = 'http://localhost:9876/oauth/callback'
const SCOPES = 'openid email profile'
const TOKEN_PATH = path.join(os.homedir(), '.gesture_drawing_token.json')
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

function isEmailAllowed(email) {
  const { emails } = getWhitelistData()
  return emails.map(e => e.toLowerCase()).includes(email.toLowerCase())
}

function isProEmail(email) {
  const { pro_emails } = getWhitelistData()
  if (!pro_emails) return false
  return pro_emails.map(e => e.toLowerCase()).includes(email.toLowerCase())
}

function isBetaExpired() {
  const { expires } = getWhitelistData()
  if (!expires) return false
  return new Date() > new Date(expires + 'T23:59:59')
}

// ── Token ─────────────────────────────────────────────────────────────────────
function saveToken(token) {
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2))
}

function loadToken() {
  try { return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8')) } catch(e) { return null }
}

function isAdminToken(token) {
  return token && token.email === 'admin'
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
function httpsPost(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch(e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch(e) { reject(e) }
      })
    }).on('error', reject)
  })
}

// ── OAuth Flow ────────────────────────────────────────────────────────────────
async function exchangeCode(code) {
  const body = new URLSearchParams({
    code,
    client_id: OAUTH_CREDS.client_id,
    client_secret: OAUTH_CREDS.client_secret,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code'
  }).toString()

  return httpsPost({
    hostname: 'oauth2.googleapis.com',
    path: '/token',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
  }, body)
}

async function getUserInfo(accessToken) {
  return httpsGet(`https://www.googleapis.com/oauth2/v2/userinfo?access_token=${accessToken}`)
}

function startOAuthFlow() {
  return new Promise((resolve, reject) => {
    const http = require('http')

    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://localhost:9876')
      if (url.pathname !== '/oauth/callback') {
        res.writeHead(404); res.end('Not found'); return
      }

      const code = url.searchParams.get('code')
      const error = url.searchParams.get('error')

      const html = code
        ? `<html><body style="font-family:sans-serif;background:#111;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column"><h2>✅ Connexion réussie</h2><p style="color:#555;margin-top:12px">Vous pouvez fermer cet onglet et retourner dans l'app.</p></body></html>`
        : `<html><body style="font-family:sans-serif;background:#111;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><h2>❌ Connexion annulée</h2></body></html>`

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html)
      server.close()

      if (error || !code) return reject(new Error(error || 'Code manquant'))

      try {
        const tokenData = await exchangeCode(code)
        const userInfo = await getUserInfo(tokenData.access_token)
        resolve({ tokenData, userInfo })
      } catch(e) { reject(e) }
    })

    server.listen(9876, '127.0.0.1', () => {
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${OAUTH_CREDS.client_id}` +
        `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
        `&response_type=code` +
        `&scope=${encodeURIComponent(SCOPES)}` +
        `&access_type=offline` +
        `&prompt=select_account`
      shell.openExternal(authUrl)
    })

    server.on('error', (e) => {
      if (e.code === 'EADDRINUSE') reject(new Error('Port 9876 déjà utilisé — ferme l\'app et relance'))
      else reject(e)
    })
  })
}

// ── R2 : lister les photos depuis Cloudflare ──────────────────────────────────
// On liste les clés via l'API S3 (ListObjectsV2) depuis le main process
async function listR2Photos(isPro) {
  if (!R2_PUBLIC_URL) return []

  const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3')
  const client = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  })

  const results = []
  let continuationToken = undefined

  do {
    const cmd = new ListObjectsV2Command({
      Bucket: process.env.R2_BUCKET,
      Prefix: 'Sessions/current/',
      ContinuationToken: continuationToken,
    })
    const res = await client.send(cmd)
    for (const obj of (res.Contents || [])) {
      const key = obj.Key // ex: sessions/current/corps-entier/photo.jpg
      const parts = key.split('/')
      // parts[0]=sessions, parts[1]=current, parts[2]=categorie, parts[3]=fichier
      if (parts.length < 4) continue
      const category = parts[2]
      const ext = path.extname(parts[parts.length - 1]).toLowerCase()
      if (!['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) continue

      // Nudité → Pro uniquement
      if (NUDITY_CATEGORIES.includes(category) && !isPro) continue

      const url = `${R2_PUBLIC_URL}/${key}`
      results.push({ path: url, category, sequence: null, animCategory: null, isR2: true })
    }
    continuationToken = res.NextContinuationToken
  } while (continuationToken)

  return results
}

async function listR2Animations(isPro) {
  if (!R2_PUBLIC_URL) return []

  const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3')
  const client = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  })

  const results = []
  // Free : uniquement animations/current/free/
  // Pro  : animations/current/free/ + animations/current/pro/
  const prefixes = ['Animations/current/free/', 'Animations/current/pro/']

  for (const prefix of prefixes) {
    let continuationToken = undefined
    do {
      const cmd = new ListObjectsV2Command({
        Bucket: process.env.R2_BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
      const res = await client.send(cmd)
      for (const obj of (res.Contents || [])) {
        const key = obj.Key
        const parts = key.split('/')
        // animations/current/[free|pro]/sequence/fichier.jpg
        if (parts.length < 5) continue
        const tier = parts[2] // free ou pro
        const animCategory = parts.length >= 6 ? parts[3] : 'default'
        const sequenceName = parts.length >= 6 ? parts[4] : parts[3]
        const ext = path.extname(parts[parts.length - 1]).toLowerCase()
        if (!['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) continue
        const url = `${R2_PUBLIC_URL}/${key}`
        results.push({ path: url, category: null, sequence: sequenceName, animCategory, isR2: true })
      }
      continuationToken = res.NextContinuationToken
    } while (continuationToken)
  }

  return results
}

// ── App ───────────────────────────────────────────────────────────────────────
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
    width: 1280, height: 900, minWidth: 800, minHeight: 600,
    titleBarStyle: 'hiddenInset', backgroundColor: '#111111',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      preload: path.join(__dirname, 'preload.js')
    }
  })
  mainWindow.loadFile('index.html')
  mainWindow.webContents.on('did-finish-load', () => {
    const token = loadToken()
    if (!token || !token.email) {
      mainWindow.webContents.send('auth-required')
      return
    }
    if (isAdminToken(token)) {
      mainWindow.webContents.send('auth-success', { email: 'admin', name: 'Admin', picture: null, isAdmin: true, isPro: true })
      // Admin : mode local par défaut si le dossier existe, sinon R2
      setTimeout(() => {
        if (fs.existsSync(DEFAULT_LOCAL_FOLDER)) {
          mainWindow.webContents.send('auto-load-folder', DEFAULT_LOCAL_FOLDER)
        } else {
          mainWindow.webContents.send('use-r2-mode', { isPro: true })
        }
      }, 500)
    } else if (isBetaExpired()) {
      mainWindow.webContents.send('auth-expired', { email: token.email, landingUrl: BETA_LANDING })
    } else if (isEmailAllowed(token.email)) {
      const isPro = isProEmail(token.email)
      mainWindow.webContents.send('auth-success', { email: token.email, name: token.name, picture: token.picture, isAdmin: false, isPro })
      // Utilisateurs : toujours R2
      setTimeout(() => {
        mainWindow.webContents.send('use-r2-mode', { isPro })
      }, 500)
    } else {
      mainWindow.webContents.send('auth-not-allowed', token.email)
    }
  })
}

// ── IPC Auth ──────────────────────────────────────────────────────────────────
ipcMain.handle('auth-google', async () => {
  try {
    const { tokenData, userInfo } = await startOAuthFlow()
    if (!isEmailAllowed(userInfo.email)) {
      return { success: false, reason: 'not_allowed', email: userInfo.email }
    }
    if (isBetaExpired()) {
      return { success: false, reason: 'expired', landingUrl: BETA_LANDING }
    }
    const { error } = await supabase
      .from('profiles')
      .upsert({ email: userInfo.email }, { onConflict: 'email', ignoreDuplicates: true })
    if (error) console.warn('Supabase upsert error:', error.message)
    saveToken({ ...tokenData, email: userInfo.email, name: userInfo.name, picture: userInfo.picture })
    return { success: true, email: userInfo.email, name: userInfo.name, picture: userInfo.picture }
  } catch(e) {
    return { success: false, reason: 'error', message: e.message }
  }
})

ipcMain.handle('auth-logout', () => {
  try { fs.unlinkSync(TOKEN_PATH) } catch(e) {}
  mainWindow.webContents.send('auth-required')
  return true
})

ipcMain.handle('auth-admin', (event, password) => {
  try {
    const raw = JSON.parse(fs.readFileSync(WHITELIST_PATH, 'utf8'))
    const adminPassword = raw.admin_password || 'admin'
    if (password === adminPassword) {
      saveToken({ email: 'admin', name: 'Admin', picture: null })
      return { success: true }
    }
    return { success: false }
  } catch(e) {
    return { success: false }
  }
})

ipcMain.handle('auth-check', () => {
  const token = loadToken()
  if (!token || !token.email) return { authenticated: false }
  if (isAdminToken(token)) return { authenticated: true, email: 'admin', name: 'Admin', picture: null, isAdmin: true, isPro: true }
  if (!isEmailAllowed(token.email)) return { authenticated: false, reason: 'not_allowed' }
  if (isBetaExpired()) return { authenticated: false, reason: 'expired', landingUrl: BETA_LANDING }
  const isPro = isProEmail(token.email)
  return { authenticated: true, email: token.email, name: token.name, picture: token.picture, isAdmin: false, isPro }
})

// ── IPC Photos ────────────────────────────────────────────────────────────────

// Liste les photos R2 (appelé par l'app au démarrage)
ipcMain.handle('list-r2-photos', async (event, { isPro }) => {
  try {
    return await listR2Photos(isPro)
  } catch(e) {
    console.warn('list-r2-photos error:', e.message)
    return []
  }
})

// Liste les animations R2
ipcMain.handle('list-r2-animations', async (event, { isPro }) => {
  try {
    return await listR2Animations(isPro)
  } catch(e) {
    console.warn('list-r2-animations error:', e.message)
    return []
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

// ── IPC Sessions & Streak ─────────────────────────────────────────────────────
ipcMain.handle('save-session', async (event, sessionData) => {
  const token = loadToken()
  if (!token || !token.email) return { success: false }
  try {
    const { data: profile } = await supabase
      .from('profiles').select('id').eq('email', token.email).single()
    if (!profile) return { success: false }
    const { error } = await supabase.from('sessions').insert({
      user_id: profile.id,
      duration_seconds: sessionData.minutes * 60,
      photo_count: sessionData.poses,
      category: sessionData.cats || null,
    })
    if (error) console.warn('Session save error:', error.message)
    return { success: true }
  } catch(e) {
    console.warn('Session save error:', e.message)
    return { success: false }
  }
})

ipcMain.handle('get-streak', async () => {
  const token = loadToken()
  if (!token || !token.email) return { streak: 0 }
  try {
    const { data: profile } = await supabase
      .from('profiles').select('id').eq('email', token.email).single()
    if (!profile) return { streak: 0 }
    const { data: sessions } = await supabase
      .from('sessions').select('created_at').eq('user_id', profile.id)
      .order('created_at', { ascending: false })
    if (!sessions || sessions.length === 0) return { streak: 0 }
    const days = new Set(sessions.map(s => new Date(s.created_at).toISOString().split('T')[0]))
    let streak = 0
    const today = new Date()
    for (let i = 0; i < 365; i++) {
      const d = new Date(today)
      d.setDate(today.getDate() - i)
      const key = d.toISOString().split('T')[0]
      if (days.has(key)) streak++
      else if (i > 0) break
    }
    return { streak }
  } catch(e) {
    console.warn('get-streak error:', e.message)
    return { streak: 0 }
  }
})

ipcMain.handle('open-external', (event, url) => { shell.openExternal(url) })

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
