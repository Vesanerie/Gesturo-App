const fs = require('fs')
const path = require('path')

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context
  if (electronPlatformName !== 'darwin') return

  const { notarize } = await import('@electron/notarize')

  const appName = context.packager.appInfo.productFilename
  const appBundleId = context.packager.config.appId
  const appPath = `${appOutDir}/${appName}.app`

  // Écrire la clé API dans un fichier temporaire
  const apiKeyDir = path.join(process.env.HOME, 'private_keys')
  fs.mkdirSync(apiKeyDir, { recursive: true })

  const keyFile = path.join(apiKeyDir, `AuthKey_${process.env.APPLE_API_KEY_ID}.p8`)
  fs.writeFileSync(keyFile, Buffer.from(process.env.APPLE_API_KEY, 'base64'))

  console.log('API Key ID:', process.env.APPLE_API_KEY_ID ? '✅' : '❌')
  console.log('API Issuer:', process.env.APPLE_API_ISSUER ? '✅' : '❌')
  console.log('API Key file:', fs.existsSync(keyFile) ? '✅' : '❌')
  console.log('App path:', appPath)
  console.log('--- démarrage notarisation ---')

  try {
    await notarize({
      tool: 'notarytool',
      appBundleId: appBundleId,
      appPath: appPath,
      appleApiKey: keyFile,
      appleApiKeyId: process.env.APPLE_API_KEY_ID,
      appleApiIssuer: process.env.APPLE_API_ISSUER,
    })
    console.log('--- notarisation terminée ✅ ---')
  } catch (err) {
    console.error('❌ Erreur notarisation:', err.message)
    throw err
  }
}