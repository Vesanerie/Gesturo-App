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
                             (lit profiles.plan server-side).
  list-r2-photos/            Auth-gated, isPro résolu côté serveur.
  list-r2-animations/        Idem. Free user → free/ uniquement.
  list-instagram-posts/      Public (cache 1h). Token IG dans secrets.
  user-data/                 favoris/sessions/streak/refreshProStatus.
                             Auth via JWT, écriture via service role.
  stripe-webhook/            (existant, pas touché récemment)

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
- 🟡 Admin = marker file `~/.gesturo-admin` (mode 0o600), set via
  `auth-admin` + password de `whitelist.json`. Local-only, acceptable
  pour usage perso.
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
- **Bug latent connu** dans `styles/screens/config.css` :
  `.mod.mode-tab.active` ressemble à un typo (devrait être
  `.mode-tab.active`, qui existe par ailleurs). Préservé tel quel lors
  du refactor CSS — à corriger un jour.
- **Pour les onclicks dans `index.html`** : si tu renommes une fonction
  dans `src/app.js`, fais une passe `grep "nomFonction" index.html`.
- **`main.js` Electron** ≠ **`src/app.js` renderer** — ne jamais les
  confondre. Le main process écoute IPC, le renderer fait le UI.
- **Mobile shim** : si tu ajoutes une méthode à `window.electronAPI` côté
  desktop (preload.js), pense à la stub ou l'implémenter dans
  `mobile/mobile-shim.js`, sinon elle sera `undefined` sur Android.

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

- `803e53f` refactor(js): extract bubbles + cinema into src/
- `7803bd8` refactor(css): extract inline styles into styles/ modules
- `ced1c12` ci: add Android debug APK build workflow
- `396a71d` fix(security): enforce server-side Pro check on R2 functions
- `3915352` feat: add Capacitor Android scaffold + mobile web shim
- `96ee74c` refactor: move R2/Instagram/OAuth secrets server-side
