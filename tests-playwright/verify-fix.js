// Vérifie que le fix affiche bien un message d'erreur visible au user
// quand l'Edge Function renvoie 401.
const { _electron: electron } = require('playwright');
const path = require('path');

(async () => {
  const app = await electron.launch({
    args: [path.join(__dirname, '..')],
    cwd: path.join(__dirname, '..'),
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  // Auto-dismiss any dialog
  win.on('dialog', d => { console.log('[dialog]', d.message()); d.dismiss().catch(() => {}); });

  // Attendre que loadR2 ait eu le temps de throw et d'afficher l'erreur
  await win.waitForTimeout(5000);

  const state = await win.evaluate(() => ({
    fileCount: document.getElementById('file-count')?.textContent,
    r2Status: document.getElementById('r2-status')?.textContent,
    btnStartDisabled: document.getElementById('btn-start')?.disabled,
    allEntries: typeof allEntries !== 'undefined' ? allEntries.length : 'undef',
  }));
  console.log('UI state after loadR2 error:', JSON.stringify(state, null, 2));

  await win.screenshot({ path: '/tmp/gesturo-fix-verify.png' });
  await app.close();
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
