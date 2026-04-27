# Gesturo — Notes pour Claude

App Electron de gesture drawing. Desktop + mobile (Capacitor).
Solo dev, français, commits incrémentaux, push auto après chaque modif.

## Règles Claude Code

- **Gros fichiers — NE JAMAIS lire en entier** : `src/app.js` (507L),
  `admin-web/app.js` (3762L), `user-data/index.ts` (1412L). Toujours grep.
- **Concision** : pas de résumé, pas de reformulation. Droit au code.
- **Ne pas relire** ce qui est déjà en contexte.
- **Ignorer** : `node_modules/`, `www/`, `dist/`, `.venv/`, `android/`, `ios/`
- **Après modif `src/app.js`** : vérifier que les `onclick="xxx()"` de
  `index.html` correspondent à une fonction existante.
- **Après modif `preload.js`** : vérifier que `mobile/mobile-shim.js`
  expose les mêmes méthodes.

## Stack

- **Desktop** : Electron 41, auto-update via electron-updater (v0.3.1+)
- **Mobile** : Capacitor 8 (Android + iOS scaffolds). iOS testé sur device.
- **Backend** : Supabase (Auth + Postgres + Edge Functions Deno) + Cloudflare R2
- **Build** : electron-builder (DMG universal arm64+x64), GitHub Actions
- **Admin web** : `admin-web/` sur Cloudflare Pages (`gesturo-admin.pages.dev`),
  auto-deploy via GitHub Actions. **JAMAIS dans le DMG.**
- Vanilla JS, pas de TS, pas de bundler, pas de lint.

## Layout

```
main.js                      Orchestrateur Electron (~128L), délègue à src/main/
src/main/
  auth.js                    Whitelist, Pro checks, Stripe links (~129L)
  oauth.js                   Serveur loopback OAuth Google (~76L)
  edge.js                    callUserData, listR2Photos/Anims (~57L)
  moodboard.js               Handlers IPC mb:* (~182L)
  ipc.js                     Autres handlers IPC (~364L)
preload.js                   Bridge contextIsolation → window.electronAPI
supabase.js                  Client Supabase (PKCE)
config.js                    Constantes publiques (URL/KEY). ⚠ jamais de secret.
.env                         Dev only, gitignored. Credentials R2 pour CLI.

index.html                   Markup (~725L)
styles/                      base.css, screens/*.css, components/*.css
src/
  app.js                     Core renderer (~507L) — chargé en premier
  categories.js              Catégories + séquences + pile sélection (~463L)
  community.js               Feed, challenges, upload, share (~1044L)
  session.js                 Session pose, timer, preload (~268L)
  animation.js               Animation, study mode, timeline (~364L)
  favorites.js               Favoris, moodboard pin, sync (~445L)
  options.js                 Options, profil, badges, onboarding (~1504L)
  cinema.js                  Films catalog + playback (~200L)
  bubbles.js                 Animation canvas d'accueil (~30L)

mobile/
  mobile-shim.js             Réimplémente window.electronAPI via Capacitor
  auth-mobile.js             Supabase PKCE + deep link
scripts/
  r2.js                      CLI R2 : list, stats, rename, move, upload, delete, backup
  r2-sort.js                 Tri visuel R2 (sample → download → plan.json → execute)

supabase/functions/
  _shared/r2.ts              S3 client + requireUser + resolveIsPro + requireAdmin
  list-r2-photos/            Auth-gated, isPro server-side
  list-r2-animations/        Auth-gated, free → free/ only
  list-instagram-posts/      Public, cache 1h
  user-data/                 Core backend (~1412L) : favoris, sessions, streak,
                             community CRUD, modération, admin actions, featured,
                             challenges, annonces, flags, errors, hard reset
  admin-r2/                  Admin-only : browse, list, upload-urls, delete,
                             archive, unarchive, move (overwrite:true supporté)
  stripe-webhook/            Webhook Stripe
  daily-challenge/           Auto-gen challenge quotidien

admin-web/
  app.js                     8 onglets admin (~3762L)
  index.html                 Login + UI admin
  styles.css                 Thème dark

.github/workflows/
  build.yml                  DMG Mac universal sur tag v*
  build-win.yml              EXE Windows NSIS sur tag v*
  android.yml                APK debug sur push
  ios.yml                    Build iOS debug sur push (sans signer)
  deploy-admin.yml           Auto-deploy admin-web/ sur Cloudflare Pages
```

## Conventions / gotchas

- **Onclick inline** : 74 `onclick=` dans index.html → fonctions globales.
  Ne pas convertir en `type="module"`. Si tu renommes une fonction, grep
  dans index.html.
- **Ordre de chargement** : `src/app.js` AVANT `src/cinema.js`.
- **`main.js` ≠ `src/app.js`** : main = Electron process, app.js = renderer.
- **Mobile shim** : toute nouvelle méthode dans `preload.js` doit être
  stubée/implémentée dans `mobile/mobile-shim.js`.
- **Admin web ≠ app** : ne JAMAIS ajouter `admin-web/` à package.json `files`.
- **R2 catalog** :
  - Poses : `Sessions/current/<cat>/<sub>/file` (gating nudité only)
  - Animations : `Animations/current/{free|pro}/<thème>/<séquence>/file`
    5 thèmes Pro : locomotion (walk/wwalk/run/wrun), combat (sword-lunge/
    sword-strike/swing/weapon), accessoires (abdo/porter/jump), corps (main),
    sport (skate1/skate2/skate3). Free : locomotion/gratuit.
    L'UI saute les niveaux `current/free|pro` → affiche les thèmes directement.
