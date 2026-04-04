const path = require('path')
const fs = require('fs')

// Cherche le .env dans plusieurs emplacements possibles
const envPaths = [
  path.join(__dirname, '.env'),
  path.join(process.resourcesPath || '', 'app', '.env'),
  path.join(process.resourcesPath || '', 'app.asar', '.env'),
]

for (const p of envPaths) {
  if (fs.existsSync(p)) {
    require('dotenv').config({ path: p })
    break
  }
}

const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY

const supabase = createClient(supabaseUrl, supabaseKey)

module.exports = { supabase }