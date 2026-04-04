require('dotenv').config()
const { S3Client, PutObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3')
const fs = require('fs')
const path = require('path')
const os = require('os')

const client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
})

const BUCKET = process.env.R2_BUCKET
const LOCAL_ROOT = path.join(os.homedir(), 'Desktop', 'Gesturo Photos')
const SUPPORTED = ['.jpg', '.jpeg', '.png', '.gif', '.webp']
const MIME_MAP = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp'
}

console.log('🔍 Gesturo — Upload différentiel')
console.log('📁 Dossier local :', LOCAL_ROOT)
console.log('🪣 Bucket R2     :', BUCKET)
console.log('')

// ── 1. Lister tous les fichiers déjà dans R2 ──────────────────────────────────
async function listR2Keys() {
  const keys = new Set()
  let continuationToken = undefined
  do {
    const cmd = new ListObjectsV2Command({
      Bucket: BUCKET,
      ContinuationToken: continuationToken,
    })
    const res = await client.send(cmd)
    for (const obj of (res.Contents || [])) keys.add(obj.Key)
    continuationToken = res.NextContinuationToken
  } while (continuationToken)
  return keys
}

// ── 2. Lister tous les fichiers locaux ───────────────────────────────────────
function listLocalFiles(dir, prefix = '') {
  const files = []
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch(e) { return files }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const fullPath = path.join(dir, entry.name)
    const key = prefix ? `${prefix}/${entry.name}` : entry.name

    if (entry.isDirectory()) {
      files.push(...listLocalFiles(fullPath, key))
    } else {
      const ext = path.extname(entry.name).toLowerCase()
      if (!SUPPORTED.includes(ext)) continue
      files.push({ fullPath, key })
    }
  }
  return files
}

// ── 3. Uploader un fichier ────────────────────────────────────────────────────
async function uploadFile(fullPath, key) {
  const body = fs.readFileSync(fullPath)
  const ext = path.extname(fullPath).toLowerCase()
  await client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: MIME_MAP[ext] || 'application/octet-stream',
  }))
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  // Vérifier que le dossier local existe
  if (!fs.existsSync(LOCAL_ROOT)) {
    console.error('❌ Dossier introuvable :', LOCAL_ROOT)
    process.exit(1)
  }

  // Lister R2
  console.log('☁️  Lecture de R2...')
  const r2Keys = await listR2Keys()
  console.log(`   ${r2Keys.size} fichiers déjà dans R2`)

  // Lister local
  console.log('💻 Lecture des fichiers locaux...')
  const localFiles = listLocalFiles(LOCAL_ROOT)
  console.log(`   ${localFiles.length} fichiers trouvés en local`)
  console.log('')

  // Trouver ce qui manque
  const toUpload = localFiles.filter(f => !r2Keys.has(f.key))

  if (toUpload.length === 0) {
    console.log('✅ Tout est déjà à jour ! Rien à uploader.')
    return
  }

  console.log(`⬆️  ${toUpload.length} fichier(s) à uploader (${localFiles.length - toUpload.length} déjà présents)`)
  console.log('')

  // Uploader
  let success = 0
  let errors = 0
  for (const file of toUpload) {
    process.stdout.write(`⬆️  ${file.key} ... `)
    try {
      await uploadFile(file.fullPath, file.key)
      process.stdout.write('✅\n')
      success++
    } catch(e) {
      process.stdout.write(`❌ ${e.message}\n`)
      errors++
    }
  }

  console.log('')
  console.log(`🎉 Upload terminé ! ${success} réussis, ${errors} erreurs.`)
}

main().catch(console.error)