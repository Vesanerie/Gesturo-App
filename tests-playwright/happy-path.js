// Happy path end-to-end Gesturo — une seule instance Electron
const { _electron: electron } = require('playwright');
const path = require('path');

const steps = [];
function step(name, ok, details) {
  const icon = ok === true ? '✅' : ok === false ? '❌' : '⚠️';
  console.log(`${icon} ${name}${details ? ' — ' + JSON.stringify(details) : ''}`);
  steps.push({ name, ok, details });
}

(async () => {
  console.log('▶ launching electron...');
  const app = await electron.launch({
    args: [path.join(__dirname, '..')],
    cwd: path.join(__dirname, '..'),
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  const logs = [];
  win.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
  win.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
  win.on('dialog', d => { logs.push(`[dialog] ${d.message()}`); d.dismiss().catch(() => {}); });

  try {
    // 1. Auth
    const auth = await win.evaluate(async () => {
      try { return await window.electronAPI?.authCheck?.(); } catch (e) { return { err: e.message }; }
    });
    step('auth restored', auth?.authenticated === true, { email: auth?.email, isPro: auth?.isPro });

    // 2. Attendre le chargement R2
    console.log('▶ waiting for R2 load (max 30s)...');
    await win.waitForFunction(
      () => typeof allEntries !== 'undefined' && allEntries.length > 0,
      { timeout: 30000 }
    );
    const initState = await win.evaluate(() => ({
      allEntries: allEntries.length,
      categories: Object.keys(categories).length,
      sequences: Object.keys(sequences).length,
    }));
    step('R2 loaded', initState.allEntries > 0, initState);

    // 3. Navigation entre tous les tabs principaux
    const tabs = ['pose', 'anim', 'cinema', 'favs', 'hist', 'community'];
    const screenByTab = {};
    for (const t of tabs) {
      await win.evaluate(mode => { if (typeof switchMainMode === 'function') switchMainMode(mode); }, t);
      await win.waitForTimeout(400);
      screenByTab[t] = await win.evaluate(() => document.querySelector('.screen.active')?.id);
    }
    const allTabsSwitched = Object.values(screenByTab).every(s => s && s !== 'null');
    step('tabs navigation', allTabsSwitched, screenByTab);

    // Revenir sur pose pour la suite
    await win.evaluate(() => { switchMainMode('pose'); });
    await win.waitForTimeout(300);

    // 4. Session Pose : démarrer, avancer, finir
    await win.evaluate(() => {
      selectedCats = new Set(Object.keys(categories));
      // Preset 30s
      const btns = Array.from(document.querySelectorAll('button'));
      const b = btns.find(x => (x.innerText || '').trim() === '30 sec');
      if (b) b.click();
    });
    await win.waitForTimeout(200);
    await win.evaluate(() => startSession());
    await win.waitForFunction(
      () => document.querySelector('.screen.active')?.id === 'screen-session',
      { timeout: 10000 }
    );
    await win.waitForFunction(
      () => document.getElementById('btn-next') && !document.getElementById('btn-next').disabled,
      { timeout: 20000 }
    );
    const poseStart = await win.evaluate(() => ({
      screen: document.querySelector('.screen.active')?.id,
      sessionLen: sessionEntries.length,
      idx: currentIndex,
      imgVisible: document.getElementById('photo-img')?.offsetParent !== null,
    }));
    step('pose session started', poseStart.screen === 'screen-session' && poseStart.imgVisible, poseStart);

    // Avancer quelques poses
    for (let i = 0; i < 3; i++) {
      await win.evaluate(() => nextPhoto());
      await win.waitForFunction(
        () => !document.getElementById('btn-next').disabled,
        { timeout: 10000 }
      );
    }
    const afterNav = await win.evaluate(() => ({
      idx: currentIndex, loading, sessionLog: sessionLog.filter(Boolean).length,
    }));
    step('pose navigation 3 next', afterNav.idx === 3 && afterNav.loading === false, afterNav);

    // Test pause
    await win.evaluate(() => togglePause());
    const paused1 = await win.evaluate(() => paused);
    await win.evaluate(() => togglePause());
    const paused2 = await win.evaluate(() => paused);
    step('pause/resume', paused1 === true && paused2 === false, { afterPause: paused1, afterResume: paused2 });

    // Finir la session
    const histBefore = await win.evaluate(() => JSON.parse(localStorage.getItem('gd4_history') || '[]').length);
    await win.evaluate(() => finishSession());
    await win.waitForFunction(
      () => document.querySelector('.screen.active')?.id === 'screen-recap',
      { timeout: 5000 }
    );
    const recap = await win.evaluate(() => ({
      screen: document.querySelector('.screen.active')?.id,
      statPoses: document.getElementById('stat-poses')?.textContent,
      statTime: document.getElementById('stat-time')?.textContent,
      gridItems: document.querySelectorAll('#recap-grid .recap-item').length,
    }));
    step('pose recap shown', recap.screen === 'screen-recap' && recap.gridItems > 0, recap);

    // Vérifier que l'historique a été loggé
    const histAfter = await win.evaluate(() => JSON.parse(localStorage.getItem('gd4_history') || '[]'));
    const lastHist = histAfter[histAfter.length - 1];
    step('history logged', histAfter.length === histBefore + 1 && lastHist?.type === 'pose', {
      before: histBefore, after: histAfter.length, last: lastHist,
    });
    // Bug #7 audit : vérifier que minutes n'est jamais 0
    step('bug7: minutes >= 1', (lastHist?.minutes || 0) >= 1, { minutes: lastHist?.minutes });

    // 5. Retour à Démarrer
    await win.evaluate(() => showScreen('screen-config'));
    await win.waitForTimeout(300);

    // 6. Animation : vérifier qu'une séquence est sélectionnable et démarre
    await win.evaluate(() => { switchMainMode('anim'); });
    await win.waitForTimeout(500);
    const animState = await win.evaluate(() => ({
      seqsCount: Object.keys(sequences).length,
      selectedSeq: typeof selectedSeq !== 'undefined' ? selectedSeq : null,
    }));
    step('anim sequences available', animState.seqsCount > 0, animState);

    if (animState.seqsCount > 0) {
      // Sélectionner la 1re séquence
      const seqPicked = await win.evaluate(() => {
        const first = Object.keys(sequences)[0];
        selectedSeq = first;
        return first;
      });
      // Démarrer
      await win.evaluate(() => { if (typeof startAnimSession === 'function') startAnimSession(); });
      await win.waitForTimeout(2000);
      const animStart = await win.evaluate(() => ({
        screen: document.querySelector('.screen.active')?.id,
        frames: typeof animFrames !== 'undefined' ? animFrames.length : null,
        looping: typeof animLooping !== 'undefined' ? animLooping : null,
      }));
      step('anim session started', animStart.screen === 'screen-anim', { seqPicked, ...animStart });

      // Quitter l'anim proprement pour ne pas laisser d'interval
      await win.evaluate(() => {
        if (typeof exitAnimSession === 'function') exitAnimSession();
        else showScreen('screen-config');
      });
      await win.waitForTimeout(300);
    }

    // 7. Favoris : ajouter + retirer programmatiquement, vérifier que l'UI suit
    await win.evaluate(() => { switchMainMode('favs'); });
    await win.waitForTimeout(500);
    const favsBefore = await win.evaluate(() => JSON.parse(localStorage.getItem('gd4_favs') || '[]').length);
    // Ajouter un faux favori via addFav
    const testSrc = 'https://example.com/test-fav.jpg';
    await win.evaluate(src => { if (typeof addFav === 'function') addFav(src, 'test-fav'); }, testSrc);
    const favsAfterAdd = await win.evaluate(() => JSON.parse(localStorage.getItem('gd4_favs') || '[]').length);
    await win.evaluate(src => { if (typeof removeFav === 'function') removeFav(src); }, testSrc);
    const favsAfterRemove = await win.evaluate(() => JSON.parse(localStorage.getItem('gd4_favs') || '[]').length);
    step('favs add/remove', favsAfterAdd === favsBefore + 1 && favsAfterRemove === favsBefore, {
      before: favsBefore, afterAdd: favsAfterAdd, afterRemove: favsAfterRemove,
    });

    // 8. Streak
    await win.evaluate(() => { switchMainMode('hist'); });
    await win.waitForTimeout(800);
    const streakState = await win.evaluate(() => ({
      localStreak: document.getElementById('hist-streak')?.textContent,
      totalSessions: document.getElementById('hist-total-sessions')?.textContent,
      totalMins: document.getElementById('hist-total-mins')?.textContent,
    }));
    step('history screen renders', !!streakState.localStreak, streakState);

    // 9. Moodboard desktop (webview)
    await win.evaluate(() => { if (typeof openMoodboard === 'function') openMoodboard(); });
    await win.waitForTimeout(1500);
    const mbState = await win.evaluate(() => ({
      screen: document.querySelector('.screen.active')?.id,
      webviewPresent: !!document.querySelector('webview'),
    }));
    step('moodboard opens', mbState.screen === 'screen-moodboard', mbState);

    // 10. Check final errors
    const errors = logs.filter(l => l.startsWith('[error]') || l.startsWith('[pageerror]'));
    step('no console errors', errors.length === 0, { errorCount: errors.length, firstErrors: errors.slice(0, 5) });

  } catch (e) {
    console.log('💥 test crashed:', e.message);
    step('test crashed', false, { error: e.message });
    // Dump diagnostic state
    try {
      const diag = await win.evaluate(() => ({
        screen: document.querySelector('.screen.active')?.id,
        allEntries: typeof allEntries !== 'undefined' ? allEntries.length : 'undef',
        isR2Mode: typeof isR2Mode !== 'undefined' ? isR2Mode : 'undef',
        currentUserIsPro: typeof currentUserIsPro !== 'undefined' ? currentUserIsPro : 'undef',
        r2StatusText: document.getElementById('r2-status')?.textContent,
        fileCountText: document.getElementById('file-count')?.textContent,
      }));
      console.log('DIAG:', JSON.stringify(diag, null, 2));
    } catch {}
    console.log('\n--- last 30 renderer logs ---');
    logs.slice(-30).forEach(l => console.log(l));
  }

  // Résumé
  console.log('\n════════ RÉSUMÉ ════════');
  const okCount = steps.filter(s => s.ok === true).length;
  const koCount = steps.filter(s => s.ok === false).length;
  console.log(`${okCount} OK / ${koCount} KO / ${steps.length} total`);
  if (koCount > 0) {
    console.log('\nÉchecs :');
    steps.filter(s => !s.ok).forEach(s => console.log(`  ❌ ${s.name}: ${JSON.stringify(s.details)}`));
  }

  await win.screenshot({ path: '/tmp/gesturo-happy-path-final.png' });
  await app.close();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
