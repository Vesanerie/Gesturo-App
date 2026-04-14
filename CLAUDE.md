# Gesturo — Notes pour Claude

App Electron de gesture drawing en cours de portage Android via Capacitor.
Solo dev, non-technique côté tooling — préfère les explications step-by-step
et les commits incrémentaux.

## Stack

- **Desktop** : Electron (actuellement v30, upgrade prévu ≥ v35), AWS S3 SDK retiré côté client
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
                             window mgmt. ~768 lignes.
preload.js                   Bridge contextIsolation → window.electronAPI
moodboard-preload.js         Bridge spécifique au webview moodboard
supabase.js                  Client Supabase (PKCE + storage adapter sur disque)
config.js                    Constantes publiques (SUPABASE_URL/KEY publishable)
                             ⚠ aucun secret ici, jamais.
whitelist.json               Emails autorisés en bêta + admin_password local
.env                         Dev only — NON inclus dans le DMG (cf. package.json
                             "files"). Gitignored. Si secrets compromis,
                             ROTATER côté Supabase function secrets.

index.html                   Squelette HTML (~544 lignes) — markup uniquement
styles/
  base.css                   reset, body, .screen toggle, noise overlays
  screens/{config,session,anim,recap,cinema}.css
  components/{favs,options,streak,history,badges,community}.css
src/
  app.js                     Le gros monolithe renderer (~2148 lignes).
                             State, auth init, folder loading, categories,
                             sequences, mode switching, session pose+anim,
                             recap, lightbox, favs, history, streak, grid,
                             options, badges, community feed. Tout sur le
                             scope global. Chargé avant bubbles/cinema
                             (qui en dépendent).
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
  user-data/                 favoris/sessions/streak/refreshProStatus +
                             community posts (CRUD, reactions, feed).
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

## Audit code (2026-04-10) — mis à jour 2026-04-10 (auto-audit)

### P0 — Critique

- ✅ ~~`whitelist.json` shippé avec mot de passe admin~~ — mot de passe
  retiré, fichier gitignored.
- 🔴 **Electron 30 obsolète** — vulnérabilités hautes publiées (ASAR
  integrity bypass, use-after-free). Mettre à jour vers ≥ v35.7.5.
- ✅ ~~`@aws-sdk` dans devDependencies~~ — retiré (scripts morts
  `clear-r2.js`, `upload-to-r2.js`, `tag-poses.js` supprimés).

### P1 — Important

- ✅ ~~`build.yml` écrit des secrets inutiles~~ — nettoyé, seuls
  `SUPABASE_URL` + `SUPABASE_PUBLISHABLE_KEY` restent.
- ✅ ~~Shim mobile `getInstagramPosts` mauvais endpoint~~ — corrigé,
  route maintenant vers `list-instagram-posts`.
- ✅ ~~Favoris localStorage only~~ — `saveFavs()` persiste côté Supabase
  en fire-and-forget, `syncFavsFromServer()` merge au boot.
- ✅ ~~Erreurs R2 swallowed sur mobile~~ — propagées au renderer.
- ✅ ~~`isEmailAllowed` diverge mobile/desktop~~ — aligné (pas de check
  `approved`).
- 🟠 **`webSecurity: false` + CSP vide** dans `createWindow()` (`main.js`).
  Désactive Same-Origin Policy et toute protection CSP. À tester avec
  `npm start` avant de réactiver — risque de casser le chargement
  d'images R2 cross-origin.

### P2 — Mineur

