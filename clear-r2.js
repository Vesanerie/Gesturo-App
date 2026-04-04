require('dotenv').config()
const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3')

const client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
})

const BUCKET = process.env.R2_BUCKET

async function clearBucket() {
  console.log('🗑️  Gesturo — Vidage du bucket R2')
  console.log('🪣 Bucket :', BUCKET)
  console.log('')

  let totalDeleted = 0
  let continuationToken = undefined

  do {
    // Lister les fichiers par batch de 1000
    const listCmd = new ListObjectsV2Command({
      Bucket: BUCKET,
      ContinuationToken: continuationToken,
    })
    const listRes = await client.send(listCmd)
    const objects = listRes.Contents || []

    if (objects.length === 0) break

    // Supprimer le batch
    const deleteCmd = new DeleteObjectsCommand({
      Bucket: BUCKET,
      Delete: {
        Objects: objects.map(obj => ({ Key: obj.Key })),
        Quiet: true,
      },
    })
    await client.send(deleteCmd)
    totalDeleted += objects.length
    console.log(`🗑️  ${totalDeleted} fichiers supprimés...`)

    continuationToken = listRes.NextContinuationToken
  } while (continuationToken)

  if (totalDeleted === 0) {
    console.log('✅ Le bucket était déjà vide !')
  } else {
    console.log('')
    console.log(`✅ Bucket vidé ! ${totalDeleted} fichiers supprimés.`)
  }
}

clearBucket().catch(console.error)
