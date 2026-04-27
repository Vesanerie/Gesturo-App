# Gesturo — Notes pour Claude

App Electron de gesture drawing. Desktop + mobile (Capacitor).
Solo dev, français, commits incrémentaux, push auto après chaque modif.

@docs/layout.md
@docs/todo.md

## Règles Claude Code

- **Gros fichiers — NE JAMAIS lire en entier** : `src/options.js` (1560L),
  `src/community.js` (1110L), `admin-web/app.js` (3762L), `user-data/index.ts` (1412L). Toujours grep.
- **Concision** : pas de résumé, pas de reformulation. Droit au code.
- **Ne pas relire** ce qui est déjà en contexte.
- **Ignorer** : `node_modules/`, `www/`, `dist/`, `.venv/`, `android/`, `ios/`
- **Après modif `src/app.js`** : vérifier que les `onclick="xxx()"` de `index.html` correspondent.
- **Après modif `preload.js`** : vérifier que `mobile/mobile-shim.js` expose les mêmes méthodes.

## Stack

- **Desktop** : Electron 41, auto-update via electron-updater
- **Mobile** : Capacitor 8 (iOS + Android). iOS testé sur device.
- **Backend** : Supabase (Auth + Postgres + Edge Functions Deno) + Cloudflare R2
- **Build** : electron-builder (DMG universal), GitHub Actions
- **Admin** : `admin-web/` sur Cloudflare Pages, auto-deploy via GH Actions. **JAMAIS dans le DMG.**
- Vanilla JS, pas de TS, pas de bundler, pas de lint.

## Conventions / gotchas

- **JAMAIS copier dans `www/`** — toujours `node scripts/sync-web.js && npx cap sync ios`
- **Onclick inline** : 74 `onclick=` dans index.html → fonctions globales. Si tu renommes, grep.
- **Ordre de chargement** : `src/app.js` AVANT `src/cinema.js`.
- **`main.js` ≠ `src/app.js`** : main = Electron process, app.js = renderer.
- **Mobile shim** : toute nouvelle méthode preload.js → stuber dans `mobile/mobile-shim.js`.
- **Admin web ≠ app** : ne JAMAIS ajouter `admin-web/` à package.json `files`.
- **Badges** : 18 badges dans `BADGES_DEF` (options.js). `unlockBadge()` a un guard anti-doublon.

## Mobile

- Breakpoints : phone ≤767px, tablet 768-1399px, desktop ≥1400px
- Controls flottants : `backdrop-filter: blur(14-20px)` + `-webkit-` prefix
- Tap zones ≥ 44px, safe-area-insets avec fallback `, 0px`
- Cacher boutons : `body:has(#screen-X.active) #btn { display: none !important }`
- Bottom tab bar : `padding-bottom: env(safe-area-inset-bottom)`
- `BrowserWindow.minWidth: 360` pour tester les media queries

## Sécurité

- Secrets uniquement côté Supabase function secrets, jamais dans le client.
- Admin gating : `profiles.is_admin` vérifié par `requireAdmin()` server-side.
- `config.js` = constantes publiques uniquement.

## Tests

`npm test` (vitest) — 5 suites : scoped-key, sync-web, html-integrity, mobile-shim, offline-manager.
Lancer avant chaque push. Après modif `preload.js`, `index.html`, `src/*.js`, ou `mobile/offline-manager.js`.

## localStorage scopé par email

- `_scopedKey(base)` dans `src/favorites.js` → `base:email@...`
- `_communityEmail` doit être set AVANT toute lecture/écriture d'historique
- `openProfile()` et `confirmResetHistory()` doivent utiliser `loadHist()`, JAMAIS `localStorage.getItem()`

## Pipeline d'agents

6 agents dans `.claude/agents/` : gesturo-translator, gesturo-orchestrator,
gesturo-frontend, gesturo-backend, gesturo-reviewer, gesturo-auditor.