- 🟡 Credentials Supabase dupliquées entre `config.js` et `admin-web/app.js`.
- 🟡 Pas d'`aria-label` sur les boutons emoji (accessibilité basique).
- 🟡 Liens Stripe test dupliqués entre `main.js` et `mobile-shim.js`.
- ✅ ~~Liens Discord incohérents~~ — unifié sur `f9pf3vmgg2`.
- ✅ ~~`ANIM_LOOP_TARGET` vestige~~ — remplacé par `getLoopTarget()`.

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
- **Community** : tables `community_posts` (user_id, image_key, caption,
  challenge_id), `post_reactions`, `challenges` (title, ref_image_key,
  starts_at, ends_at). Les posts sont gérés via l'Edge Function `user-data`
  (actions : community-post, community-feed, community-delete,
  community-react, getCommunityLeaderboard, getChallenges,
  tagPostToChallenge). Le feed est affiché dans l'onglet Communauté
  (desktop + mobile bottom tab) avec sub-tabs Feed / Mes dessins /
  Leaderboard. Challenges = banner avec image ref + countdown, auto-tag
  depuis Recap. La capture caméra utilise `navigator.mediaDevices` sur
  mobile/tablet.
- **Tables Postgres pour la rotation** (Phase D) : `rotations` et
  `rotation_files` déjà créées avec RLS strict (service role only).
  `profiles.is_admin` aussi déjà ajoutée. Voir migration dans l'historique
  de chat / SQL editor — pas de dossier `supabase/migrations/` géré.

## Refonte UI mobile (TERMINÉE — prête pour 1er run Android)

La refonte mobile Option B est **livrée sur la branch `mobile-refonte`**.
Les 7 écrans prévus sont tous refondus, testés en desktop (non régressé)
et prêts pour un run Android réel. Priorité #1 suivante = lancer Android
Studio sur device. Cette section reste en mémoire documentaire — les
conventions établies doivent être respectées pour tout futur travail mobile.

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

### Écrans refondus (tous livrés sur `mobile-refonte`)

1. ✅ **Session pose** (`55d63a1`) — photo plein écran, controls flottants
   blur, tap-to-toggle via `.controls-hidden`
2. ✅ **Démarrer / Config** (`4bc68fd`) — segmented control + sections
   accordion, perf preload R2
3. ✅ **Animation** (`356bdd2`) — photo plein écran + timeline scrollable
4. ✅ **Cinéma** (`356bdd2`) — même structure que Animation
5. ✅ **Recap** (`9d0bf2d`) — grille 2 colonnes phone, orientation libre
6. ✅ **Favoris / Historique / Communauté** (`579ce1f`, `f77ead3`) —
   grilles responsive + bottom tab bar (Communauté promue en onglet)
7. ✅ **Moodboard désactivé sur phone** (`0a19346`) — CSS hide + guard JS
   redirect vers Démarrer. Plus besoin de fallback Capacitor InAppBrowser.

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

### Gotchas spécifiques mobile

- ✅ **`<webview id="moodboard-webview">`** : balise Electron-only.
  Résolu en désactivant l'écran moodboard sur phone (commit `0a19346`),
  pas besoin de fallback shim.
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

## Admin Web — features complètes (session avril 2026)

Session de gros build. L'admin web a été transformée d'un simple
navigateur de fichiers R2 en un outil complet de gestion pour Gesturo.
Toutes les features sont **live** sur `gesturo-admin.pages.dev`.

### Navigation admin — 8 onglets

1. **📂 Fichiers** — R2 browser (Sessions/ + Animations/, archive, upload, etc.) — existait déjà
2. **🏆 Challenges** — CRUD challenges + R2 image picker pour ref — existait déjà
3. **🛡️ Modération** — gestion des posts communauté (nouveau, complet)
4. **👥 Utilisateurs** — liste globale + actions (nouveau)
5. **📈 Stats** — analytics + insights (nouveau)
6. **📣 Annonces** — bannière/modale pour pousser des messages (nouveau)
7. **🛠 Système** — mode maintenance + feature flags (nouveau)
8. **🐛 Erreurs** — log des erreurs JS remontées par les users (nouveau)

### 🛡️ Modération (panel complet)

**Filtres + affichage** :
- Filtres : En attente / Approuvés / Tous
- Recherche par username/email (debounce 400ms)
- Bouton ⚡ **Speed Review** — mode plein écran, image par image, A/R au clavier
- Bouton 📜 **Historique modération** — toutes les actions (approve/reject/ban/unban/grant_pro/...) loguées
- Bouton 🚫 **Bannis** — liste des users bannis avec bouton "Débloquer"
- Header stats : pending / approuvés aujourd'hui / total approuvés / total posts
- Raccourcis clavier : ← → naviguer, A approuver, R rejeter, Espace sélectionner

