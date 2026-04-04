exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context
  if (electronPlatformName !== 'darwin') return

  const { notarize } = await import('@electron/notarize')
  const { build } = await import('../package.json', { assert: { type: 'json' } })

  const appName = context.packager.appInfo.productFilename

  console.log('--- démarrage notarisation ---')

  await notarize({
    tool: 'notarytool',
    appBundleId: build.appId,
    appPath: `${appOutDir}/${appName}.app`,
    teamId: process.env.APPLE_TEAM_ID,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
  })

  console.log('--- notarisation terminée ---')
}