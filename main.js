try { require('dotenv').config() } catch (e) {}
try { require('electron-reloader')(module, { watchRenderer: true }) } catch (e) {}
const { supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, clearAuthStorage } = require('./supabase')
const { app, BrowserWindow, protocol } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { autoUpdater } = require('electron-updater')

const { isAdminMode, buildProfile, BETA_LANDING } = require('./src/main/auth')
const { closeOAuthServer } = require('./src/main/oauth')
const { createEdgeClient } = require('./src/main/edge')
const { registerMoodboardIPC } = require('./src/main/moodboard')
const { registerIPC } = require('./src/main/ipc')

let mainWindow
const DEFAULT_LOCAL_FOLDER = path.join(os.homedir(), 'Desktop', 'Gesturo Photos', 'Sessions', 'current')

// ── Edge Function client ─────────────────────────────────────────────────────
const edge = createEdgeClient(supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)

// ── Register all IPC handlers ────────────────────────────────────────────────
const getMainWindow = () => mainWindow
const getApp = () => app
registerMoodboardIPC(getMainWindow, getApp)
registerIPC(getMainWindow, supabase, clearAuthStorage, edge, SUPABASE_URL)

// ── App ready ────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  const allowedRoots = [app.getAppPath(), app.getPath('userData'), os.homedir()]
  protocol.registerFileProtocol('file', (request, callback) => {
    const filePath = path.resolve(decodeURIComponent(request.url.replace('file://', '')))
    if (filePath.includes('..')) {
      console.warn('[file protocol] blocked path with ..: ', filePath)
      callback({ error: -10 })
      return
    }
    const isAllowed = allowedRoots.some(root => filePath.startsWith(root))
    if (!isAllowed) {
      console.warn('[file protocol] blocked path outside allowed roots: ', filePath)
      callback({ error: -10 })
      return
    }
    callback({ path: filePath })
  })
  createWindow()

  // ── Auto-update ──
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send('update-status', { status: 'downloading', version: info.version })
  })
  autoUpdater.on('update-downloaded', (info) => {
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send('update-status', { status: 'ready', version: info.version })
  })
  autoUpdater.on('error', (err) => {
    console.log('Auto-update error:', err.message)
  })

  autoUpdater.checkForUpdates().catch(() => {})
})

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 900, minWidth: 360, minHeight: 600,
    titleBarStyle: 'hiddenInset', backgroundColor: '#111111',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      webviewTag: true,
      preload: path.join(__dirname, 'preload.js')
    }
  })
  mainWindow.loadFile('index.html')
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders, 'Content-Security-Policy': ["default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https: blob:; media-src 'self' blob:; connect-src 'self' https:; font-src 'self' https://fonts.gstatic.com https://fonts.googleapis.com; frame-src https:"] }
    const url = details.url || ''
    if (url.includes('.r2.dev') || url.includes('gesturo-photos')) {
      headers['cache-control'] = ['public, max-age=86400, immutable']
    }
    callback({ responseHeaders: headers })
  })
  mainWindow.webContents.on('did-finish-load', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (isAdminMode()) {
      mainWindow.webContents.send('auth-success', { email: 'admin', name: 'Admin', picture: null, isAdmin: true, isPro: true })
      setTimeout(() => {
        if (!mainWindow || mainWindow.isDestroyed()) return
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
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (!user) { mainWindow.webContents.send('auth-required'); return }
    const profile = await buildProfile(user, supabase)
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (profile.authenticated) {
      mainWindow.webContents.send('auth-success', profile)
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('use-r2-mode', { isPro: profile.isPro })
      }, 500)
    } else if (profile.reason === 'expired') {
      mainWindow.webContents.send('auth-expired', { email: user.email, landingUrl: BETA_LANDING })
    } else if (profile.reason === 'not_allowed') {
      mainWindow.webContents.send('auth-not-allowed', user.email)
    } else {
      mainWindow.webContents.send('auth-required')
    }
  })
}

// ── Lifecycle ────────────────────────────────────────────────────────────────
app.on('window-all-closed', () => {
  closeOAuthServer()
  if (process.platform !== 'darwin') app.quit()
})
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
