// Suite de tests Gesturo — lance chaque test dans une instance Electron
// fraîche pour isoler les effets. Agrège les verdicts à la fin.
const { launch, selectAllCats, startPoseSession, snapshotControls, report } = require('./lib');

const results = [];

function record(name, verdict, details) {
  results.push({ name, verdict, details });
  report(name, verdict, details);
}

// ── Bug #1 : contrôles gelés après clic rapide Suiv/Préc ──
async function test_bug1_rapid_nav() {
  const { app, win, logs } = await launch();
  try {
    await startPoseSession(win);
    const before = await snapshotControls(win);
    // Triple-clic Next en rafale + Prev, sans attendre
    await win.evaluate(() => {
      nextPhoto();
      nextPhoto();
      nextPhoto();
      prevPhoto();
    });
    // Attendre que le dust se pose
    await win.waitForTimeout(4000);
    const after = await snapshotControls(win);
    const stuck = after.loading === true || after.btnPauseDisabled === true;
    record('bug1 rapid nav pose', stuck ? 'BUG CONFIRMED' : 'not reproduced', { before, after });
  } finally {
    await app.close();
  }
}

// ── Bug #4 : catégorie vide → startSession silencieux ──
async function test_bug4_empty_cats() {
  const { app, win, logs } = await launch();
  try {
    // Vider selectedCats, appeler startSession, voir si on a un dialog ou rien
    await win.evaluate(() => {
      selectedCats = new Set();
      if (typeof switchMainMode === 'function') switchMainMode('pose');
    });
    const screenBefore = await win.evaluate(() => document.querySelector('.screen.active')?.id);
    await win.evaluate(() => startSession());
    await win.waitForTimeout(1500);
    const screenAfter = await win.evaluate(() => document.querySelector('.screen.active')?.id);
    const alertSeen = logs.some(l => l.startsWith('[dialog]'));
    // Si screen n'a pas changé ET aucun dialog → bug "silencieux".
    // Le code source fait bien un alert() donc on attend un dialog.
    const bug = (screenBefore === screenAfter) && !alertSeen;
    record('bug4 empty cats silent', bug ? 'BUG CONFIRMED' : 'alert shown (ok)', {
      screenBefore, screenAfter, alertSeen,
      dialogs: logs.filter(l => l.startsWith('[dialog]')),
    });
  } finally {
    await app.close();
  }
}

// ── Bug #7 : sessions < 30s loggées à 0 min ──
async function test_bug7_zero_min_session() {
  const { app, win, logs } = await launch();
  try {
    await startPoseSession(win, 30);
    // Terminer la session immédiatement via finishSession() (le vrai nom)
    const hasFinish = await win.evaluate(() => typeof finishSession === 'function');
    if (hasFinish) {
      await win.evaluate(() => finishSession());
    }
    await win.waitForTimeout(1500);
    // Lire l'historique local (clé réelle : gd4_history)
    const lastLog = await win.evaluate(() => {
      try {
        const hist = JSON.parse(localStorage.getItem('gd4_history') || '[]');
        return hist[hist.length - 1] || null;
      } catch (e) { return null; }
    });
    const bug = lastLog && typeof lastLog.minutes === 'number' && lastLog.minutes === 0;
    record('bug7 zero-min session', bug ? 'BUG CONFIRMED' : 'not reproduced (|| 1 fallback works)', {
      hasFinish, lastLog,
    });
  } finally {
    await app.close();
  }
}

// ── Bug #9 : badge PRO reste après logout ──
async function test_bug9_pro_badge_after_logout() {
  const { app, win, logs } = await launch();
  try {
    // Chercher l'élément badge Pro
    const badgeBeforeLogout = await win.evaluate(() => {
      const el = document.querySelector('#pro-badge, .pro-badge, [class*="pro"]');
      return {
        found: !!el,
        text: el?.innerText?.trim() || null,
        visible: el ? el.offsetParent !== null : false,
      };
    });
    // Logout
    const hasLogout = await win.evaluate(() => typeof window.electronAPI?.authLogout === 'function');
    if (hasLogout) {
      await win.evaluate(() => window.electronAPI.authLogout());
      await win.waitForTimeout(1500);
    }
    const badgeAfterLogout = await win.evaluate(() => {
      const el = document.querySelector('#pro-badge, .pro-badge, [class*="pro"]');
      return {
        found: !!el,
        text: el?.innerText?.trim() || null,
        visible: el ? el.offsetParent !== null : false,
      };
    });
    const bug = badgeAfterLogout.visible === true;
    record('bug9 pro badge after logout', bug ? 'BUG CONFIRMED' : 'not reproduced', {
      badgeBeforeLogout, badgeAfterLogout,
    });
  } finally {
    await app.close();
  }
}

