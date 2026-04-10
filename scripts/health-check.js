#!/usr/bin/env node
/**
 * scripts/health-check.js
 *
 * Quick sanity check des services dont Gesturo dépend en production.
 * Usage :
 *   npm run check
 *
 * Exit code 0 = tout vert, 1 = au moins un KO.
 *
 * Ne lit AUCUN secret — tout se base sur la publishable key (sûr à committer).
 * Les vérifs qui nécessitent un JWT utilisateur sont skippées (on ne veut
 * pas gérer d'auth dans un healthcheck).
 */

const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = require('../config.js');

const c = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
};

const results = [];

async function check(name, fn) {
  const t0 = Date.now();
  try {
    const msg = await fn();
    const dt = Date.now() - t0;
    results.push({ ok: true, name, msg, dt });
    console.log(`${c.green}✓${c.reset} ${name} ${c.gray}(${dt}ms)${c.reset}${msg ? ' — ' + msg : ''}`);
  } catch (e) {
    const dt = Date.now() - t0;
    results.push({ ok: false, name, msg: e.message, dt });
    console.log(`${c.red}✗${c.reset} ${name} ${c.gray}(${dt}ms)${c.reset} — ${c.red}${e.message}${c.reset}`);
  }
}

async function fetchWithTimeout(url, opts = {}, ms = 10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

(async () => {
  console.log(`${c.bold}Gesturo — health check${c.reset}\n`);

  // 1. Supabase REST ping. L'URL racine renvoie 401 en prod (normal, pas
  // d'auth) ou 200/404 en dev. Tout ce qui est < 500 prouve que le projet
  // répond.
  await check('Supabase REST reachable', async () => {
    const r = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/`, {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY },
    });
    if (r.status >= 500) throw new Error(`HTTP ${r.status}`);
    return `status ${r.status}`;
  });

  // 2. Auth endpoint
  await check('Supabase Auth settings', async () => {
    const r = await fetchWithTimeout(`${SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    if (!j.external) throw new Error('settings malformed');
    return 'OK';
  });

  // 3. Edge Function publique : list-instagram-posts (pas d'auth requise)
  await check('Edge Function list-instagram-posts', async () => {
    const r = await fetchWithTimeout(
      `${SUPABASE_URL}/functions/v1/list-instagram-posts`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: '{}',
      }
    );
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return 'OK';
  });

  // 4. Edge Functions auth-gated : on attend un 401 (ça prouve qu'elles
  // tournent ET que requireUser() filtre bien).
  for (const fn of ['list-r2-photos', 'list-r2-animations', 'user-data', 'admin-r2']) {
    await check(`Edge Function ${fn} rejects unauth`, async () => {
      const r = await fetchWithTimeout(
        `${SUPABASE_URL}/functions/v1/${fn}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: SUPABASE_PUBLISHABLE_KEY,
          },
          body: '{}',
        }
      );
      // 401 ou 403 attendu. Un 200 serait CATASTROPHIQUE (auth bypass).
      if (r.status === 200) throw new Error('!!! auth bypass !!! renvoie 200 sans JWT');
      if (r.status >= 500) throw new Error(`HTTP ${r.status} (function crashed ?)`);
      return `status ${r.status} (attendu)`;
    });
  }

  // Résumé
  const ok = results.filter(r => r.ok).length;
  const ko = results.length - ok;
  console.log();
  if (ko === 0) {
    console.log(`${c.green}${c.bold}✓ tout vert${c.reset} (${ok}/${results.length})`);
    process.exit(0);
  } else {
    console.log(`${c.red}${c.bold}✗ ${ko} check(s) KO${c.reset} (${ok}/${results.length})`);
    process.exit(1);
  }
})();
