require('dotenv').config()
const { S3Client, ListObjectsV2Command, CopyObjectCommand } = require('@aws-sdk/client-s3')
const fs = require('fs')
const path = require('path')

// ── Config ────────────────────────────────────────────────────────────────────
const R2_ENDPOINT   = process.env.R2_ENDPOINT
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY_ID
const R2_SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY
const R2_BUCKET     = process.env.R2_BUCKET || 'gesturo-photos'
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL
const OPENAI_KEY    = process.env.OPENAI_API_KEY

if (!OPENAI_KEY) {
  console.error('❌ OPENAI_API_KEY manquante dans .env')
  process.exit(1)
}

const client = new S3Client({
  region: 'auto',
  endpoint: R2_ENDPOINT,
  credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY },
})

// ── Catégories cibles ─────────────────────────────────────────────────────────
// L'IA choisira parmi ces catégories exactes
const CATEGORIES = [
  'debout',
  'assis',
  'allonge',
  'jambes',
  'pieds',
  'accroupi',
  'mouvement',
  'foreshortening',
  'mains',
  'visage',
  'buste',
  'dos',
  'nudite',
]

// ── Prompt GPT-4o ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Tu es un assistant spécialisé dans la classification de poses de référence artistique pour le gesture drawing.
Tu réponds UNIQUEMENT en JSON valide, sans markdown, sans explication.`

function buildUserPrompt() {
  return `Analyse cette pose de référence artistique.
Réponds UNIQUEMENT avec ce JSON (rien d'autre) :
{
  "categorie": "<une seule catégorie parmi : ${CATEGORIES.join(', ')}>",
  "difficulte": "<debutant | intermediaire | avance>",
  "tags": ["<tag1>", "<tag2>", "<tag3>"],
  "confiance": <0.0 à 1.0>
}

Règles :
- Si la pose met en valeur les mains → "mains"
- Si le visage est le sujet principal → "visage"
- Si la pose met en valeur les jambes→ "jambes"
- Si le corps est en raccourci perspectif → "foreshortening"
- Si la pose montre nudité → "nudite"
- Sinon choisis selon la position principale du corps
- difficulte : debutant = pose simple et claire, avance = foreshortening/torsion complexe
- tags : 3 mots-clés courts décrivant la pose (ex: "profil", "torsion", "dynamique")`
}

// ── Appel GPT-4o Vision ───────────────────────────────────────────────────────
async function analyzeImage(imageUrl) {
  const https = require('https')

  const body = JSON.stringify({
    model: 'gpt-4o',
    max_tokens: 200,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageUrl, detail: 'low' } },
          { type: 'text', text: buildUserPrompt() }
        ]
      }
    ]
  })

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`,
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          if (parsed.error) return reject(new Error(parsed.error.message))
          const content = parsed.choices?.[0]?.message?.content || ''
          const clean = content.replace(/```json|```/g, '').trim()
          resolve(JSON.parse(clean))
        } catch(e) {
          reject(new Error('Réponse GPT invalide : ' + data.slice(0, 200)))
        }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// ── Lister toutes les photos R2 ───────────────────────────────────────────────
async function listAllPhotos() {
  const photos = []
  let continuationToken = undefined
  do {
    const cmd = new ListObjectsV2Command({
      Bucket: R2_BUCKET,
      Prefix: 'Sessions/current/',
      ContinuationToken: continuationToken,
    })
    const res = await client.send(cmd)
    for (const obj of (res.Contents || [])) {
      const key = obj.Key
      const parts = key.split('/')
      if (parts.length < 4) continue
      const fileName = parts[parts.length - 1]
      if (fileName.startsWith('.')) continue
      const ext = path.extname(fileName).toLowerCase()
      if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) continue
      const currentCat = parts[parts.length - 2]
      photos.push({ key, currentCat, url: `${R2_PUBLIC_URL}/${key}` })
    }
    continuationToken = res.NextContinuationToken
  } while (continuationToken)
  return photos
}

// ── Renommer la clé R2 (copier + supprimer) ───────────────────────────────────
async function moveR2Object(oldKey, newKey) {
  const { DeleteObjectCommand } = require('@aws-sdk/client-s3')

  // Copier vers la nouvelle clé
  await client.send(new CopyObjectCommand({
    Bucket: R2_BUCKET,
    CopySource: `${R2_BUCKET}/${oldKey}`,
    Key: newKey,
  }))

  // Supprimer l'ancienne
  await client.send(new DeleteObjectCommand({
    Bucket: R2_BUCKET,
    Key: oldKey,
  }))
}

