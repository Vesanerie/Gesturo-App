// Mobile shim for window.electronAPI.
// Makes the existing renderer (designed for Electron preload IPC) work
// inside a Capacitor webview by reimplementing each method with web/Capacitor
// equivalents. Loaded automatically by sync-web.js into www/index.html.
//
// NOTE: methods that only make sense in the desktop "admin local folder"
// mode are stubbed (they reject or no-op) — mobile users only see R2 mode.
(function () {
  if (typeof window === 'undefined') return;
  if (window.electronAPI) return; // already provided (e.g. running in Electron)

  const Capacitor = window.Capacitor || null;
  const plugins = (Capacitor && Capacitor.Plugins) || {};
  // Expose platform info for renderer (Android has MLKit document scanner, iOS doesn't)
  const platform = (Capacitor && Capacitor.getPlatform) ? Capacitor.getPlatform() : 'web';
  window.__isAndroid = platform === 'android';
  window.__isIOS = platform === 'ios';

  const noop = () => {};
  const reject = (msg) => () => Promise.reject(new Error(msg + ' (not available on mobile)'));

  // Screen orientation helpers — exposés sur window pour que src/app.js
  // les appelle depuis showScreen() sans connaître Capacitor.
  // Sur desktop Electron (où ce shim ne tourne pas), les helpers sont
  // déjà installés en no-op via preload — voir fallback ci-dessous.
  const SO = plugins.ScreenOrientation;
  window.__lockPortrait = async () => {
    try { if (SO && SO.lock) await SO.lock({ orientation: 'portrait' }); } catch (e) {}
  };
  window.__unlockOrientation = async () => {
    try { if (SO && SO.unlock) await SO.unlock(); } catch (e) {}
  };

  const openExternal = async (url) => {
    // URLs avec apps natives connues → App.openUrl() pour déclencher
    // les Universal Links iOS (ouvre Instagram/Discord/etc. nativement)
    const nativeAppPatterns = [
      /instagram\.com/i,
      /discord\.gg/i,
      /discord\.com/i,
    ];
    const shouldOpenNative = nativeAppPatterns.some(p => p.test(url));

    if (shouldOpenNative && plugins.App && plugins.App.openUrl) {
      try {
        await plugins.App.openUrl({ url });
        return;
      } catch (e) { /* fall through to Browser */ }
    }

    try {
      if (plugins.Browser && plugins.Browser.open) {
        await plugins.Browser.open({ url });
        return;
      }
    } catch (e) { /* fall through */ }
    window.open(url, '_blank');
  };

  const getAppVersion = async () => {
    try {
      if (plugins.App && plugins.App.getInfo) {
        const info = await plugins.App.getInfo();
        return info.version;
      }
    } catch (e) {}
    return '0.0.0-mobile';
  };

  // Listener registry: the renderer subscribes to events that Electron used
  // to push from main. On mobile we keep the callbacks so other code paths
  // (auth flow, R2 mode bootstrap) can fire them when ready.
  const listeners = {
    autoLoad: [],
    useR2Mode: [],
    authSuccess: [],
    authNotAllowed: [],
    authExpired: [],
    authRequired: [],
    dailyPoseDeepLink: [],
    challengeDeepLink: [],
  };
  const on = (key) => (cb) => { listeners[key].push(cb); };

  // Expose a tiny bus so the auth/R2 bootstrap (added later) can emit events.
  window.__mobileBus = {
    emit(key, payload) {
      (listeners[key] || []).forEach((cb) => {
        try { cb(payload); } catch (e) { console.error('[mobileBus]', key, e); }
      });
    },
  };

  window.electronAPI = {
    // ── Local files (admin desktop only) — stubbed on mobile ──
    pickFolder: reject('pickFolder'),
    listFiles: reject('listFiles'),
    readFileAsBuffer: reject('readFileAsBuffer'),
    readFileAsBase64: reject('readFileAsBase64'),
    isPdf: (p) => typeof p === 'string' && p.toLowerCase().endsWith('.pdf'),
    onAutoLoad: on('autoLoad'),

    // ── R2 (delegated to Supabase Edge Functions, see auth-mobile.js) ──
    listR2Photos: async ({ isPro } = {}) => {
      const sb = await window.__gesturoAuth.getSupabase();
      const { data, error } = await sb.functions.invoke('list-r2-photos', { body: { isPro: !!isPro } });
      if (error) throw error;
      return data || [];
    },
    listR2Animations: async ({ isPro } = {}) => {
      const sb = await window.__gesturoAuth.getSupabase();
      const { data, error } = await sb.functions.invoke('list-r2-animations', { body: { isPro: !!isPro } });
      if (error) throw error;
      return data || [];
    },
    onUseR2Mode: on('useR2Mode'),
    adminSwitchSource: reject('adminSwitchSource'),

    // ── Auth (Supabase Auth + Capacitor Browser, see auth-mobile.js) ──
    authGoogle: async () => {
      if (!window.__gesturoAuth) return { success: false, reason: 'error', message: 'auth-mobile not loaded' };
      return window.__gesturoAuth.signIn();
    },
    authSignup: async ({ email, password, username }) => {
      if (!window.__gesturoAuth) return { success: false, message: 'auth not loaded' };
      try {
        const sb = await window.__gesturoAuth.getSupabase();
        const { data, error } = await sb.auth.signUp({
          email,
          password,
          options: {
            data: { username },
            emailRedirectTo: 'https://gesturo.fr/confirm'
          }
        });
        if (error) return { success: false, message: error.message };
        if (!data.session) return { success: true, needsConfirmation: true };
        return { success: true, authenticated: true, email, username: username || email.split('@')[0] };
      } catch (e) { return { success: false, message: e.message }; }
    },
    authEmail: async ({ email, password }) => {
      if (!window.__gesturoAuth) return { success: false, message: 'auth not loaded' };
      try {
        const sb = await window.__gesturoAuth.getSupabase();
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) return { success: false, message: error.message };
        const user = data?.user;
        const username = user?.user_metadata?.username || email.split('@')[0];
        return { success: true, authenticated: true, email, username };
      } catch (e) { return { success: false, message: e.message }; }
    },
    authResetPassword: async (email) => {
      if (!window.__gesturoAuth) return { success: false, message: 'auth not loaded' };
      try {
        const sb = await window.__gesturoAuth.getSupabase();
        const { error } = await sb.auth.resetPasswordForEmail(email, {
          redirectTo: 'https://gesturo.fr/reset-password'
        });
        if (error) return { success: false, message: error.message };
        return { success: true };
      } catch (e) { return { success: false, message: e.message }; }
    },
    authLogout: async () => {
      if (!window.__gesturoAuth) return true;
      return window.__gesturoAuth.signOut();
    },
    authCheck: async () => {
      if (!window.__gesturoAuth) return { authenticated: false };
      return window.__gesturoAuth.check();
    },
    onAuthSuccess: on('authSuccess'),
    onAuthNotAllowed: on('authNotAllowed'),
    onAuthExpired: on('authExpired'),
    onAuthRequired: on('authRequired'),

    // ── Supabase user data (delegated to user-data Edge Function) ──
    updateUsername: async (username) => {
      try {
        const sb = await window.__gesturoAuth.getSupabase();
        const { data } = await sb.functions.invoke('user-data', { body: { action: 'updateUsername', payload: { username } } });
        return data || { error: 'failed' };
      } catch (e) { return { error: e.message }; }
    },
    getProfile: async () => {
      try {
        const sb = await window.__gesturoAuth.getSupabase();
        const { data } = await sb.functions.invoke('user-data', { body: { action: 'getProfile' } });
        return data || { error: 'failed' };
      } catch (e) { return { error: e.message }; }
    },
    saveSession: async (sessionData) => {
      try {
        const sb = await window.__gesturoAuth.getSupabase();
        const { data } = await sb.functions.invoke('user-data', { body: { action: 'saveSession', payload: sessionData } });
        return data || { success: false };
      } catch (e) { return { success: false }; }
    },
    getStreak: async () => {
      try {
        const sb = await window.__gesturoAuth.getSupabase();
        const { data } = await sb.functions.invoke('user-data', { body: { action: 'getStreak', payload: { tzOffset: new Date().getTimezoneOffset() } } });
        return data || { streak: 0 };
      } catch (e) { return { streak: 0 }; }
    },
    getFavorites: async () => {
      try {
        const sb = await window.__gesturoAuth.getSupabase();
        const { data } = await sb.functions.invoke('user-data', { body: { action: 'getFavorites' } });
        return (data && data.favs) || [];
      } catch (e) { return []; }
    },
    saveFavorites: async (favs) => {
      try {
        const sb = await window.__gesturoAuth.getSupabase();
        const { data } = await sb.functions.invoke('user-data', { body: { action: 'saveFavorites', payload: favs } });
        return data || { ok: false };
      } catch (e) { return { ok: false }; }
    },
    getSessions: async () => {
      try {
        const sb = await window.__gesturoAuth.getSupabase();
        const { data } = await sb.functions.invoke('user-data', { body: { action: 'getSessions' } });
        return (data && data.sessions) || [];
      } catch (e) { return []; }
    },
    saveBadge: async (badgeId, ts) => {
      try {
        const sb = await window.__gesturoAuth.getSupabase();
        await sb.functions.invoke('user-data', { body: { action: 'saveBadge', payload: { badgeId, ts } } });
      } catch (e) { /* silent */ }
    },
    getBadges: async () => {
      try {
        const sb = await window.__gesturoAuth.getSupabase();
        const { data } = await sb.functions.invoke('user-data', { body: { action: 'getBadges' } });
        return (data && data.badges) || {};
      } catch (e) { return {}; }
    },

    // ── Utilities ──
    openExternal,
    getPaymentLinks: async () => {
      const monthly = 'https://buy.stripe.com/test_dRmdR8cxg6xr7VQ1Yv1ck01';
      const yearly = 'https://buy.stripe.com/test_dRmaEWbtccVP4JEbz51ck02';
      let email = '';
      try {
        const sb = await window.__gesturoAuth.getSupabase();
        const { data } = await sb.auth.getSession();
        email = data?.session?.user?.email || '';
      } catch (e) {}
      const q = email ? '?prefilled_email=' + encodeURIComponent(email) : '';
      return { monthly: monthly + q, yearly: yearly + q };
    },
    refreshProStatus: async () => {
      try {
        const sb = await window.__gesturoAuth.getSupabase();
        const { data } = await sb.functions.invoke('user-data', { body: { action: 'refreshProStatus' } });
        return data || { isPro: false };
      } catch (e) { return { isPro: false }; }
    },
    getAppVersion,
    installUpdate: () => {},
    onUpdateStatus: () => {},
    getInstagramPosts: async () => {
      try {
        const sb = await window.__gesturoAuth.getSupabase();
        const { data, error } = await sb.functions.invoke('list-instagram-posts');
        if (error) throw error;
        return Array.isArray(data) ? data : [];
      } catch (e) {
        console.warn('[shim] getInstagramPosts error', e);
        return [];
      }
    },

    // ── Community ──
    submitCommunityPost: async (postData) => {
      try {
        const sb = await window.__gesturoAuth.getSupabase();
        const { data } = await sb.functions.invoke('user-data', { body: { action: 'submitCommunityPost', payload: postData } });
        return data || { success: false };
      } catch (e) { return { success: false }; }
    },
    moderateCommunityPost: async (postId) => {
      // Mobile sends base64 → moderation happens in submitCommunityPost directly.
      // This is a no-op fallback for safety.
      return { ok: true };
    },
    getFeaturedPost: async () => {
      try {
        const sb = await window.__gesturoAuth.getSupabase();
        const { data } = await sb.functions.invoke('user-data', { body: { action: 'getFeaturedPost' } });
        return data || { current: null, archives: [] };
      } catch (e) { return { current: null, archives: [] }; }
    },
    getCommunityPosts: async () => {
      try {
        const sb = await window.__gesturoAuth.getSupabase();
        const { data } = await sb.functions.invoke('user-data', { body: { action: 'getCommunityPosts' } });
        return data || [];
      } catch (e) { return []; }
    },
    deleteCommunityPost: async (postId) => {
      try {
        const sb = await window.__gesturoAuth.getSupabase();
        const { data } = await sb.functions.invoke('user-data', { body: { action: 'deleteCommunityPost', payload: { postId } } });
        return data || { success: false };
      } catch (e) { return { success: false }; }
    },
    getCommunityLeaderboard: async () => {
      try {
        const sb = await window.__gesturoAuth.getSupabase();
        const { data } = await sb.functions.invoke('user-data', { body: { action: 'getCommunityLeaderboard' } });
        return data || { leaderboard: [] };
      } catch (e) { return { leaderboard: [] }; }
    },
    getMyStats: async () => {
      try {
        const sb = await window.__gesturoAuth.getSupabase();
        const { data } = await sb.functions.invoke('user-data', { body: { action: 'getMyStats' } });
        return data || { postsCount: 0, reactionsGivenCount: 0, challengesCount: 0 };
      } catch (e) { return { postsCount: 0, reactionsGivenCount: 0, challengesCount: 0 }; }
    },
    getActiveAnnouncement: async () => {
      try {
        const sb = await window.__gesturoAuth.getSupabase();
        const { data } = await sb.functions.invoke('user-data', { body: { action: 'getActiveAnnouncement' } });
        return data || { announcement: null };
      } catch (e) { return { announcement: null }; }
    },
    getAppSettings: async () => {
      try {
        const sb = await window.__gesturoAuth.getSupabase();
        const { data } = await sb.functions.invoke('user-data', { body: { action: 'getAppSettings' } });
        return data || { settings: {} };
      } catch (e) { return { settings: {} }; }
    },
    getFeatureFlags: async () => {
      try {
        const sb = await window.__gesturoAuth.getSupabase();
        const { data } = await sb.functions.invoke('user-data', { body: { action: 'getFeatureFlags' } });
        return data || { flags: {} };
      } catch (e) { return { flags: {} }; }
    },
    pingActivity: async () => {
      try {
        const sb = await window.__gesturoAuth.getSupabase();
        await sb.functions.invoke('user-data', { body: { action: 'pingActivity' } });
        return { ok: true };
      } catch (e) { return { ok: false }; }
    },
    logClientError: async (data) => {
      try {
        const sb = await window.__gesturoAuth.getSupabase();
        await sb.functions.invoke('user-data', { body: { action: 'logClientError', payload: data } });
        return { ok: true };
      } catch (e) { return { ok: false }; }
    },
    getReactions: async (postIds) => {
      try {
        const sb = await window.__gesturoAuth.getSupabase();
        const { data } = await sb.functions.invoke('user-data', { body: { action: 'getReactions', payload: { postIds } } });
        return data || { reactions: [] };
      } catch (e) { return { reactions: [] }; }
    },
    toggleReaction: async (postId, emoji) => {
      try {
        const sb = await window.__gesturoAuth.getSupabase();
        const { data } = await sb.functions.invoke('user-data', { body: { action: 'toggleReaction', payload: { postId, emoji } } });
        return data || { toggled: 'error' };
      } catch (e) { return { toggled: 'error' }; }
    },

    // ── Challenges ──
    getChallenges: async () => {
      try {
        const sb = await window.__gesturoAuth.getSupabase();
        const { data } = await sb.functions.invoke('user-data', { body: { action: 'getChallenges' } });
        return data || { challenges: [] };
      } catch (e) { return { challenges: [] }; }
    },
    tagPostToChallenge: async (postId, challengeId) => {
      try {
        const sb = await window.__gesturoAuth.getSupabase();
        const { data } = await sb.functions.invoke('user-data', { body: { action: 'tagPostToChallenge', payload: { postId, challengeId } } });
        return data || { error: 'failed' };
      } catch (e) { return { error: e.message }; }
    },
    triggerDailyChallenge: async () => {
      try {
        const sb = await window.__gesturoAuth.getSupabase();
        const { data } = await sb.functions.invoke('daily-challenge');
        return data || { ok: false };
      } catch (e) { return { ok: false }; }
    },

    // ── Camera (Capacitor plugin, better quality than <input capture>) ──
    // Returns { dataUrl, format } or null if cancelled.
    // Falls back to null if plugin not available (caller should use <input> fallback).
    capturePhoto: async () => {
      const Camera = plugins.Camera;
      if (!Camera || !Camera.getPhoto) return null;
      try {
        const photo = await Camera.getPhoto({
          quality: 90,
          allowEditing: false,
          resultType: 'dataUrl',    // CameraResultType.DataUrl
          source: 'PROMPT',         // CameraSource.Prompt — lets user pick camera or gallery
        });
        return { dataUrl: photo.dataUrl, format: photo.format || 'jpeg' };
      } catch (e) {
        // User cancelled or permission denied
        return null;
      }
    },

    // ── Document Scanner ──
    // iOS    : plugin custom VisionKitScanner (VNDocumentCameraViewController) → base64 direct
    // Android: @capacitor-mlkit/document-scanner (Google MLKit) → file URI à lire
    // Returns { dataUrl, format } or null if cancelled / plugin missing.
    scanDocument: async () => {
      // iOS : VisionKit natif (on reçoit directement du base64)
      if (window.__isIOS) {
        const VK = plugins.VisionKitScanner;
        if (!VK || !VK.scanDocument) {
          alert('Le scan n\'est pas disponible sur cet appareil.');
          return null;
        }
        try {
          const result = await VK.scanDocument();
          const base64 = result?.scannedImages?.[0];
          if (!base64) return null; // user cancelled
          return { dataUrl: 'data:image/jpeg;base64,' + base64, format: 'jpeg' };
        } catch (e) {
          console.warn('[scanDocument iOS] error:', e.message);
          return null;
        }
      }

      // Android : MLKit
      const Scanner = plugins.DocumentScanner;
      if (!Scanner || !Scanner.scanDocument) {
        alert('Le scan de document n\'est pas disponible sur cet appareil.');
        return null;
      }
      try {
        const result = await Scanner.scanDocument({
          pageLimit: 1,
          resultFormats: 'JPEG',
          scannerMode: 'FULL',
          galleryImportAllowed: false,
        });
        const uri = result?.scannedImages?.[0];
        if (!uri) return null;
        if (typeof uri === 'string' && uri.startsWith('data:')) {
          return { dataUrl: uri, format: 'jpeg' };
        }
        // File URI → read via Filesystem
        const FS = plugins.Filesystem;
        if (!FS) return null;
        const file = await FS.readFile({ path: uri });
        return { dataUrl: 'data:image/jpeg;base64,' + file.data, format: 'jpeg' };
      } catch (e) {
        console.warn('[scanDocument Android] error:', e.message);
        return null;
      }
    },

    // ── Share (native share sheet via Capacitor) ──
    shareImage: async ({ imageUrl, text }) => {
      const FS = plugins.Filesystem;
      const SharePlugin = plugins.Share;

      // Debug: identify what's available
      const available = {
        share: !!SharePlugin,
        fs: !!FS,
        allPlugins: Object.keys(plugins),
      };
      console.log('[shareImage] plugins:', JSON.stringify(available));

      if (!FS) {
        return { ok: false, error: 'Filesystem plugin missing. Plugins: ' + available.allPlugins.join(',') };
      }

      try {
        // 1. Get base64 — proxy via Edge Function (iOS CORS blocks direct fetch to R2)
        let base64;
        if (imageUrl.startsWith('data:')) {
          base64 = imageUrl.split(',')[1];
          console.log('[shareImage] using provided data URL, length:', base64.length);
        } else {
          console.log('[shareImage] proxying image via Edge Function...');
          const sb = await window.__gesturoAuth.getSupabase();
          const { data } = await sb.functions.invoke('user-data', {
            body: { action: 'proxyImage', payload: { imageUrl } }
          });
          if (!data || !data.base64) {
            return { ok: false, error: 'proxy failed: ' + (data?.error || 'no data') };
          }
          base64 = data.base64;
          console.log('[shareImage] proxied, base64 length:', base64.length);
        }

        // 2. Write to cache
        const fileName = 'gesturo-drawing-' + Date.now() + '.jpg';
        let saved;
        try {
          saved = await FS.writeFile({
            path: fileName,
            data: base64,
            directory: 'CACHE',
          });
          console.log('[shareImage] saved:', JSON.stringify(saved));
        } catch (fsErr) {
          console.error('[shareImage] FS.writeFile failed:', JSON.stringify(fsErr), fsErr.message, String(fsErr));
          return { ok: false, error: 'writeFile: ' + (fsErr.message || String(fsErr)) };
        }

        // 3. Share via native plugin
        try {
          await SharePlugin.share({
            text: text || '',
            files: [saved.uri],
          });
          return { ok: true };
        } catch (shareErr) {
          console.error('[shareImage] Share.share failed:', JSON.stringify(shareErr), shareErr.message, String(shareErr));
          // If user cancelled, it's not an error
          if (String(shareErr).includes('cancel') || String(shareErr).includes('dismiss')) return { ok: false };
          return { ok: false, error: 'share: ' + (shareErr.message || String(shareErr)) };
        }
      } catch (e) {
        console.error('[shareImage] outer error:', JSON.stringify(e), e.message, String(e));
        return { ok: false, error: String(e) || e.message || 'unknown' };
      }
    },

    // ── Widget (iOS only) — write daily pose data to App Group ──
    updateWidgetData: async ({ imageURL, title, subtitle, challengeId, streak, date }) => {
      if (!window.__isIOS) return { ok: false };
      const Bridge = plugins.GesturoWidgetBridge;
      if (!Bridge || !Bridge.updateDailyPose) return { ok: false };
      try {
        await Bridge.updateDailyPose({ imageURL, title, subtitle, challengeId, streak, date });
        return { ok: true };
      } catch (e) {
        console.warn('[shim] updateWidgetData error', e);
        return { ok: false };
      }
    },
    onDailyPoseDeepLink: on('dailyPoseDeepLink'),
    onChallengeDeepLink: on('challengeDeepLink'),

    // ── Moodboard webview path — N/A on mobile ──
    getMoodboardPreloadPath: async () => null,
    mbListProjects: async () => [],
    mbCreateProject: async () => null,
    mbLoadProject: async () => null,
    mbSaveProject: async () => false,
  };
})();
