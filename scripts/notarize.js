exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context
  if (electronPlatformName !== 'darwin') return

  const { notarize } = await import('@electron/notarize')

  const appName = context.packager.appInfo.productFilename
  const appBundleId = context.packager.config.appId

  // --- DEBUG : vérifie que les variables existent ---
console.log('APPLE_ID:', process.env.APPLE_ID ? '✅ défini' : '❌ VIDE')
console.log('APPLE_TEAM_ID:', process.env.APPLE_TEAM_ID ? '✅ défini' : '❌ VIDE')
console.log('APPLE_APP_SPECIFIC_PASSWORD:', process.env.APPLE_APP_SPECIFIC_PASSWORD ? '✅ défini' : '❌ VIDE')
  console.log('App path:', `${appOutDir}/${appName}.app`)

  console.log('--- démarrage notarisation ---')

  await notarize({
    tool: 'notarytool',
    appBundleId: appBundleId,
    appPath: `${appOutDir}/${appName}.app`,
    teamId: process.env.APPLE_TEAM_ID,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
  })

  console.log('--- notarisation terminée ---')
}