// ── Délai pour respecter les rate limits ─────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const DRY_RUN = process.argv.includes('--dry-run')
  const LIMIT   = process.argv.includes('--limit')
    ? parseInt(process.argv[process.argv.indexOf('--limit') + 1])
    : Infinity

  console.log('🤖 Gesturo — Tagging automatique des poses')
  console.log(`🪣 Bucket   : ${R2_BUCKET}`)
  console.log(`🔍 Mode     : ${DRY_RUN ? 'DRY RUN (aucune modification)' : 'LIVE'}`)
  console.log(`📸 Limite   : ${LIMIT === Infinity ? 'toutes' : LIMIT} photos`)
  console.log('')

  // Charger le résultat précédent si existant (reprise)
  const RESULTS_FILE = './tag-results.json'
  let results = []
  try {
    results = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'))
    console.log(`📂 ${results.length} résultats déjà enregistrés — reprise`)
  } catch(e) {}

  const alreadyDone = new Set(results.map(r => r.key))

  // Lister toutes les photos
  console.log('☁️  Lecture du bucket R2...')
  const photos = await listAllPhotos()
  console.log(`   ${photos.length} photos trouvées\n`)

  const toProcess = photos
    .filter(p => !alreadyDone.has(p.key))
    .slice(0, LIMIT)

  console.log(`⚙️  ${toProcess.length} photos à analyser\n`)

  let success = 0, errors = 0, moved = 0

  for (let i = 0; i < toProcess.length; i++) {
    const photo = toProcess[i]
    const progress = `[${i + 1}/${toProcess.length}]`

    process.stdout.write(`${progress} ${photo.key.split('/').pop()} ... `)

    try {
      const analysis = await analyzeImage(photo.url)

      const newCat = analysis.categorie
      const fileName = photo.key.split('/').pop()
      const newKey = `Sessions/current/${newCat}/${fileName}`

      results.push({
        key: photo.key,
        newKey,
        currentCat: photo.currentCat,
        newCat,
        difficulte: analysis.difficulte,
        tags: analysis.tags,
        confiance: analysis.confiance,
        changed: photo.currentCat !== newCat
      })

      const badge = photo.currentCat !== newCat
        ? `✅ ${photo.currentCat} → ${newCat}`
        : `✓  (${newCat})`
      process.stdout.write(`${badge} [confiance: ${analysis.confiance}]\n`)

      // Déplacer dans R2 si catégorie différente
      if (!DRY_RUN && photo.currentCat !== newCat) {
        await moveR2Object(photo.key, newKey)
        moved++
      }

      success++

      // Sauvegarder les résultats à chaque étape (reprise possible)
      fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2))

      // Pause 200ms pour respecter les rate limits OpenAI
      await sleep(200)

    } catch(e) {
      process.stdout.write(`❌ ${e.message}\n`)
      errors++
      await sleep(1000) // Pause plus longue en cas d'erreur
    }
  }

  // ── Résumé ─────────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(60))
  console.log(`✅ Analysées  : ${success}`)
  console.log(`❌ Erreurs    : ${errors}`)
  console.log(`📁 Déplacées  : ${moved}`)
  console.log(`💾 Résultats  : ${RESULTS_FILE}`)

  // Distribution par catégorie
  const dist = {}
  for (const r of results) {
    dist[r.newCat] = (dist[r.newCat] || 0) + 1
  }
  console.log('\n📊 Distribution finale :')
  Object.entries(dist).sort((a, b) => b[1] - a[1]).forEach(([cat, count]) => {
    console.log(`   ${cat.padEnd(20)} ${count} poses`)
  })

  // Poses avec faible confiance
  const lowConfidence = results.filter(r => r.confiance < 0.7)
  if (lowConfidence.length > 0) {
    console.log(`\n⚠️  ${lowConfidence.length} poses avec confiance < 0.7 (à vérifier manuellement)`)
    lowConfidence.forEach(r => {
      console.log(`   ${r.key} → ${r.newCat} (${r.confiance})`)
    })
  }
}

main().catch(console.error)
