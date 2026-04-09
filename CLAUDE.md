# Gesturo — Notes pour Claude

App Electron de gesture drawing en cours de portage Android via Capacitor.
Solo dev, non-technique côté tooling — préfère les explications step-by-step
et les commits incrémentaux.

## Stack

- **Desktop** : Electron 30, AWS S3 SDK retiré côté client
- **Mobile** : Capacitor 8 (Android scaffold présent, iOS pas encore lancé)
- **Backend** : Supabase (Auth + Postgres + Edge Functions Deno) + Cloudflare R2
- **Build** : electron-builder (DMG arm64, notarize signé sur tags `v*`),
  GitHub Actions Android (debug APK artifact, JDK 21 + android-34 SDK)
- **Admin web** : app séparée vanilla HTML/JS dans `admin-web/`, déployée
  sur Cloudflare Pages (`gesturo-admin.pages.dev`). **JAMAIS embarquée
  dans le DMG public** — séparation physique via la whitelist `files` de
  package.json. Auth = magic link Supabase, gating server-side via
  `requireAdmin()` qui lit `profiles.is_admin`.
- Pas de TS, pas de bundler, pas de lint. Vanilla JS dans le renderer.

## Layout

```
main.js                      Process Electron principal — IPC, OAuth loopback,
                             window mgmt. ~720 lignes.
preload.js                   Bridge contextIsolation → window.electronAPI
moodboard-preload.js         Bridge spécifique au webview moodboard
supabase.js                  Client Supabase (PKCE + storage adapter sur disque)
config.js                    Constantes publiques (SUPABASE_URL/KEY publishable)
                             ⚠ aucun secret ici, jamais.
whitelist.json               Emails autorisés en bêta + admin_password local
.env                         Dev only — NON inclus dans le DMG (cf. package.json
                             "files"). Gitignored. Si secrets compromis,
                             ROTATER côté Supabase function secrets.

index.html                   Squelette HTML (~470 lignes) — markup uniquement
styles/
  base.css                   reset, body, .screen toggle, noise overlays
  screens/{config,session,anim,recap,cinema}.css
  components/{favs,options,streak,history,badges}.css
src/
  app.js                     Le gros monolithe renderer (~1600 lignes).
                             State, auth init, folder loading, categories,
                             sequences, mode switching, session pose+anim,
                             recap, lightbox, favs, history, streak, grid,
                             options, badges. Tout sur le scope global.
                             Chargé avant bubbles/cinema (qui en dépendent).
  bubbles.js                 IIFE animation canvas d'accueil (~30L)
  cinema.js                  Module Cinéma — FILMS catalog + playback (~200L)
                             Dépend de logSession() exporté par app.js.

mobile/
  auth-mobile.js             Supabase PKCE + deep link com.gesturo.app://auth-callback
  mobile-shim.js             Réimplémente window.electronAPI via Capacitor
                             plugins + Edge Functions, pour que le renderer
                             desktop tourne tel quel dans la webview.
scripts/sync-web.js          Copie root → www/ et injecte les deux scripts
                             mobile/. Lancé par npm run mobile:sync.
www/                         Généré par sync-web.js — gitignored.

android/                     Capacitor Android scaffold (Manifest contient déjà
                             INTERNET + deep link auth-callback + singleTask)
capacitor.config.json

supabase/functions/
  _shared/r2.ts              S3 client R2 + requireUser(JWT) + resolveIsPro
                             (lit profiles.plan server-side) + requireAdmin
                             (lit profiles.is_admin) + helpers admin
                             (browseLevel, moveObject, deleteKeys, presignPut,
                             archiveKeyFor, unarchiveKeyFor, sanitizeFilename,
                             ADMIN_ALLOWED_ROOTS = Sessions/, Animations/).
                             r2Client a requestChecksumCalculation='WHEN_REQUIRED'
                             pour que les presigned PUT URLs marchent depuis
                             le navigateur (sinon SDK v3 bake un CRC32).
  list-r2-photos/            Auth-gated, isPro résolu côté serveur.
  list-r2-animations/        Idem. Free user → free/ uniquement.
  list-instagram-posts/      Public (cache 1h). Token IG dans secrets.
  user-data/                 favoris/sessions/streak/refreshProStatus.
                             Auth via JWT, écriture via service role.
  stripe-webhook/            (existant, pas touché récemment)
  admin-r2/                  Admin-only (requireAdmin). Multi-action via
                             body.action: 'browse' (1 niveau), 'list' (récursif),
                             'upload-urls' (presigned PUT batch), 'delete'/
                             'archive'/'unarchive' (acceptent {keys} OU
                             {prefix} pour expand récursif), 'move' vers
                             destPrefix arbitraire. Déployé avec
                             --no-verify-jwt car requireAdmin fait sa propre
                             vérif (le gateway JWT verify pose problème
                             avec les nouvelles clés sb_publishable_).

admin-web/                   App web admin SÉPARÉE — jamais dans le DMG.
  index.html                 Login magic link + écran admin file manager.
  app.js                     Auth Supabase (PKCE), navigation Finder
                             (back/forward/up + breadcrumb), grille mixte
                             dossiers/fichiers, sélection multi-Shift,
                             drag-drop OS upload (avec recursion via
                             webkitGetAsEntry), drag-drop interne pour
                             move (MIME application/x-gesturo-keys),
                             clic droit context menu, lightbox, modale
                             confirm avec require-type "SUPPRIMER".
                             Thumbnails via wsrv.nl proxy CDN.
  styles.css                 Thème dark cohérent avec l'app principale.

.github/workflows/
  build.yml                  electron-builder Mac DMG sur tag v*
  android.yml                APK debug sur push (mobile/web/android paths)
```

