// Supabase client for the Electron main process.
// Uses public credentials only (config.js). Auth session is persisted to disk
// via a tiny file-backed storage adapter so the user stays logged in across
// restarts.
const path = require('path')
const fs = require('fs')
const os = require('os')

// Dev convenience: load .env if present (local dev / scripts).
// In a packaged build there is no .env and that's intentional.
try {
  const envPaths = [
    path.join(__dirname, '.env'),
    path.join(process.resourcesPath || '', 'app', '.env'),
  ]
  for (const p of envPaths) {
    if (fs.existsSync(p)) { require('dotenv').config({ path: p }); break }
  }
} catch (e) {}

const { createClient } = require('@supabase/supabase-js')
const config = require('./config')

const supabaseUrl = process.env.SUPABASE_URL || config.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY || config.SUPABASE_PUBLISHABLE_KEY

// ── File-backed storage adapter ──────────────────────────────────────────────
// Supabase auth normally relies on localStorage. In Node we provide a tiny
// JSON-on-disk equivalent so PKCE state + session survive across restarts.
const STORAGE_PATH = path.join(os.homedir(), '.gesturo-supabase-auth.json')

function readStorage() {
  try { return JSON.parse(fs.readFileSync(STORAGE_PATH, 'utf8')) } catch (e) { return {} }
}
function writeStorage(obj) {
  try { fs.writeFileSync(STORAGE_PATH, JSON.stringify(obj), { mode: 0o600 }) } catch (e) {}
}

const fileStorage = {
  getItem(key) {
    const s = readStorage()
    return Object.prototype.hasOwnProperty.call(s, key) ? s[key] : null
  },
  setItem(key, value) {
    const s = readStorage()
    s[key] = value
    writeStorage(s)
  },
  removeItem(key) {
    const s = readStorage()
    delete s[key]
    writeStorage(s)
  },
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storage: fileStorage,
    storageKey: 'gesturo-auth',
  },
})

function clearAuthStorage() {
  try { fs.unlinkSync(STORAGE_PATH) } catch (e) {}
}

module.exports = {
  supabase,
  SUPABASE_URL: supabaseUrl,
  SUPABASE_PUBLISHABLE_KEY: supabaseKey,
  clearAuthStorage,
}
