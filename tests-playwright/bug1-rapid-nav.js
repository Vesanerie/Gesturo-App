// Bug #1 — contrôles gelés après clic rapide Suivant/Précédent
// Hypothèse : `loading=true` reste bloqué si on navigue pendant le chargement
// d'une image, parce que `onPoseReady()` ne remet `loading=false` que si
// l'image actuelle finit de charger.
const { _electron: electron } = require('playwright');
const path = require('path');

(async () => {
  const app = await electron.launch({
    args: [path.join(__dirname, '..')],
    cwd: path.join(__dirname, '..'),
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  // Attendre que loadR2 ait peuplé allEntries (peut prendre ~5-15s)
  await win.waitForFunction(
    () => typeof allEntries !== 'undefined' && allEntries.length > 0,
    { timeout: 30000 }
  );
  await win.waitForTimeout(500);

  // Capture console logs from the renderer for debugging
  const logs = [];
  win.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));

  // Sanity check: on est bien sur screen-config
  const screen1 = await win.evaluate(() => document.querySelector('.screen.active')?.id);
  console.log('start screen:', screen1);

  // Sélectionner une durée courte (on prend 30s)
  await win.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const b = btns.find(x => (x.innerText || '').trim() === '30 sec');
    if (b) b.click();
    return !!b;
  });
  await win.waitForTimeout(200);

  // Forcer le mode "pose" (au cas où on serait sur un autre tab)
  await win.evaluate(() => {
    if (typeof switchMainMode === 'function') switchMainMode('pose');
  });
  await win.waitForTimeout(500);

  // S'assurer qu'au moins une catégorie est sélectionnée.
  // On regarde l'état interne d'app.js via les globals.
  const preStart = await win.evaluate(() => {
    return {
      allEntries: typeof allEntries !== 'undefined' ? allEntries.length : 'undef',
      btnStartDisabled: document.getElementById('btn-start')?.disabled,
    };
  });
  console.log('pre-start state:', preStart);

  if (preStart.btnStartDisabled) {
    // Auto-sélectionner la première catégorie disponible si rien n'est coché
    await win.evaluate(() => {
      const firstCat = document.querySelector('.cat-chip:not(.selected), .category-btn:not(.selected), [data-cat]:not(.selected)');
      if (firstCat) firstCat.click();
    });
    await win.waitForTimeout(500);
    // Sinon essayer toggleCategory('Femme') etc. via une fonction globale
    await win.evaluate(() => {
      if (typeof selectAllCategories === 'function') selectAllCategories();
    });
    await win.waitForTimeout(500);
  }

  const preStart2 = await win.evaluate(() => ({
    btnStartDisabled: document.getElementById('btn-start')?.disabled,
    allEntries: typeof allEntries !== 'undefined' ? allEntries.length : 'undef',
  }));
  console.log('pre-start state 2:', preStart2);

  if (preStart2.btnStartDisabled) {
    console.log('❌ btn-start still disabled, cannot start session. Dumping visible categories.');
    const cats = await win.evaluate(() => {
      return Array.from(document.querySelectorAll('#cat-list *, .cat-container *, .categories *'))
        .slice(0, 30)
        .map(e => ({ tag: e.tagName, cls: e.className, txt: (e.innerText || '').trim().slice(0, 40) }))
        .filter(e => e.txt);
    });
    console.log('cats:', cats);
    await win.screenshot({ path: '/tmp/gesturo-bug1-blocked.png' });
    await app.close();
    return;
  }

  // Auto-dismiss any alerts (startSession alerts si aucune catégorie)
  win.on('dialog', d => { console.log('dialog:', d.message()); d.dismiss(); });

  // Sélectionner toutes les catégories manuellement
  await win.evaluate(() => {
    selectedCats = new Set(Object.keys(categories));
    console.log('selectedCats size:', selectedCats.size);
  });

  // Démarre la session (appel direct pour éviter problèmes de visibilité)
  await win.evaluate(() => startSession());
  await win.waitForFunction(
    () => document.querySelector('.screen.active')?.id === 'screen-session',
    { timeout: 10000 }
  );
  const screen2 = await win.evaluate(() => document.querySelector('.screen.active')?.id);
  console.log('after start screen:', screen2);

  // Attendre la première photo chargée : loading devient true puis false,
  // et btn-next s'active
  await win.waitForFunction(
    () => document.getElementById('btn-next') && !document.getElementById('btn-next').disabled,
    { timeout: 20000 }
  );
  const state0 = await win.evaluate(() => ({
    loading,
    paused,
    idx: typeof currentIndex !== 'undefined' ? currentIndex : null,
    sessionLen: typeof sessionEntries !== 'undefined' ? sessionEntries.length : null,
    btnPrev: document.getElementById('btn-prev')?.disabled,
    btnNext: document.getElementById('btn-next')?.disabled,
    btnPause: document.getElementById('btn-pause')?.disabled,
  }));
  console.log('state after 1st photo load:', state0);

  // ── LE TEST DU BUG ──
  // Appelle nextPhoto() puis prevPhoto() directement en rafale, sans laisser
  // le temps à la 2e image de charger. Reproduit un double-clic très rapide.
  await win.evaluate(() => {
    nextPhoto();
    // Micro-pause synchrone pour simuler un vrai double clic humain (~20ms)
    const t0 = performance.now();
    while (performance.now() - t0 < 30) {}
    prevPhoto();
  });
  console.log('rapid next+prev dispatched');

  // Attendre un peu que le dust se pose
  await win.waitForTimeout(5000);

  const stateAfter = await win.evaluate(() => ({
    loading,
    paused,
    idx: typeof currentIndex !== 'undefined' ? currentIndex : null,
    btnPrev: document.getElementById('btn-prev')?.disabled,
    btnNext: document.getElementById('btn-next')?.disabled,
    btnPause: document.getElementById('btn-pause')?.disabled,
  }));
  console.log('state 5s after rapid nav:', stateAfter);

  await win.screenshot({ path: '/tmp/gesturo-bug1-after.png' });

  // Verdict
  if (stateAfter.loading === true || stateAfter.btnPause === true) {
    console.log('\n🔴 BUG CONFIRMED: loading/controls stuck after rapid nav');
    console.log('  loading:', stateAfter.loading, '  btn-pause disabled:', stateAfter.btnPause);
  } else {
    console.log('\n✅ No stuck state detected after rapid nav');
  }

  console.log('\n--- last 20 console logs ---');
  logs.slice(-20).forEach(l => console.log(l));

  await app.close();
})().catch(e => { console.error('FAIL:', e); process.exit(1); });