## Sécurité — état actuel

- ✅ R2 access keys, OpenAI, Instagram token, Google OAuth client_secret :
  **uniquement côté Supabase function secrets**, jamais dans le client.
- ✅ Refactor `main.js` : plus de S3Client direct, plus de
  `~/.gesture_drawing_token.json`, plus de réécriture du `.env` pour IG.
- ✅ Edge Functions R2 : `requireUser` + `resolveIsPro` server-side. Le
  client ne peut plus s'auto-grant Pro en passant `{isPro: true}`.
- ✅ `.env` retiré de `package.json "files"` (n'est plus shippé dans le DMG)
- ✅ `.env` et `oauth_credentials.json` gitignored
- ✅ Admin web séparée du DMG : `admin-web/` jamais dans la liste `files`
  d'electron-builder. Rien d'admin reverse-engineerable depuis le DMG public.
- ✅ Admin gating : colonne `profiles.is_admin` (manuellement set en SQL),
  vérifiée par `requireAdmin()` côté Edge Function via service role. Le
  client ne peut jamais bypasser. Hard guard : toute key admin doit
  commencer par `Sessions/` ou `Animations/` (constante ADMIN_ALLOWED_ROOTS).
- 🟡 Admin desktop legacy = marker file `~/.gesturo-admin` (mode 0o600),
  set via `auth-admin` + password de `whitelist.json`. Plus utilisé depuis
  l'arrivée de l'admin web — à supprimer un jour.
- 🟡 CORS `*` sur les Edge Functions — acceptable car auth via JWT (pas
  cookies). C'est le pattern Supabase recommandé.
- ⚠ Anciens DMG ≤ 0.1.7 distribués contiennent les anciennes clés. **Rotation
  faite** d'après l'utilisateur — si nouveau doute, re-rotater côté
  Supabase secrets ne casse rien côté client (les Edge Functions lisent
  `Deno.env.get`).

## Conventions / gotchas

- **Onclick inline préservés** : 74 `onclick=` dans index.html référencent
  des fonctions globales de `src/app.js`. Ne pas convertir en `type="module"`
  sans tout réécrire — les `<script src>` classiques partagent le scope
  global et c'est exactement ce qu'on veut.
- **Ordre de chargement** : `src/app.js` AVANT `src/cinema.js` (cinema
  appelle `logSession` défini dans app.js).
- **Pour les onclicks dans `index.html`** : si tu renommes une fonction
  dans `src/app.js`, fais une passe `grep "nomFonction" index.html`.
- **`main.js` Electron** ≠ **`src/app.js` renderer** — ne jamais les
  confondre. Le main process écoute IPC, le renderer fait le UI.
- **Mobile shim** : si tu ajoutes une méthode à `window.electronAPI` côté
  desktop (preload.js), pense à la stub ou l'implémenter dans
  `mobile/mobile-shim.js`, sinon elle sera `undefined` sur Android.
- **Admin web ≠ app principale** : ne JAMAIS ajouter `admin-web/` à
  package.json `files`. Si tu touches `admin-web/`, redéployer avec :
  `npx wrangler pages deploy admin-web --project-name=gesturo-admin --branch=main`
- **R2 catalog layout** : `gesturo-photos/Sessions/current/<cat>/<sub>/file`
  pour les poses (pas de split free/pro, gating nudité only),
  `gesturo-photos/Animations/current/{free|pro}/<gender>/<cat>/<sub>/file`
  pour les animations. L'admin manipule aussi `Sessions/archive/<ts>/...`
  et `Animations/archive/<ts>/...`. Le `current/` était déjà là par chance,
  ce qui rend la rotation de catalogue (Phase D, pas encore implémentée)
  naturelle.
- **Cloudflare R2 CORS policy** sur `gesturo-photos` autorise PUT depuis
  `localhost:5500` et `*.pages.dev` (pour l'upload admin direct). Si tu
  changes le domaine de l'admin, mettre à jour la policy R2.
- **Supabase auth redirect URLs** doivent inclure
  `https://gesturo-admin.pages.dev/*` (et `http://localhost:5500/*` pour
  le dev local) sinon le magic link de l'admin ne marche pas.
- **Tables Postgres pour la rotation** (Phase D) : `rotations` et
  `rotation_files` déjà créées avec RLS strict (service role only).
  `profiles.is_admin` aussi déjà ajoutée. Voir migration dans l'historique
  de chat / SQL editor — pas de dossier `supabase/migrations/` géré.

## Refonte UI mobile (en cours, avant 1er run Android)

Le user veut une UI vraiment mobile-friendly **avant** de lancer le premier
run Android sur device. Tester sur device une UI desktop telle quelle
n'apporte aucune info utile.

### Décision visuelle

Trois directions ont été mockupées dans `mobile-mockups/` (gitignored,
jetables) — **Option B** retenue : **mobile-first repensé**.

- Bottom tab bar fixe (4 onglets : Démarrer / Favoris / Historique / Profil)
- Segmented control en haut de l'écran Démarrer pour switcher
  Poses / Animation / Cinéma
- Écran config découpé en sections accordion (Catégories / Durée / Mode /
  Options avancées) pour réduire la densité
- Écran Session : photo plein écran, controls flottants en bas avec
  backdrop-filter blur, timer flottant en haut
- Look natif moderne, ergonomie pensée pour le pouce

### Stratégie de cohabitation desktop/mobile

- **Desktop intouché** : tout le travail mobile passe par
  `@media (max-width: 768px)`. L'UI desktop reste strictement identique
  pixel-pour-pixel à aujourd'hui. On ne casse pas un produit qui marche.
- **Pas de cas tablet pour l'instant** : phone vs desktop, point. La tablet
  sera traitée si/quand le besoin se présente — probablement avec son propre
  breakpoint à 1024px dans un second temps.
- **2 systèmes de nav qui coexistent** dans le code (mode-tabs en haut sur
  desktop, bottom tab bar sur mobile), assumé.

### Ordre de refonte des écrans

1. ✅ **Session pose** — photo plein écran, controls flottants avec
   backdrop-filter blur, tap-to-toggle. Voir « Conventions mobile établies »
   ci-dessous. Pas encore committée à l'heure où ce paragraphe est écrit
   (en attente de validation user).
2. ⏳ **Démarrer / Config** (en cours suivant) — segmented control +
   sections accordion
3. **Recap** (post-session) — grille 2 colonnes phone
4. **Animation** — structurellement comme Session, photo plein écran +
   timeline scrollable au pouce
5. **Cinéma** — idem
6. **Favoris / Historique / Communauté** — grilles responsive simples,
   accédées via bottom tab bar
7. **Moodboard** — **désactivé sur phone, point**. Le moodboard sert de
   référence visuelle pendant qu'on dessine — inutile sur un écran phone
   trop petit pour être consulté à côté d'un carnet. Donc :
   - Cacher l'accès au moodboard sous `@media (max-width: 768px)` (le
     bottom tab bar ne l'inclut déjà pas — 4 onglets : Démarrer / Favoris
     / Historique / Profil).
   - Guard JS dans `src/app.js` : si `matchMedia('(max-width: 768px)')`
     match et qu'on tente d'activer l'écran moodboard, redirect vers
     Démarrer (au cas où un état sauvegardé / deep link y mène).
   - Tablette (≥768px) et desktop : intouchés, `<webview>` Electron
     continue de marcher en desktop, et la tablette aura sa propre passe
     plus tard si besoin.
   - **Plus besoin de fallback Capacitor InAppBrowser** — n'est plus
     bloquant pour le 1er run Android.

### Conventions mobile établies (à réutiliser pour les autres écrans)

Patterns décidés et appliqués lors de la refonte de Session, à reprendre
tels quels sur Animation et Cinéma (qui ont la même structure photo + bar) :

- **`BrowserWindow.minWidth: 360`** dans `main.js` (avant : 800). Permet
  de tester les media queries en redimensionnant la fenêtre Electron sans
  rebuild. Ne pas remonter cette valeur sans raison.
- **Calque transparent over photo** : pour passer une bar du bas en
  controls flottants, on garde la bar dans le HTML mais on lui met
  `position: absolute; inset: 0; pointer-events: none; background: transparent;`
  dans le @media. Chaque enfant interactif reprend `pointer-events: auto`
  individuellement. Avantage : zéro modif HTML, zéro modif JS, le desktop
  reste pixel-pour-pixel identique.
- **Backdrop-filter blur** : tous les éléments flottants utilisent
  `background: rgba(10,21,32,0.55-0.62); backdrop-filter: blur(14-20px)`
  pour rester lisibles sans cacher la photo. Toujours préfixer
  `-webkit-backdrop-filter` pour compat Safari/iOS WebView.
- **Tap-to-toggle des controls** : sur écran photo plein écran, un tap sur
  `#photo-area` (hors bouton) toggle `.controls-hidden` sur le screen
  parent. Snippet JS dans `src/app.js` (~20 lignes IIFE en bas du fichier).
  Le selecteur `e.target.closest('button')` empêche le toggle quand l'user
  vise un vrai bouton. À répliquer pour Animation et Cinéma quand on
  passera dessus.
- **Hint discret « Tape pour révéler »** : `::after` sur `#photo-area` quand
  `.controls-hidden` est actif, animation fade-in/fade-out automatique
  via `@keyframes` (2.2s). Sert juste à éduquer l'user au geste.
- **Tap zones ≥ 44px** systématique sur tous les boutons interactifs en
  mobile (norme HIG/Material). Les boutons desktop à 32px sont overridés
  via `min-height: 44px; padding: 11px ...`.
- **Safe-area-insets** : utiliser
  `top: calc(env(safe-area-inset-top, 0px) + Npx)` et idem pour bottom.
  Le `, 0px` fallback est nécessaire sinon la valeur est `unset` sur les
  desktops sans notch.
- **Cacher les boutons globaux selon l'écran actif** : utiliser le sélecteur
  `body:has(#screen-X.active) #global-btn { display: none !important; }`.
  Ça marche en Chromium ≥105 (Electron 30 OK, Android WebView récent OK).
  Évite les collisions sans avoir besoin de toucher au JS global.

### Fichiers déjà touchés par la refonte mobile

- `main.js` — `minWidth` baissé à 360 (commit en attente)
- `styles/screens/session.css` — bloc `@media (max-width: 768px)` ~210 lignes
  ajouté en bas (commit en attente)
- `src/app.js` — IIFE tap-to-toggle ajouté en bas du fichier (commit en
  attente)
- Aucune autre modification jusqu'ici. Les autres `styles/screens/*.css`
  et `index.html` n'ont pas encore été touchés.

### Workflow de test pendant la refonte

- **Pendant le dev** : `npm start` puis l'user **redimensionne la fenêtre
  Electron** au pouce jusqu'à ~375px de large. Les media queries se
  déclenchent (le renderer est Chromium, pareil qu'Android WebView), donc
  c'est un test fidèle du rendu mobile, sans aucun cycle build.
- **Tester aussi en plein écran** après chaque écran refondu pour vérifier
  qu'on n'a rien cassé en desktop. Les media queries doivent rester
  strictement isolées dans `@media (max-width: 768px) { ... }`.
- **DMG final à la fin de toute la refonte** : quand les 7 écrans sont
  validés, bump version + `electron-builder` build un DMG signé/notarized
  à distribuer aux beta testers (`v0.2.0` probablement). Pas de DMG
  intermédiaire — overkill et lent.
- **Device Android réel** : pas pendant la refonte mobile elle-même
  (Chromium = Android WebView pour ce qui nous intéresse), mais juste
  après la refonte avant de bouger sur d'autres chantiers, pour valider
  les vrais gestes tactiles + safe-area-inset sur device réel.

### État du chantier au début (avant refonte Session)

- **Aucune `@media` query** dans `styles/` — tout à créer (Session a ouvert
  le bal, voir « Conventions mobile établies » ci-dessous).
- **Tailles fixes en pixels** partout (ex : `.config-inner { width: 580px }`).
- **7 mode-tabs** en flexbox horizontal qui débordent sur phone.
- **Tap zones à 32px** (norme tactile = 44px min).
- **Pas de `safe-area-inset-*`** pour les notch / gesture bars.
- **Inline styles** dans `index.html` (~30 occurrences) qui rendent les
  media queries plus chiantes à appliquer.
- Architecture CSS déjà bien éclatée (`styles/screens/` + `styles/components/`)
  → on peut bosser écran par écran.

### Gotchas spécifiques mobile

- **`<webview id="moodboard-webview">`** dans `index.html` : balise
  Electron-only, n'existe pas en Android. Faut un fallback dans
  `mobile-shim.js` avant le 1er run Android, sinon l'écran moodboard crash.
- **Onclicks inline préservés** : on ne peut pas refondre vers une vraie
  architecture event delegation tant que les 74 `onclick=` de `index.html`
  ne sont pas migrés. Pour la refonte mobile on **garde** les onclicks
  (juste du CSS, pas de refactor JS).
- **Bottom tab bar** doit utiliser `padding-bottom: env(safe-area-inset-bottom)`
  sinon elle passe sous la gesture bar Android / home indicator iOS.

## Workflow préféré

- Commits incrémentaux, un par sujet logique. Le user teste manuellement
  entre les étapes (`npm start` desktop). Ne pas batch.
- Toujours expliquer en français.
- Pour les gros refactors mécaniques (style/JS slicing), utiliser Python
  via Bash plutôt que d'éditer ligne par ligne — plus rapide et moins de
  context burn.
- Avant un commit destructif/risqué : confirmer.
- Le user sait `git push` mais préfère que je le fasse pour lui après
  validation.

## TODO connus / pas encore faits

- **Phase D — Rotations planifiées** (admin web). Prêt côté DB (tables
  rotations + rotation_files créées). Reste à implémenter :
  Edge Functions `rotations-create` (presigned PUT vers staging),
  `rotations-schedule` (draft → scheduled), `rotations-execute`
  (déclenché par pg_cron Supabase, archive l'ancien + promote staging),
  et UI admin pour créer/voir/annuler les rotations. Workflow validé :
  one-shot (date précise par rotation), pas de récurrent automatique.
- **Table admin_audit_log** + logging dans toutes les actions admin —
  pas urgent pour usage solo mais utile en cas de doute (qui a archivé
  quoi quand).
- **1er run Android sur device** — l'app est prête (Manifest OK, Edge
  Functions OK, shim mobile OK). Reste à lancer Android Studio.
- **Refactor `main.js` Electron en `src/ipc/` `src/oauth/` `src/r2/`** —
  P1 audit, pas urgent. main.js fait ~720 lignes, encore lisible.
- **Vrai découpage modulaire de `src/app.js`** — actuellement c'est un
  monolithe global, juste sorti d'index.html. Pour le découper en vrais
  modules ES6 il faudrait ajouter des `import/export`, virer les
  globals, et probablement remplacer les `onclick=` par event delegation.
  Gros chantier — à faire seulement quand il y a un vrai besoin.
- **CI iOS** — Capacitor iOS scaffold pas encore généré.
- **Tests** — il n'y en a pas. Pas une priorité pour un solo dev sur app
  desktop.
- **Plugins Capacitor Camera/Photos** — l'audit initial le listait mais
  Gesturo n'a pas besoin de la caméra ni de la galerie utilisateur (les
  poses viennent toutes de R2 via Edge Functions). Filesystem suffit.

## Commits récents importants

- `4ee0f66` docs: plan de refonte UI mobile (Option B mobile-first)
- `51afaac` fix(admin-r2): bump presigned PUT TTL from 5min to 1h
- `f85200b` fix(admin-r2): refuse to overwrite existing destination on move
- `b5713d0` fix(admin-web): reach archive zone + keep success message visible
- `1f39819` docs: update CLAUDE.md with admin-web stack and Phase D status
- `2606aed` feat(admin): upload + unarchive + in-app move + context menu (Phase C)
- `5efffdf` feat(admin): selection + delete/archive + Finder-like nav (Phase B)
- `81abbb4` feat(admin-web): scaffold + file browser navigation (Phase A)
- `1d86171` feat(admin): add admin-r2 Edge Function with list action
- `1d54a64` feat(admin): add requireAdmin() helper for admin-only Edge Functions
- `c531f23` fix(cinema): le récap n'affiche que les frames réellement vues
- `0c5f458` fix(poses): ne plus auto-sélectionner les catégories
- `803e53f` refactor(js): extract bubbles + cinema into src/
- `7803bd8` refactor(css): extract inline styles into styles/ modules
- `396a71d` fix(security): enforce server-side Pro check on R2 functions
- `3915352` feat: add Capacitor Android scaffold + mobile web shim
- `96ee74c` refactor: move R2/Instagram/OAuth secrets server-side
