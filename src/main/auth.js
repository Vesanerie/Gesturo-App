const path = require('path')
const fs = require('fs')
const os = require('os')

const REDIRECT_URI = 'http://localhost:9876/auth/callback'
const ADMIN_MARKER_PATH = path.join(os.homedir(), '.gesturo-admin')
const WHITELIST_PATH = path.join(__dirname, '..', '..', 'whitelist.json')
const BETA_LANDING = 'https://gesturo.art'

// WARNING: These are TEST MODE links (test_ prefix). Replace with production
// Stripe Payment Links before any public release.
const STRIPE_LINK_MONTHLY = 'https://buy.stripe.com/test_dRmdR8cxg6xr7VQ1Yv1ck01'
const STRIPE_LINK_YEARLY = 'https://buy.stripe.com/test_dRmaEWbtccVP4JEbz51ck02'

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

async function isEmailAllowed(email, supabase) {
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

async function checkProFromSupabase(email, supabase) {
  try {
    const { data } = await supabase
      .from('profiles')
      .select('plan, pro_expires_at')
      .eq('email', email.toLowerCase())
      .single()
    if (!data) return false
    if (data.plan !== 'pro') return false
    if (data.pro_expires_at && new Date(data.pro_expires_at) < new Date()) return false
    return true
  } catch(e) {
    console.warn('checkProFromSupabase error:', e.message)
    return false
  }
}

function isBetaExpired() {
  const { expires } = getWhitelistData()
  if (!expires) return false
  return new Date() > new Date(expires + 'T23:59:59')
}

function isAdminMode() {
  try { return fs.existsSync(ADMIN_MARKER_PATH) } catch (e) { return false }
}
function loadToken() { return isAdminMode() ? { email: 'admin' } : null }
function isAdminToken(token) { return token && token.email === 'admin' }
function setAdminMode() {
  try { fs.writeFileSync(ADMIN_MARKER_PATH, '1', { mode: 0o600 }) } catch (e) {}
}
function clearAdminMode() {
  try { fs.unlinkSync(ADMIN_MARKER_PATH) } catch (e) {}
}

async function buildProfile(user, supabase) {
  const email = user.email
  if (isBetaExpired()) return { authenticated: false, reason: 'expired', landingUrl: BETA_LANDING }
  if (!await isEmailAllowed(email, supabase)) return { authenticated: false, reason: 'not_allowed', email }
  let isPro = isProEmail(email)
  try {
    if (!isPro) {
      const supabasePro = await checkProFromSupabase(email, supabase)
      if (supabasePro) isPro = true
    }
  } catch (e) {}
  let username = user.user_metadata?.username || null
  try {
    const { data: prof } = await supabase.from('profiles').select('username').eq('email', email).maybeSingle()
    if (prof?.username) username = prof.username
  } catch (e) {}
  return {
    authenticated: true,
    email,
    name: user.user_metadata?.full_name || user.user_metadata?.name || email,
    username: username || email.split('@')[0],
    picture: user.user_metadata?.avatar_url || user.user_metadata?.picture || null,
    isAdmin: false,
    isPro,
  }
}

module.exports = {
  REDIRECT_URI, ADMIN_MARKER_PATH, BETA_LANDING,
  STRIPE_LINK_MONTHLY, STRIPE_LINK_YEARLY,
  getWhitelistData, isEmailAllowedLocal, isEmailAllowed,
  isProEmail, checkProFromSupabase, isBetaExpired,
  isAdminMode, loadToken, isAdminToken, setAdminMode, clearAdminMode,
  buildProfile,
}
