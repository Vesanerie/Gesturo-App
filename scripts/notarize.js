exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context
  if (electronPlatformName !== 'darwin') return

  const { notarize } = await import('@electron/notarize')

  const appName = context.packager.appInfo.productFilename
  const appBundleId = context.packager.config.appId
  const appPath = `${appOutDir}/${appName}.app`

  console.log('APPLE_ID:', process.env.APPLE_ID ? '✅' : '❌')
  console.log('APPLE_TEAM_ID:', process.env.APPLE_TEAM_ID ? '✅' : '❌')
  console.log('APPLE_APP_SPECIFIC_PASSWORD:', process.env.APPLE_APP_SPECIFIC_PASSWORD ? '✅' : '❌')
  console.log('App path:', appPath)
  console.log('Bundle ID:', appBundleId)
  console.log('--- démarrage notarisation ---')

  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('⏰ TIMEOUT notarisation après 15 min')), 15 * 60 * 1000)
  )

  try {
    await Promise.race([
      notarize({
        tool: 'notarytool',
        appBundleId: appBundleId,
        appPath: appPath,
        teamId: process.env.APPLE_TEAM_ID,
        appleId: process.env.APPLE_ID,
        appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
      }),
      timeout
    ])
    console.log('--- notarisation terminée ✅ ---')
  } catch (err) {
    console.error('❌ Erreur notarisation:', err.message)
    throw err
  }
}