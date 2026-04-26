const { ipcMain, dialog, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { isUsernameBlocked } = require('../../blocked-usernames')
const { isAdminMode, loadToken, isAdminToken, clearAdminMode, buildProfile, STRIPE_LINK_MONTHLY, STRIPE_LINK_YEARLY } = require('./auth')
const { startSupabaseOAuth } = require('./oauth')

const DEFAULT_LOCAL_FOLDER = path.join(os.homedir(), 'Desktop', 'Gesturo Photos', 'Sessions', 'current')

function safeOpenExternal(url) {
  try {
    const u = new URL(String(url))
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    shell.openExternal(u.toString())
    return true
  } catch { return false }
}

function registerIPC(getMainWindow, supabase, clearAuthStorage, edge, SUPABASE_URL) {
  const { callUserData, callEdgeFunction, listR2Photos, listR2Animations } = edge

  // ── Auth ──
  ipcMain.handle('auth-google', async () => {
    try {
      const session = await startSupabaseOAuth(supabase)
      const user = session?.user
      if (!user) return { success: false, reason: 'error', message: 'Session vide' }
      const profile = await buildProfile(user, supabase)
      if (!profile.authenticated) return { success: false, reason: profile.reason, email: user.email, landingUrl: profile.landingUrl }
      try {
        await supabase.from('profiles').upsert({ email: user.email }, { onConflict: 'email', ignoreDuplicates: true })
      } catch (e) {}
      return { success: true, ...profile }
    } catch (e) {
      console.error('auth-google error:', e)
      return { success: false, reason: 'error', message: e.message }
    }
  })

  ipcMain.handle('auth-signup', async (_e, { email, password, username }) => {
    try {
      if (username && isUsernameBlocked(username)) {
        return { success: false, message: 'Ce pseudo n\u2019est pas autoris\u00e9' }
      }
      const { data, error } = await supabase.auth.signUp({
        email, password,
        options: { data: { username }, emailRedirectTo: 'https://gesturo.fr/confirm' },
      })
      if (error) return { success: false, message: error.message }
      const user = data?.user
      if (!user) return { success: false, message: 'Inscription \u00e9chou\u00e9e' }
      if (!data.session) return { success: true, needsConfirmation: true }
      const profile = await buildProfile(user, supabase)
      try {
        await supabase.from('profiles').upsert(
          { email: user.email, username: username || user.email.split('@')[0] },
          { onConflict: 'email' }
        )
      } catch (e) {}
      return { success: true, ...profile }
    } catch (e) {
      return { success: false, message: e.message }
    }
  })

  ipcMain.handle('auth-email', async (_e, { email, password }) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) return { success: false, message: error.message }
      const user = data?.user
      if (!user) return { success: false, message: 'Session vide' }
      const profile = await buildProfile(user, supabase)
      try {
        await supabase.from('profiles').upsert({ email: user.email }, { onConflict: 'email', ignoreDuplicates: true })
      } catch (e) {}
      return { success: true, ...profile }
    } catch (e) {
      return { success: false, message: e.message }
    }
  })

  ipcMain.handle('auth-reset-password', async (_e, email) => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: 'https://gesturo.fr/reset-password'
      })
      if (error) return { success: false, message: error.message }
      return { success: true }
    } catch (e) {
      return { success: false, message: e.message }
    }
  })

  ipcMain.handle('auth-logout', async () => {
    try { await supabase.auth.signOut() } catch (e) {}
    clearAuthStorage()
    clearAdminMode()
    const w = getMainWindow()
    if (w && !w.isDestroyed()) w.loadFile('index.html')
    return true
  })

  ipcMain.handle('update-username', async (_e, username) => {
    try {
      if (username && isUsernameBlocked(username)) {
        return { error: 'Ce pseudo n\u2019est pas autoris\u00e9' }
      }
      return await callUserData('updateUsername', { username })
    } catch (e) {
      return { error: e.message }
    }
  })

  ipcMain.handle('get-profile', async () => {
    try { return await callUserData('getProfile') }
    catch (e) { return { error: e.message } }
  })

  ipcMain.handle('auth-check', async () => {
    if (isAdminMode()) return { authenticated: true, email: 'admin', name: 'Admin', picture: null, isAdmin: true, isPro: true }
    const { data } = await supabase.auth.getSession()
    const user = data?.session?.user
    if (!user) return { authenticated: false }
    return await buildProfile(user, supabase)
  })

  ipcMain.handle('get-app-version', () => require('electron').app.getVersion())

  ipcMain.handle('install-update', () => {
    const { autoUpdater } = require('electron-updater')
    autoUpdater.quitAndInstall(false, true)
  })

  // ── R2 ──
  ipcMain.handle('list-r2-photos', async (event, { isPro }) => {
    try { return await listR2Photos(isPro) }
    catch(e) { console.warn('list-r2-photos error:', e.message); throw e }
  })

  ipcMain.handle('list-r2-animations', async (event, { isPro }) => {
    try { return await listR2Animations(isPro) }
    catch(e) { console.warn('list-r2-animations error:', e.message); throw e }
  })

  // ── Local files (admin only) ──
  ipcMain.handle('list-files', (event, folderPath) => {
    const token = loadToken()
    if (!isAdminToken(token)) return []
    const supported = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf']
    const results = []
    function walk(dir, category) {
      let entries
      try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch(e) { return }
      const sorted = entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      for (const entry of sorted) {
        if (entry.name.startsWith('.')) continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) { walk(full, entry.name) }
        else {
          const ext = path.extname(entry.name).toLowerCase()
          if (!supported.includes(ext)) continue
          results.push({ path: full, category: category || 'Sans cat\u00e9gorie', sequence: null, animCategory: null, isR2: false })
        }
      }
    }
    walk(folderPath, null)
    return results
  })

  ipcMain.handle('admin-switch-source', (event, { useLocal }) => {
    const token = loadToken()
    if (!isAdminToken(token)) return { success: false }
    const w = getMainWindow()
    if (!w || w.isDestroyed()) return { success: false }
    if (useLocal) {
      if (fs.existsSync(DEFAULT_LOCAL_FOLDER)) { w.webContents.send('auto-load-folder', DEFAULT_LOCAL_FOLDER) }
      else { return { success: false, reason: 'Dossier local introuvable : ' + DEFAULT_LOCAL_FOLDER } }
    } else {
      w.webContents.send('use-r2-mode', { isPro: true })
    }
    return { success: true }
  })

  ipcMain.handle('pick-folder', async () => {
    const token = loadToken()
    if (!isAdminToken(token)) return null
    const result = await dialog.showOpenDialog(getMainWindow(), { properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('read-file-base64', async (event, filePath) => {
    const token = loadToken()
    if (!isAdminToken(token)) return null
    const buf = await fs.promises.readFile(filePath)
    const ext = path.extname(filePath).toLowerCase()
    const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' }
    return `data:${mimeMap[ext] || 'image/jpeg'};base64,${buf.toString('base64')}`
  })

  ipcMain.handle('read-file-buffer', async (event, filePath) => {
    const token = loadToken()
    if (!isAdminToken(token)) return null
    const buf = await fs.promises.readFile(filePath)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  })

  // ── Sessions & Streak ──
  ipcMain.handle('save-session', async (event, sessionData) => {
    if (isAdminMode()) return { success: true }
    try { return await callUserData('saveSession', sessionData) }
    catch (e) { console.warn('save-session error:', e.message); return { success: false } }
  })

  ipcMain.handle('get-streak', async () => {
    if (isAdminMode()) return { streak: 0 }
    try { return await callUserData('getStreak', { tzOffset: new Date().getTimezoneOffset() }) }
    catch (e) { console.warn('get-streak error:', e.message); return { streak: 0 } }
  })

  // ── Favorites & Badges ──
  ipcMain.handle('get-favorites', async () => {
    if (isAdminMode()) return []
    try { const data = await callUserData('getFavorites'); return (data && data.favs) || [] }
    catch (e) { return [] }
  })

  ipcMain.handle('save-favorites', async (event, favs) => {
    if (isAdminMode()) return
    try { await callUserData('saveFavorites', Array.isArray(favs) ? favs : []) }
    catch (e) { console.warn('save-favorites error:', e.message) }
  })

  ipcMain.handle('get-sessions', async () => {
    if (isAdminMode()) return []
    try { const data = await callUserData('getSessions'); return (data && data.sessions) || [] }
    catch (e) { return [] }
  })

  ipcMain.handle('save-badge', async (event, payload) => {
    if (isAdminMode()) return
    try { await callUserData('saveBadge', payload || {}) }
    catch (e) { console.warn('save-badge error:', e.message) }
  })

  ipcMain.handle('get-badges', async () => {
    if (isAdminMode()) return {}
    try { const data = await callUserData('getBadges'); return (data && data.badges) || {} }
    catch (e) { return {} }
  })

  // ── Misc ──
  ipcMain.handle('open-external', (event, url) => safeOpenExternal(url))

  ipcMain.handle('get-payment-links', async () => {
    let email = ''
    try { const { data } = await supabase.auth.getSession(); email = data?.session?.user?.email || '' }
    catch (e) {}
    const q = email ? '?prefilled_email=' + encodeURIComponent(email) : ''
    return { monthly: STRIPE_LINK_MONTHLY + q, yearly: STRIPE_LINK_YEARLY + q }
  })

  ipcMain.handle('refresh-pro-status', async () => {
    if (isAdminMode()) return { isPro: true }
    try { return await callUserData('refreshProStatus') }
    catch (e) { console.warn('refresh-pro-status error:', e.message); return { isPro: false } }
  })

  ipcMain.handle('get-instagram-posts', async () => {
    try { const data = await callEdgeFunction('list-instagram-posts'); return Array.isArray(data) ? data : [] }
    catch (e) { console.warn('[insta] error:', e.message); return [] }
  })

  // ── Community ──
  ipcMain.handle('get-reactions', async (_e, postIds) => {
    try { return await callUserData('getReactions', { postIds }) }
    catch (e) { console.warn('[reactions] get error:', e.message); return { reactions: [] } }
  })

  ipcMain.handle('toggle-reaction', async (_e, postId, emoji) => {
    try { return await callUserData('toggleReaction', { postId, emoji }) }
    catch (e) { console.warn('[reactions] toggle error:', e.message); return { toggled: 'error' } }
  })

  ipcMain.handle('submit-community-post', async (_e, data) => {
    try { return await callUserData('submitCommunityPost', data) }
    catch (e) { console.warn('[community] submit error:', e.message); return { error: e.message } }
  })

  ipcMain.handle('moderate-community-post', async (_e, postId) => {
    try { return await callUserData('moderateCommunityPost', { postId }) }
    catch (e) { console.warn('[community] moderation error:', e.message); return { ok: true } }
  })

  ipcMain.handle('get-community-posts', async () => {
    try { return await callUserData('getCommunityPosts') }
    catch (e) { console.warn('[community] get error:', e.message); return { posts: [] } }
  })

  ipcMain.handle('get-community-leaderboard', async () => {
    try { return await callUserData('getCommunityLeaderboard') }
    catch (e) { console.warn('[community] leaderboard error:', e.message); return { leaderboard: [] } }
  })

  ipcMain.handle('get-my-stats', async () => {
    try { return await callUserData('getMyStats') }
    catch (e) { console.warn('[community] my-stats error:', e.message); return { postsCount: 0, reactionsGivenCount: 0, challengesCount: 0 } }
  })

  ipcMain.handle('delete-community-post', async (_e, postId) => {
    try { return await callUserData('deleteCommunityPost', { postId }) }
    catch (e) { console.warn('[community] delete error:', e.message); return { error: e.message } }
  })

  // ── Challenges ──
  ipcMain.handle('get-challenges', async () => {
    try { return await callUserData('getChallenges') }
    catch (e) { console.warn('[challenges] get error:', e.message); return { challenges: [] } }
  })

  ipcMain.handle('tag-post-to-challenge', async (_e, postId, challengeId) => {
    try { return await callUserData('tagPostToChallenge', { postId, challengeId }) }
    catch (e) { console.warn('[challenges] tag error:', e.message); return { error: e.message } }
  })

  ipcMain.handle('trigger-daily-challenge', async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/daily-challenge`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) return { ok: false }
      return await res.json()
    } catch (e) { console.warn('[daily-challenge] trigger error:', e.message); return { ok: false } }
  })

  // ── App Settings ──
  ipcMain.handle('get-active-announcement', async () => {
    try { return await callUserData('getActiveAnnouncement') }
    catch (e) { return { announcement: null } }
  })

  ipcMain.handle('get-app-settings', async () => {
    try { return await callUserData('getAppSettings') }
    catch (e) { return { settings: {} } }
  })

  ipcMain.handle('get-feature-flags', async () => {
    try { return await callUserData('getFeatureFlags') }
    catch (e) { return { flags: {} } }
  })

  ipcMain.handle('ping-activity', async () => {
    try { return await callUserData('pingActivity') }
    catch (e) { return { ok: false } }
  })

  ipcMain.handle('log-client-error', async (_e, data) => {
    try { return await callUserData('logClientError', data) }
    catch (e) { return { ok: false } }
  })
}

module.exports = { registerIPC }
