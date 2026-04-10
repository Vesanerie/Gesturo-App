const { _electron: electron } = require('playwright');
const path = require('path');

(async () => {
  const app = await electron.launch({
    args: [path.join(__dirname, '..')],
    cwd: path.join(__dirname, '..'),
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(3000);

  const auth = await win.evaluate(async () => window.electronAPI?.authCheck?.());
  console.log('auth:', JSON.stringify(auth));

  // Appeler directement l'IPC listR2Photos
  const r = await win.evaluate(async () => {
    try {
      const photos = await window.electronAPI.listR2Photos({ isPro: false });
      return { ok: true, count: Array.isArray(photos) ? photos.length : 'not-array', type: typeof photos, sample: Array.isArray(photos) ? photos.slice(0, 3) : photos };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  console.log('listR2Photos(isPro=false):', JSON.stringify(r, null, 2));

  const r2 = await win.evaluate(async () => {
    try {
      const photos = await window.electronAPI.listR2Photos({ isPro: true });
      return { ok: true, count: Array.isArray(photos) ? photos.length : 'not-array' };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  console.log('listR2Photos(isPro=true):', JSON.stringify(r2));

  const anims = await win.evaluate(async () => {
    try {
      const a = await window.electronAPI.listR2Animations({ isPro: false });
      return { ok: true, count: Array.isArray(a) ? a.length : 'not-array' };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  console.log('listR2Animations(isPro=false):', JSON.stringify(anims));

  await app.close();
})().catch(e => { console.error('FAIL:', e); process.exit(1); });
