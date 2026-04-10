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
        const { data } = await sb.functions.invoke('user-data', { body: { action: 'getStreak' } });
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
    getCommunityPosts: async () => {
      try {
        const sb = await window.__gesturoAuth.getSupabase();
        const { data } = await sb.functions.invoke('user-data', { body: { action: 'getCommunityPosts' } });
        return data || [];
      } catch (e) { return []; }
    },
    deleteCommunityPost: async (id) => {
      try {
        const sb = await window.__gesturoAuth.getSupabase();
        const { data } = await sb.functions.invoke('user-data', { body: { action: 'deleteCommunityPost', payload: { id } } });
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

    // ── Moodboard webview path — N/A on mobile ──
    getMoodboardPreloadPath: async () => null,
  };
})();
