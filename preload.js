const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // ── Dossiers & fichiers (admin local uniquement) ──
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  listFiles: (folderPath) => ipcRenderer.invoke('list-files', folderPath),
  readFileAsBuffer: (filePath) => ipcRenderer.invoke('read-file-buffer', filePath),
  readFileAsBase64: (filePath) => ipcRenderer.invoke('read-file-base64', filePath),
  isPdf: (filePath) => filePath.toLowerCase().endsWith('.pdf'),
  onAutoLoad: (callback) => ipcRenderer.on('auto-load-folder', (event, folder) => callback(folder)),

  // ── R2 (tous les utilisateurs) ──
  listR2Photos: (opts) => ipcRenderer.invoke('list-r2-photos', opts),
  listR2Animations: (opts) => ipcRenderer.invoke('list-r2-animations', opts),
  onUseR2Mode: (callback) => ipcRenderer.on('use-r2-mode', (event, opts) => callback(opts)),

  // ── Admin : switcher source locale ↔ R2 ──
  adminSwitchSource: (opts) => ipcRenderer.invoke('admin-switch-source', opts),

  // ── Auth Google ──
  authGoogle: () => ipcRenderer.invoke('auth-google'),
  authLogout: () => ipcRenderer.invoke('auth-logout'),
  authCheck: () => ipcRenderer.invoke('auth-check'),
  authAdmin: (password) => ipcRenderer.invoke('auth-admin', password),
  onAuthSuccess: (callback) => ipcRenderer.on('auth-success', (event, user) => callback(user)),
  onAuthNotAllowed: (callback) => ipcRenderer.on('auth-not-allowed', (event, email) => callback(email)),
  onAuthExpired: (callback) => ipcRenderer.on('auth-expired', (event, data) => callback(data)),
  onAuthRequired: (callback) => ipcRenderer.on('auth-required', () => callback()),

  // ── Supabase ──
  saveSession: (data) => ipcRenderer.invoke('save-session', data),
  getStreak: () => ipcRenderer.invoke('get-streak'),

  // ── Utilitaires ──
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  getPaymentLinks: () => ipcRenderer.invoke('get-payment-links'),
  refreshProStatus: () => ipcRenderer.invoke('refresh-pro-status'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getInstagramPosts: () => ipcRenderer.invoke('get-instagram-posts'),
})