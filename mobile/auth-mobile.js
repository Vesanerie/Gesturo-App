// Mobile auth implementation backed by Supabase Auth + Capacitor Browser/App.
// Loaded by index.html (injected by sync-web.js) BEFORE mobile-shim.js.
// Exposes window.__gesturoAuth { signIn, signOut, check, init } which the
// shim wires onto window.electronAPI.
(function () {
  if (typeof window === 'undefined') return;

  const REDIRECT_URL = 'com.gesturo.app://auth-callback';
  const BETA_LANDING = 'https://gesturo.art';

  let supabasePromise = null;
  function getSupabase() {
    if (!supabasePromise) {
      supabasePromise = (async () => {
        const cfg = window.__SUPABASE_CONFIG || {};
        if (!cfg.url || !cfg.key) {
          throw new Error('Missing window.__SUPABASE_CONFIG (supabase-config.js not generated)');
        }
        const mod = await import('https://esm.sh/@supabase/supabase-js@2');
        return mod.createClient(cfg.url, cfg.key, {
          auth: {
            flowType: 'pkce',
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: false,
          },
        });
      })();
    }
    return supabasePromise;
  }

  // whitelist.json removed from mobile build (P0 audit) — auth checks via Supabase only

  async function isEmailAllowed(email) {
    if (!email) return false;
    try {
      const sb = await getSupabase();
      const { data } = await sb.from('waitlist').select('email,approved').eq('email', email).maybeSingle();
      if (data && data.approved) return true;
      // Fallback: user already has a profile
      const { data: profile } = await sb.from('profiles').select('email').eq('email', email.toLowerCase()).maybeSingle();
      return !!profile;
    } catch (e) {
      return false;
    }
  }

  async function isBetaExpired() {
    // Beta expiry now managed server-side — no local file on mobile
    return false;
  }

  // Resolve a profile from a Supabase user → mirrors desktop semantics.
  async function buildProfile(user) {
    const email = user.email;
    if (await isBetaExpired()) {
      return { authenticated: false, reason: 'expired', landingUrl: BETA_LANDING, email };
    }
    if (!(await isEmailAllowed(email))) {
      return { authenticated: false, reason: 'not_allowed', email };
    }
    let isPro = false;
    try {
      const sb = await getSupabase();
      // Mirror desktop semantics (cf. resolveIsPro in supabase/functions/_shared/r2.ts):
      // plan === 'pro' et pro_expires_at non dépassé.
      const { data } = await sb.from('profiles').select('plan,pro_expires_at').eq('email', email).maybeSingle();
      if (data && data.plan === 'pro') {
        isPro = !data.pro_expires_at || new Date(data.pro_expires_at) > new Date();
      }
    } catch (e) {}
    return {
      authenticated: true,
      email,
      name: user.user_metadata?.full_name || user.user_metadata?.name || email,
      picture: user.user_metadata?.avatar_url || user.user_metadata?.picture || null,
      isAdmin: false,
      isPro,
    };
  }

  async function signIn() {
    try {
      const sb = await getSupabase();
      const { data, error } = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: REDIRECT_URL, skipBrowserRedirect: true },
      });
      if (error) throw error;
      const Browser = window.Capacitor?.Plugins?.Browser;
      if (!Browser) {
        window.location.href = data.url;
        return { success: true, pending: true };
      }
      await Browser.open({ url: data.url, presentationStyle: 'popover' });
      return { success: true, pending: true };
    } catch (e) {
      console.error('[auth-mobile] signIn error', e);
      return { success: false, reason: 'error', message: e.message };
    }
  }

  async function signOut() {
    try {
      const sb = await getSupabase();
      await sb.auth.signOut();
    } catch (e) {}
    window.__mobileBus?.emit('authRequired');
    return true;
  }

  async function check() {
    try {
      const sb = await getSupabase();
      const { data } = await sb.auth.getSession();
      const user = data?.session?.user;
      if (!user) return { authenticated: false };
      const profile = await buildProfile(user);
      return profile;
    } catch (e) {
      return { authenticated: false };
    }
  }

  // Handle the OAuth callback deep link: extract ?code=... and exchange.
  async function handleCallback(url) {
    try {
      const sb = await getSupabase();
      const u = new URL(url);
      const code = u.searchParams.get('code');
      if (!code) return;
      const { error } = await sb.auth.exchangeCodeForSession(code);
      try { await window.Capacitor?.Plugins?.Browser?.close(); } catch (e) {}
      if (error) {
        window.__mobileBus?.emit('authRequired');
        return;
      }
      const profile = await check();
      if (profile.authenticated) {
        window.__mobileBus?.emit('authSuccess', profile);
        window.__mobileBus?.emit('useR2Mode', { isPro: profile.isPro });
      } else if (profile.reason === 'expired') {
        window.__mobileBus?.emit('authExpired', profile);
      } else if (profile.reason === 'not_allowed') {
        window.__mobileBus?.emit('authNotAllowed', profile);
      } else {
        window.__mobileBus?.emit('authRequired');
      }
    } catch (e) {
      console.error('[auth-mobile] handleCallback error', e);
    }
  }

  async function init() {
    const App = window.Capacitor?.Plugins?.App;
    if (App?.addListener) {
      App.addListener('appUrlOpen', (event) => {
        if (event?.url && event.url.startsWith('com.gesturo.app://')) {
          handleCallback(event.url);
        }
      });
    }
    // On boot, replay current session into the bus so the renderer hydrates.
    const profile = await check();
    if (profile.authenticated) {
      window.__mobileBus?.emit('authSuccess', profile);
      window.__mobileBus?.emit('useR2Mode', { isPro: profile.isPro });
    } else if (profile.reason === 'expired') {
      window.__mobileBus?.emit('authExpired', profile);
    } else if (profile.reason === 'not_allowed') {
      window.__mobileBus?.emit('authNotAllowed', profile);
    } else {
      window.__mobileBus?.emit('authRequired');
    }
  }

  window.__gesturoAuth = { signIn, signOut, check, init, buildProfile, getSupabase };
})();
