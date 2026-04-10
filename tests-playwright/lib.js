// Helpers partagés pour les tests Playwright Gesturo
const { _electron: electron } = require('playwright');
const path = require('path');

async function launch() {
  const app = await electron.launch({
    args: [path.join(__dirname, '..')],
    cwd: path.join(__dirname, '..'),
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  // Capture tous les logs renderer
  const logs = [];
  win.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));
  win.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
  // Auto-dismiss alerts (et log leur contenu)
  win.on('dialog', d => { logs.push(`[dialog] ${d.message()}`); d.dismiss().catch(() => {}); });
  // Attendre que R2 ait chargé
  await win.waitForFunction(
    () => typeof allEntries !== 'undefined' && allEntries.length > 0,
    { timeout: 30000 }
  );
  return { app, win, logs };
}

async function selectAllCats(win) {
  await win.evaluate(() => {
    selectedCats = new Set(Object.keys(categories));
  });
}

async function startPoseSession(win, durationSec = 30) {
  // Sélectionner le preset de durée
  await win.evaluate(d => {
    const btns = Array.from(document.querySelectorAll('button'));
    const label = d < 60 ? `${d} sec` : `${d / 60} min`;
    const b = btns.find(x => (x.innerText || '').trim() === label);
    if (b) b.click();
  }, durationSec);
  await selectAllCats(win);
  // Forcer le mode pose
  await win.evaluate(() => { if (typeof switchMainMode === 'function') switchMainMode('pose'); });
  await win.evaluate(() => startSession());
  await win.waitForFunction(
    () => document.querySelector('.screen.active')?.id === 'screen-session',
    { timeout: 10000 }
  );
  // Attendre que btn-next s'active (1re photo prête)
  await win.waitForFunction(
    () => document.getElementById('btn-next') && !document.getElementById('btn-next').disabled,
    { timeout: 20000 }
  );
}

async function snapshotControls(win) {
  return await win.evaluate(() => ({
    screen: document.querySelector('.screen.active')?.id,
    loading: typeof loading !== 'undefined' ? loading : null,
    paused: typeof paused !== 'undefined' ? paused : null,
    currentIndex: typeof currentIndex !== 'undefined' ? currentIndex : null,
    sessionLen: typeof sessionEntries !== 'undefined' ? sessionEntries.length : null,
    btnPrevDisabled: document.getElementById('btn-prev')?.disabled,
    btnNextDisabled: document.getElementById('btn-next')?.disabled,
    btnPauseDisabled: document.getElementById('btn-pause')?.disabled,
  }));
}

function report(name, verdict, details) {
  console.log(`\n── ${name} ──`);
  console.log(`  verdict: ${verdict}`);
  if (details) {
    for (const [k, v] of Object.entries(details)) {
      console.log(`  ${k}: ${JSON.stringify(v)}`);
    }
  }
}

module.exports = { launch, selectAllCats, startPoseSession, snapshotControls, report };
