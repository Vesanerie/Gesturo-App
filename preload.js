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

  // ── Auth ──
  authGoogle: () => ipcRenderer.invoke('auth-google'),
  authSignup: (data) => ipcRenderer.invoke('auth-signup', data),
  authEmail: (data) => ipcRenderer.invoke('auth-email', data),
  authResetPassword: (email) => ipcRenderer.invoke('auth-reset-password', email),
  authLogout: () => ipcRenderer.invoke('auth-logout'),
  authCheck: () => ipcRenderer.invoke('auth-check'),
  // authAdmin removed — admin access via admin-web only
  onAuthSuccess: (callback) => ipcRenderer.on('auth-success', (event, user) => callback(user)),
  onAuthNotAllowed: (callback) => ipcRenderer.on('auth-not-allowed', (event, email) => callback(email)),
  onAuthExpired: (callback) => ipcRenderer.on('auth-expired', (event, data) => callback(data)),
  onAuthRequired: (callback) => ipcRenderer.on('auth-required', () => callback()),

  // ── Supabase ──
  saveSession: (data) => ipcRenderer.invoke('save-session', data),
  getStreak: () => ipcRenderer.invoke('get-streak'),
  saveFavorites: (favs) => ipcRenderer.invoke('save-favorites', favs),
getFavorites: () => ipcRenderer.invoke('get-favorites'),

  updateUsername: (username) => ipcRenderer.invoke('update-username', username),
  getProfile: () => ipcRenderer.invoke('get-profile'),

  // ── Utilitaires ──
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  getPaymentLinks: () => ipcRenderer.invoke('get-payment-links'),
  refreshProStatus: () => ipcRenderer.invoke('refresh-pro-status'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getInstagramPosts: () => ipcRenderer.invoke('get-instagram-posts'),
  getReactions: (postIds) => ipcRenderer.invoke('get-reactions', postIds),
  toggleReaction: (postId, emoji) => ipcRenderer.invoke('toggle-reaction', postId, emoji),
  submitCommunityPost: (data) => ipcRenderer.invoke('submit-community-post', data),
  getCommunityPosts: () => ipcRenderer.invoke('get-community-posts'),
  deleteCommunityPost: (id) => ipcRenderer.invoke('delete-community-post', id),
  getCommunityLeaderboard: () => ipcRenderer.invoke('get-community-leaderboard'),
  getMyStats: () => ipcRenderer.invoke('get-my-stats'),
  getChallenges: () => ipcRenderer.invoke('get-challenges'),
  tagPostToChallenge: (postId, challengeId) => ipcRenderer.invoke('tag-post-to-challenge', postId, challengeId),
  triggerDailyChallenge: () => ipcRenderer.invoke('trigger-daily-challenge'),

  // ── Gesturo Moodboard (in-app via webview) ──
  getMoodboardPreloadPath: () => ipcRenderer.invoke('mb:get-preload-path'),
  mbListProjects: () => ipcRenderer.invoke('mb:list-projects'),
  mbCreateProject: (name) => ipcRenderer.invoke('mb:create-project', name),
  mbLoadProject: (file) => ipcRenderer.invoke('mb:load-project', file),
  mbSaveProject: (file, data) => ipcRenderer.invoke('mb:save-project', file, data),
})