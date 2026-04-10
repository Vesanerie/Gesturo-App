#!/usr/bin/env node
/**
 * scripts/smoke-test.js
 *
 * Lance Electron via Playwright et vérifie en <30s que l'app démarre sans
 * crash et arrive à l'écran Config (= la "home"). À lancer avant chaque
 * release DMG, ou dans un hook CI si un jour on en met un.
 *
 * Usage :
 *   npm run smoke
 *
 * Exit code 0 = tout vert, 1 = KO (et raison affichée).
 *
 * Ce qu'on teste :
 *   1. Electron démarre sans erreur fatale (pas de throw dans main.js)
 *   2. La fenêtre principale s'ouvre et son DOM se charge
 *   3. #screen-config existe ET a la classe .active (= home visible)
 *   4. Aucune erreur JS critique dans la console du renderer
 *   5. window.electronAPI est bien exposé (preload OK)
 *
 * Ne teste PAS : auth Supabase (nécessite un vrai user), R2, OAuth.
 * Ça reste un smoke test, pas un test d'intégration.
 */

const path = require('path');

const CRITICAL_ERROR_PATTERNS = [
  /Uncaught/i,
  /TypeError:/,
  /ReferenceError:/,
  /is not defined/,
  /Cannot read propert/,
  /require\(\) of ES Module/,
];

async function main() {
  let electronApp;
  const consoleErrors = [];
  const t0 = Date.now();

  try {
    const { _electron: electron } = require('playwright');
    console.log('→ lancement d\'Electron via Playwright...');
    electronApp = await electron.launch({
      args: [path.join(__dirname, '..')],
      timeout: 20000,
    });

    const window = await electronApp.firstWindow({ timeout: 15000 });
    console.log('✓ fenêtre principale ouverte');

    // Capture des erreurs console avant toute interaction
    window.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    window.on('pageerror', (err) => {
      consoleErrors.push(`pageerror: ${err.message}`);
    });

    // Attendre que le DOM soit prêt
    await window.waitForLoadState('domcontentloaded', { timeout: 10000 });
    console.log('✓ DOM chargé');

    // Vérif 1 : #screen-config existe et est .active
    const configActive = await window.evaluate(() => {
      const el = document.getElementById('screen-config');
      return !!(el && el.classList.contains('active'));
    });
    if (!configActive) {
      throw new Error('#screen-config introuvable ou pas .active — l\'app n\'est pas sur la home');
    }
    console.log('✓ écran Config actif (home OK)');

    // Vérif 2 : window.electronAPI exposé
    const apiPresent = await window.evaluate(() => {
      return typeof window.electronAPI === 'object' && window.electronAPI !== null;
    });
    if (!apiPresent) {
      throw new Error('window.electronAPI absent — preload.js a échoué');
    }
    console.log('✓ window.electronAPI exposé (preload OK)');

    // Vérif 3 : méthodes clés de l'API présentes
    const apiMethods = await window.evaluate(() => {
      const api = window.electronAPI;
      return {
        listR2Photos: typeof api.listR2Photos === 'function',
        getAppVersion: typeof api.getAppVersion === 'function',
      };
    });
    const missingMethods = Object.entries(apiMethods).filter(([, v]) => !v).map(([k]) => k);
    if (missingMethods.length > 0) {
      throw new Error(`méthodes electronAPI absentes : ${missingMethods.join(', ')}`);
    }
    console.log('✓ méthodes electronAPI présentes');

    // Laisser un peu de temps à l'app pour lever d'éventuelles erreurs async
    // (ex: chargement de fonts, init de modules)
    await window.waitForTimeout(1500);

    // Vérif 4 : pas d'erreur critique en console
    const critical = consoleErrors.filter((e) =>
      CRITICAL_ERROR_PATTERNS.some((p) => p.test(e))
    );
    if (critical.length > 0) {
      throw new Error(`${critical.length} erreur(s) critique(s) console :\n  - ${critical.slice(0, 3).join('\n  - ')}`);
    }
    if (consoleErrors.length > 0) {
      console.log(`⚠ ${consoleErrors.length} warning(s) console non critiques (ignorés)`);
    }
    console.log('✓ pas d\'erreur critique');

    const dt = Date.now() - t0;
    console.log(`\n\x1b[32m\x1b[1m✓ smoke test OK\x1b[0m (${dt}ms)`);
    process.exit(0);
  } catch (err) {
    const dt = Date.now() - t0;
    console.error(`\n\x1b[31m\x1b[1m✗ smoke test KO\x1b[0m (${dt}ms)`);
    console.error(`  ${err.message}`);
    if (consoleErrors.length > 0) {
      console.error(`\n  console errors capturées :`);
      consoleErrors.slice(0, 5).forEach((e) => console.error(`    - ${e.substring(0, 200)}`));
    }
    process.exit(1);
  } finally {
    if (electronApp) {
      try { await electronApp.close(); } catch (_) {}
    }
  }
}

main().catch((e) => {
  console.error('Erreur inattendue :', e);
  process.exit(1);
});
