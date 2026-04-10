// Reconnaissance Gesturo — lance Electron, identifie l'état initial
const { _electron: electron } = require('playwright');
const path = require('path');

(async () => {
  const app = await electron.launch({
    args: [path.join(__dirname, '..')],
    cwd: path.join(__dirname, '..'),
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  // Laisse le temps à l'auth init + R2 de se stabiliser
  await win.waitForTimeout(3000);

  const activeScreen = await win.evaluate(() => {
    const el = document.querySelector('.screen.active');
    return el ? el.id : null;
  });

  const authInfo = await win.evaluate(async () => {
    try {
      const r = await window.electronAPI?.authCheck?.();
      return r || null;
    } catch (e) { return 'err:' + e.message; }
  });

  const buttons = await win.evaluate(() => {
    return Array.from(document.querySelectorAll('button'))
      .filter(b => b.offsetParent !== null)
      .slice(0, 40)
      .map(b => ({
        id: b.id || null,
        text: (b.innerText || '').trim().slice(0, 50),
        onclick: b.getAttribute('onclick') || null,
      }));
  });

  console.log('active_screen:', activeScreen);
  console.log('auth:', JSON.stringify(authInfo));
  console.log(`visible_buttons: ${buttons.length}`);
  buttons.forEach(b => console.log(' -', JSON.stringify(b)));

  await win.screenshot({ path: '/tmp/gesturo-recon.png', fullPage: false });
  console.log('screenshot: /tmp/gesturo-recon.png');

  await app.close();
})().catch(e => { console.error('FAIL:', e); process.exit(1); });
