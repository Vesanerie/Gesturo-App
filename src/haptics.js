// ══ HAPTICS — retour tactile natif (Capacitor uniquement) ══
// No-op silencieux sur desktop Electron.
const _haptics = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics) || null

function hapticLight() {
  if (_haptics) _haptics.impact({ style: 'LIGHT' }).catch(() => {})
}
function hapticMedium() {
  if (_haptics) _haptics.impact({ style: 'MEDIUM' }).catch(() => {})
}
function hapticSuccess() {
  if (_haptics) _haptics.notification({ type: 'SUCCESS' }).catch(() => {})
}