// ── Sanity : naviguer entre tous les tabs principaux sans crasher ──
async function test_tabs_navigation() {
  const { app, win, logs } = await launch();
  try {
    const tabs = ['pose', 'anim', 'cinema', 'favs', 'hist', 'community'];
    const visited = {};
    for (const tab of tabs) {
      await win.evaluate(t => { if (typeof switchMainMode === 'function') switchMainMode(t); }, tab);
      await win.waitForTimeout(500);
      visited[tab] = await win.evaluate(() => document.querySelector('.screen.active')?.id);
    }
    const errors = logs.filter(l => l.startsWith('[error]') || l.startsWith('[pageerror]'));
    const bug = errors.length > 0;
    record('sanity tabs navigation', bug ? 'ERRORS FOUND' : 'ok', { visited, errorCount: errors.length, errors: errors.slice(0, 5) });
  } finally {
    await app.close();
  }
}

// ── Bug #2 : animLoopCount pas reset entre séquences ──
async function test_bug2_anim_loop_reset() {
  const { app, win, logs } = await launch();
  try {
    await win.evaluate(() => { if (typeof switchMainMode === 'function') switchMainMode('anim'); });
    await win.waitForTimeout(500);
    // Simuler : set animLoopCount à 5, puis sélectionner une séquence, puis
    // démarrer la session. Le bug est que startAnimSession() ne reset pas
    // animLoopCount à 0.
    const seqs = await win.evaluate(() => (typeof sequences !== 'undefined' ? Object.keys(sequences) : []));
    if (seqs.length === 0) {
      record('bug2 animLoopCount reset', 'SKIPPED (no sequences loaded)', { seqs });
      return;
    }
    await win.evaluate((firstSeq) => {
      animLoopCount = 5;
      selectedSeq = firstSeq;
      if (typeof startAnimSession === 'function') startAnimSession();
    }, seqs[0]);
    await win.waitForTimeout(1000);
    const loopCountAfter = await win.evaluate(() => (typeof animLoopCount !== 'undefined' ? animLoopCount : null));
    const bug = loopCountAfter !== 0;
    record('bug2 animLoopCount reset', bug ? 'BUG CONFIRMED' : 'not reproduced', {
      seqsCount: seqs.length, animLoopCountAfter: loopCountAfter,
    });
  } finally {
    await app.close();
  }
}

(async () => {
  const tests = [
    test_bug1_rapid_nav,
    test_bug2_anim_loop_reset,
    test_bug4_empty_cats,
    test_bug7_zero_min_session,
    test_bug9_pro_badge_after_logout,
    test_tabs_navigation,
  ];

  for (const t of tests) {
    try {
      console.log(`\n${'═'.repeat(60)}\nRUNNING: ${t.name}\n${'═'.repeat(60)}`);
      await t();
    } catch (e) {
      record(t.name, 'TEST CRASHED', { error: e.message });
    }
  }

  console.log(`\n${'═'.repeat(60)}\n  RÉSUMÉ FINAL\n${'═'.repeat(60)}`);
  for (const r of results) {
    const icon = r.verdict === 'BUG CONFIRMED' ? '🔴' :
                 r.verdict === 'ERRORS FOUND' ? '🟠' :
                 r.verdict === 'TEST CRASHED' ? '💥' :
                 r.verdict.startsWith('SKIPPED') ? '⏭️' : '✅';
    console.log(`  ${icon}  ${r.name}: ${r.verdict}`);
  }
})();