**Par post** :
- Card avec thumbnail (clic → lightbox, comparaison ref vs dessin si challenge)
- Clic sur username → ouvre le profil user (infos, historique, posts, ban/unban)
- Boutons : ✓ Approuver / ✕ Rejeter / 🚫 Bloquer user
- **Raison du rejet** : modale avec 8 tags cliquables (Pas un dessin, Photo/selfie,
  Contenu inapproprié, Spam, Screenshot, Hors sujet, Doublon, Qualité trop basse)
  + champ texte libre

**Batch** :
- Checkbox pour sélection multi → Approuver / Rejeter N posts
- Rejet supprime le post + les réactions + l'image R2 définitivement

**Auto-approve de confiance** :
- Dès qu'un user a **≥ 1 post approuvé**, ses prochains posts sont
  auto-approuvés (`approved = true` direct à l'insertion).
- Réduit la friction pour les users légitimes, seul le 1er post nécessite review.

### 👥 Utilisateurs (panel complet)

- Liste paginée (50/page) avec pagination prev/next
- Search par email/username (debounce 400ms)
- Filtres : plan (all/free/pro), banned (all/yes/no), admin (all/yes/no)
- **3 modes d'affichage** (toggle persisté localStorage) :
  - 📋 Liste (détaillée, actions à droite)
  - 📊 Compact (dense type tableau)
  - 📇 Cartes (grille de cards)
- Par user :
  - Tags : Free/Pro/Admin/Banni + date d'inscription
  - 👁 **Voir** — ouvre profile modal (posts, historique modération)
  - ✨ **Donner Pro** / Retirer Pro (avec prompt expiration optionnelle)
  - 👑 **Admin toggle** (refuse si self)
  - 🚫 **Bannir** / Débloquer
  - 🗑 **Supprimer** (cascade complète : auth, profil, posts, R2, réactions,
    favoris, sessions + prompt de confirmation par retypage email)

### 📈 Stats (panel complet)

**KPIs** (6 cards) :
- Utilisateurs totaux (+ signups période)
- Pro users + taux de conversion %
- Sessions totales
- Sessions période + durée moyenne
- Posts community
- Inscriptions période

**Charts** :
- Inscriptions par jour (bar chart)
- Sessions par jour (bar chart)
- Sélecteur période : 7 / 30 / 90 jours

**Extras** :
- 🏆 **Top utilisateurs** — sort par sessions / posts / oldest / recent (clic → profil)
- 💤 **Utilisateurs inactifs** — 14 / 30 / 60 / 90 jours (basé sur `last_active`)
- 📊 **Rétention par cohorte hebdomadaire** — % d'users inscrits en semaine N
  qui sont encore actifs (last_active ≤ 14j)
- 📥 **Export CSV** — users / posts / sessions → téléchargement direct

### 📣 Annonces

- Form : message + type (info/warning/success) + lien optionnel + date d'expiration
- Liste : toggle activer/désactiver + supprimer
- **Une seule annonce active à la fois** (créer/activer désactive les autres)
- Côté app Gesturo :
  - Modale **centrée** avec icône par type (💙 info / ⚠️ warning / ✨ success)
  - CTA coloré selon le type
  - Animation fade + pop cubic-bezier
  - Dismiss par × ou clic extérieur → localStorage par ID (ne revient pas)
  - **Temps réel** : poll toutes les 5 min + refetch sur `window.focus`

### 🛠 Système

**Mode maintenance** :
- Checkbox "Activer" + message custom
- Stocké dans `app_settings.maintenance = { enabled, message }`
- Côté app : overlay bloquant plein écran "Gesturo revient bientôt"
  avec animation rotation et le message custom

**Feature Flags** :
- Create/update flag (key + description + enabled)
- Liste avec toggle instantané + delete
- Côté app : `window.__featureFlags` + helper `window.isFeatureEnabled('key')`
- Permet de gater des features sans redéployer

### 🐛 Erreurs

- Liste des erreurs JS remontées depuis les apps users
- Stack trace cliquable (collapsed → expand)
- Meta : email user, URL, version app, user agent
- Badge rouge dans la nav si erreurs présentes
- Bouton 🗑 "Tout vider"
- **Côté app** : global listeners `window.onerror` + `unhandledrejection`
  → appel automatique `logClientError` (throttle 10s pour éviter spam)

### App Gesturo — intégrations côté client

- **pingActivity** : update `profiles.last_active` à chaque auth (pour insights)
- **loadFeatureFlagsFromServer** : charge les flags au boot → `window.__featureFlags`
- **Error reporting** : global listeners + throttle
- **Modération auto des images** (code prêt, nécessite clé API Anthropic — cf. section "À faire plus tard")
- **Scan document** : bouton 📄 Scanner sur iPad/iPhone (VisionKit) + Android (MLKit)
- **Annonces temps réel** : poll 5 min + refocus

### Tables Supabase créées dans cette session

```sql
-- Modération logging
CREATE TABLE moderation_log (id uuid PK, admin_email, action, target_email,
  post_id, reason, created_at);

-- Annonces
CREATE TABLE announcements (id uuid PK, message, kind, link_url, link_label,
  active, expires_at, created_at);

-- Feature flags + app settings + errors
CREATE TABLE feature_flags (key PK, enabled, description, updated_at);
CREATE TABLE app_settings (key PK, value jsonb, updated_at);
CREATE TABLE client_errors (id uuid PK, user_email, message, stack, url,
  user_agent, app_version, created_at);

-- Columns ajoutées
ALTER TABLE profiles ADD COLUMN banned boolean DEFAULT false;
ALTER TABLE profiles ADD COLUMN featured boolean DEFAULT false;
ALTER TABLE profiles ADD COLUMN last_active timestamptz;
ALTER TABLE community_posts ADD COLUMN featured boolean DEFAULT false;
```

### Features conçues mais PAS encore livrées (à ajouter un jour)

- **📧 Email user direct** (support, réponses ciblées)
  — nécessite SMTP config ou API externe (Resend / Postmark / Mailgun)
  — alternative simple : utiliser `admin.auth.admin.sendMagicLink` qui marche
    déjà dans Supabase mais c'est limité
- **📬 Broadcast email** (à tous / Pro uniquement / Free uniquement)
  — même contrainte SMTP
  — idéal pour annonces majeures, changements d'abonnement, campagnes
- **💰 Stripe dashboard** (derniers paiements, MRR, failed payments, refunds)
  — nécessite lire l'intégration Stripe existante (`stripe-webhook/`) et
    ajouter une action `adminGetStripeData` qui liste `stripe.subscriptions.list()`
    et `stripe.paymentIntents.list()` via STRIPE_SECRET_KEY déjà en secret
  — utile quand la base Pro grandit
- **📌 Featured posts dans le feed** — le backend est fait (`adminToggleFeatured
  Post` + colonne `featured`), mais il manque :
  - Bouton "📌 Épingler" dans le panel Modération (sur chaque card)
  - Logique côté app pour afficher le featured en tête du feed community
- **⭐ Featured user badge** — backend fait (`adminToggleFeaturedUser` +
  `profiles.featured`), manque :
  - Bouton dans le user profile modal de l'admin
  - Badge "Coup de cœur" visible dans le feed community à côté du username
- **🌐 Bannière d'annonce sur gesturo.fr** — actuellement l'annonce ne
  s'affiche que dans l'app desktop/mobile. Si tu veux la même sur le
  landing page, il faudrait reprendre le HTML/CSS de la modale dans
  le site gesturo.fr + fetch via l'Edge Function.

## TODO connus / pas encore faits

### Priorité immédiate (P0 audit)
- ✅ ~~Retirer `whitelist.json` du build~~ — gitignored + password retiré
- **Mettre à jour Electron** ≥ v35.7.5 (CVEs publiques)
- ✅ ~~Retirer `@aws-sdk`~~ — scripts morts supprimés

### En cours
- **Community tab** (branch `feat/community-tab`, 16+ commits ahead of main)
  — onglet communauté complet : feed splitté par challenge, upload dessin
  direct, réactions emoji avec tooltips usernames, "Mes dessins" +
  suppression, capture caméra mobile/tablet, leaderboard "Top artistes",
  challenges "Draw this in your style" (hero banner + countdown live +
  participants + "Participer" lance session + auto-share), stats perso
  header. **Auth email/password** avec signup/login/username. **Moodboard
  natif** (boards system remplace le webview Electron, pin depuis Recap/
  Favoris). **Badge detail modal + week activity chart**. **Daily challenge
  auto-gen** via Edge Function. **Admin challenges** CRUD + R2 image
  picker. Tables Supabase : `community_posts` (avec `challenge_id`),
  `post_reactions`, `challenges`. Edge Functions : `user-data` étendue,
  `daily-challenge` (auto-gen).
- **Refonte tablet** (branch `tablet-version`) — breakpoints phone ≤767px,
  tablet 768-1399px, desktop ≥1400px. Config sidebar + Session controls XL.
- **1er run Android sur device** — refonte UI mobile terminée, Manifest OK,
  Edge Functions OK, shim mobile OK. Reste à valider gestes tactiles +
  safe-area-inset + deep link auth sur device réel.

### À faire plus tard
- **Activer la modération auto des images communauté** — le code est en
  place (`moderateImage()` dans `user-data/index.ts`, appels côté client
  dans `src/app.js`, bridge dans `preload.js`/`main.js`/`mobile-shim.js`).
  Utilise Claude Haiku 4.5 via l'API Anthropic (~$0.001/image).
  **Il manque la clé API.** Pour activer :
  1. Créer un compte sur [console.anthropic.com](https://console.anthropic.com)
  2. Ajouter $5 de crédits (~5000 modérations)
  3. Copier la clé API
  4. `npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-api03-TA_CLE`
  En attendant, le système est fail-open : sans clé, tous les posts
  passent avec `approved = false` et la review manuelle via le panel
  admin prend le relais.

- **Mode Scan document** — Android ET iOS supportés :
  - **Android** : `@capacitor-mlkit/document-scanner` (Google MLKit) →
    bouton Scanner sur tous les appareils Android.
  - **iOS** : plugin custom `VisionKitScannerPlugin.swift` dans
    `ios/App/App/`, utilise `VNDocumentCameraViewController` (VisionKit
    d'Apple, zéro dépendance externe, iOS 13+). Exposé côté JS sous le
    nom `VisionKitScanner`. Bouton Scanner sur iPad/iPhone.
  - Le routing est dans `mobile/mobile-shim.js` → `scanDocument()` :
    détecte `window.__isIOS` / `__isAndroid` et appelle le bon plugin.
  - Si tu modifies `VisionKitScannerPlugin.swift` ou tu le déplaces,
    le fichier doit rester référencé dans
    `ios/App/App.xcodeproj/project.pbxproj` (4 endroits :
    PBXBuildFile, PBXFileReference, PBXGroup App, PBXSourcesBuildPhase).

- **SQL à lancer dans Supabase pour activer les nouveaux panels admin** :
  ```sql
  CREATE TABLE IF NOT EXISTS feature_flags (
    key text PRIMARY KEY,
    enabled boolean DEFAULT false,
    description text,
    updated_at timestamptz DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS app_settings (
    key text PRIMARY KEY,
    value jsonb NOT NULL,
    updated_at timestamptz DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS client_errors (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_email text,
    message text NOT NULL,
    stack text,
    url text,
    user_agent text,
    app_version text,
    created_at timestamptz DEFAULT now()
  );
  ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS featured boolean DEFAULT false;
  ALTER TABLE profiles ADD COLUMN IF NOT EXISTS featured boolean DEFAULT false;
  ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_active timestamptz;
  ```
  Sans ces tables/colonnes, les panels Système/Erreurs et les features
  featured / last_active ne fonctionneront pas (échec silencieux côté
  Edge Function, UI affichera "Aucune donnée").

### Backlog
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
- **Réactiver `webSecurity`** ou documenter + CSP minimal — nécessite
  test avec `npm start` pour vérifier que les images R2 se chargent.
- **Refactor `main.js` Electron en `src/ipc/` `src/oauth/` `src/r2/`** —
  pas urgent. main.js fait ~720 lignes, encore lisible.
- **Vrai découpage modulaire de `src/app.js`** — monolithe global ~2148L.
  Nécessite import/export, virer globals, event delegation. Gros chantier.
- **CI iOS** — Capacitor iOS scaffold généré (`df94eea`), workflow CI
  pas encore créé.
- **Tests** — il n'y en a pas. Pas une priorité pour un solo dev.

## Commits récents importants

- `87448dc` feat(admin): 6 features modération UI — speed review, profil user, audit log
- `bdf0d19` feat(community): bouton Partager sur la vue dessin (Web Share API)
- `84b288b` feat(backend): 6 features modération — auto-approve, audit log, profil user
- `2f59db1` feat(community): afficher tous les challenges actifs
- `f605b0f` feat(backend): ban user, stats modération, recherche par user dans adminListPosts
- `bd4b373` fix(ios): ouvrir Instagram/Discord dans l'app native via Universal Links
- `ea58516` fix(mobile): empêcher le double-post community sur iOS
- `94c4c11` fix(ios): safe-area-inset-top sur l'écran Config mobile
- `dfee224` fix(mobile): tap-to-close + swipe-down + back button sur tous les overlays
- `8933e2e` fix(mobile): community cards plus compactes sur phone
- `cff6b19` feat(mobile): capturePhoto via plugin Camera Capacitor dans le shim
- `a7545d0` fix(mobile): support landscape phone (max-height 500px)
- `5c381e7` perf(user-data): réponses compactes — select explicite + fusion requête leaderboard
- `9f179b1` feat(ios): meta tags Apple web app + theme-color
- `92a1fff` fix(mobile): safe-area-inset sur modales auth, onboarding et profile
- `8b4e82a` feat(ios): permissions caméra/photos + flag encryption dans Info.plist
- `91c38db` perf(admin): augmenter concurrence archive/unarchive/move à 20 + overwrite:true
- `48ec697` fix(tablet): hide moodboard pin button on mobile/tablet
- `df94eea` feat(ios): add Capacitor iOS scaffold + deep link + iPad touch fixes
- `b91bfb9` fix(tablet): adapt all buttons, inputs, sliders for iPad touch
- `d128580` fix(responsive): disable zoom + extend tablet breakpoint to 1400px
- `4267af3` fix(mobile): add viewport meta tag for proper responsive on iPad/iPhone
- `d9c3d27` fix(ios): add URL scheme deep link for OAuth callback
- `b85362c` fix(auth): redirect signup confirm + reset password to gesturo.fr
- `e2313c5` feat(animation): free users get only ONE animation sequence
- `6aae398` revert: remove 150 photo cap on free Poses mode
- `987ca81` feat(free): restore 150 random photos cap for free users
- `5f6aff2` feat(brand): unified warm gold (#f0c040) + highlighted "o" in Gesturo
- `e41958a` feat(auth): ask for username after first login (Google or email)
- `42b1733` fix(community): "Dessiner cette ref" button now starts a session
- `f64869d` fix(moodboard): reload webview after creating project from pin modal
- `ec4870b` fix(favs): pin modal - replace broken prompt() with inline form + toast
- `4aff7ae` fix(ui): center share preview image in share overlay
- `8a1b9c3` docs: note user-data must be deployed with --no-verify-jwt
- `71fff66` fix(ui): mode-tabs desktop widths equal
- `27c65e7` feat(favs): pin button to send favorite to moodboard
- `d94a149` feat(auth): server-side blocked usernames filter
- `b25daee` fix(ui): add emojis to Poses and Animation mode tabs
- `d90e433` feat(community): compare view when clicking a community drawing
- `bffd0d9` feat(categories): FREE sees all with Pro locked, PRO hides free-only
- `23c17d1` refactor(onboarding): big centered card instead of fullscreen
- `f258ca1` fix(streak): use UTC dates in computeStreak and renderWeekBar
- `16953fb` feat: onboarding 4-slide tour for new users
- `865171a` perf(session): preload first 15 images before starting
- `b73dc7b` refactor(ui): unified end-session confirm modal for all 3 modes
- `74e202f` fix(challenge): durée illimitée pour les sessions challenge
- `3d5c130` fix(moodboard): restore webview, remove native boards + pin system
- `84ae44a` fix(auth): full page reload on logout for clean account switch
- `273cfe0` feat(cinema): lock all films except The Shining for free users
- `04ec260` fix(ui): plan-badge position — no longer overlaps profile button
- `7934165` fix(auth): link auth.css + use Syne/DM Sans fonts from gesturo.fr
- `924932a` fix(i18n): derniers accents manquants
- `d3fcb9d` fix(i18n): "Frame" → "Image" dans l'écran animation
- `dc974b6` fix(ui): z-index overlays sous la texture noise + boutons CTA
- `0d53906` fix(i18n): accents français manquants + tab "Feed" → "Fil"
- `e428186` feat(profile): user profile modal with editable username
- `eb68c25` Revert "feat(moodboard): restore webview browser + keep native boards"
- `ff98b0c` Reapply "feat(auth): polish login/signup screen + reset password"
- `b1c578e` feat(moodboard): restore webview browser + keep native boards
- `785c8a1` fix(moodboard): unify pin storage + FREE/PRO limits
- `8ad3011` feat(auth): email/password signup + login with username
- `ed8ada9` fix(moodboard): hide pin button on mobile/tablet
- `467d7df` feat(moodboard): replace webview with native boards system
- `fd8c289` feat(moodboard): pin images from Recap and Favorites
- `d864ae3` fix(ui): CTA communauté clean + badges stat card cliquable
- `e783169` feat(history+badges): badge detail modal + week activity chart
- `45f9537` feat(admin): R2 image picker for challenge ref image
- `4ad3446` feat(community): "Participer" lance session challenge + auto-share
- `dfd5b9c` feat(community): split feed by challenge — challenge posts first
- `0e279f0` feat(community): challenges "Draw this in your style"
- `291ebdd` feat(community): leaderboard "Top artistes" sub-tab
- `3f261d6` feat(mobile): add community & reactions methods to mobile shim
- `633303a` feat(community): "Mes dessins" tab + delete own posts
- `842a4e7` feat(community): camera capture on mobile/tablet
- `3607991` feat(community): share drawing from Recap + merged feed
- `c363420` fix(build-win): use icon.ico for NSIS installer/uninstaller icons
- `56404f0` feat(community): shared emoji reactions via Supabase + visual polish
- `eeb187f` chore: bump v0.2.1
- `707c8df` feat(tablet): refonte Session pose — controls flottants XL (768-1199)
- `deecc9a` feat(tablet): refonte Config — sidebar permanente + layout repensé
- `752f240` refactor(breakpoints): phone ≤767px pour libérer 768-1199 au tablet
- `396a71d` fix(security): enforce server-side Pro check on R2 functions
- `3915352` feat: add Capacitor Android scaffold + mobile web shim
- `96ee74c` refactor: move R2/Instagram/OAuth secrets server-side

## Pipeline d'agents

5 agents Gesturo dans `.claude/agents/` + 1 traducteur :

- **gesturo-translator** — traduit le langage naturel en brief technique,
  puis lance automatiquement l'orchestrateur
- **gesturo-orchestrator** — décompose un objectif en tickets atomiques
- **gesturo-frontend** — implémente tickets frontend (vanilla JS/CSS/HTML)
- **gesturo-backend** — implémente tickets backend (Electron, Edge Functions, admin)
- **gesturo-reviewer** — relit les tickets (sécu, conventions, non-régression)
- **gesturo-auditor** — bilan de session, mémoire, priorités suivantes