- **R2 CORS** : autorise PUT depuis `localhost:5500` et `*.pages.dev`.
- **Supabase redirect URLs** : inclure `gesturo-admin.pages.dev/*` et
  `localhost:5500/*` sinon le magic link admin ne marche pas.
- **Edge Functions** : déployer `user-data` et `admin-r2` avec `--no-verify-jwt`
  (requireAdmin/requireUser font leur propre vérif).
- **VisionKit (iOS scan)** : si tu modifies `VisionKitScannerPlugin.swift`,
  vérifier qu'il reste référencé dans `project.pbxproj` (4 endroits).

## Sécurité

- Secrets uniquement côté Supabase function secrets, jamais dans le client.
- Admin gating : `profiles.is_admin` vérifié par `requireAdmin()` server-side.
  ADMIN_ALLOWED_ROOTS = `Sessions/`, `Animations/`.
- 🟠 **`webSecurity: false` + CSP vide** dans `main.js` — à tester/réactiver.
- 🟡 Admin desktop legacy (`~/.gesturo-admin`) plus utilisé, à supprimer.

## État du catalogue R2 (2026-04-27)

~2543 fichiers, ~1.38 GB. Format `nom_001.jpg`.
- `Sessions/current/` : 1920 fichiers (animals 51, jambes-pieds 422,
  mains 318, nudite 238, poses-dynamiques 684, pose-dynamique-femme 152,
  visage 55)
- `Animations/current/` : 613 fichiers en 16 séquences, 5 thèmes
- `Community/` : quelques fichiers (ne pas renommer)

## Admin web — 8 onglets (live sur gesturo-admin.pages.dev)

1. **Fichiers** — R2 browser, archive, upload, drag-drop, move picker
2. **Challenges** — CRUD + R2 image picker
3. **Modération** — speed review, batch approve/reject, ban, auto-approve
   (≥1 post approuvé), raisons de rejet, historique, raccourcis clavier
4. **Utilisateurs** — liste paginée, search, filtres, 3 vues, grant Pro,
   admin toggle, ban, suppression cascade, profil modal
5. **Stats** — KPIs, charts inscriptions/sessions, top users, rétention
   cohorte, users inactifs, export CSV
6. **Annonces** — message + type + lien + expiration, une seule active,
   poll 5min + refocus côté app
7. **Système** — mode maintenance, feature flags, hard reset (password)
8. **Erreurs** — stack traces, meta user, badge rouge nav, tout vider

## Tables Supabase

`profiles` (is_admin, banned, featured, last_active, plan),
`community_posts` (featured, approved, challenge_id),
`post_reactions`, `challenges`, `moderation_log`, `announcements`,
`feature_flags`, `app_settings`, `client_errors`, `user_sessions`,
`favorited_images`, `rotations`, `rotation_files`

## Auto-update

electron-updater check GitHub releases `Vesanerie/Gesturo-App`.
Bannière UI verte + "Installer et relancer". Fonctionne depuis v0.3.1.
CI génère `latest-mac.yml` / `latest.yml`. Mobile = App Store / Play Store.

## TODO

### P1
- ~~Réactiver `webSecurity`~~ — déjà fait (`webSecurity: true` dans main.js)

### À faire plus tard
- **Modération auto images** — code prêt (`moderateImage()`, Claude Haiku
  ~$0.001/image). Manque la clé API Anthropic. Pour activer :
  `npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-api03-...`
- **Phase D — Rotations** — DB prête (tables rotations/rotation_files).
  Reste : Edge Functions (create/schedule/execute) + UI admin.
- **Email user / Broadcast email** — code prêt (Resend API, batches de 50,
  onglet Broadcast + bouton Email dans profil user). Manque la clé :
  `npx supabase secrets set RESEND_API_KEY=re_... RESEND_FROM="Gesturo <hello@gesturo.art>"`
- **Stripe dashboard admin** — lire stripe-webhook, ajouter adminGetStripeData
- **Bannière annonce sur gesturo.fr** — reprendre la modale dans le site
- **1er run Android device** — iOS OK, Android pas encore testé
- **Tests** — il n'y en a pas

## R2 CLI

```bash
node scripts/r2.js list|stats|rename|move|upload|delete|backup|duplicates|watermark
node scripts/r2-sort.js sample|download|plan|execute
```
Credentials dans `.env`. Opérations loguées dans `scripts/r2-audit.log`.

## Conventions mobile

- Breakpoints : phone ≤767px, tablet 768-1399px, desktop ≥1400px
- Tout mobile via `@media (max-width: 768px)`, desktop intouché
- Controls flottants : `backdrop-filter: blur(14-20px)` + `-webkit-` prefix
- Tap zones ≥ 44px, safe-area-insets avec fallback `, 0px`
- Tap-to-toggle controls : `.controls-hidden` sur le screen parent
- Cacher boutons : `body:has(#screen-X.active) #btn { display: none !important }`
- Bottom tab bar : `padding-bottom: env(safe-area-inset-bottom)`
- Moodboard désactivé sur phone (CSS hide + JS guard)
- `BrowserWindow.minWidth: 360` pour tester les media queries

## Pipeline d'agents

6 agents dans `.claude/agents/` : gesturo-translator, gesturo-orchestrator,
gesturo-frontend, gesturo-backend, gesturo-reviewer, gesturo-auditor.
