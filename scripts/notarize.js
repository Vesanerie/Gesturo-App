exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context
  if (electronPlatformName !== 'darwin') return

  const { notarize } = await import('@electron/notarize')

  const appName = context.packager.appInfo.productFilename
  const appBundleId = context.packager.config.appId

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