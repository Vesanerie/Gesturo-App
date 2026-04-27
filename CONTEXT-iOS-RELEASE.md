# Contexte pour Claude — Release iOS Gesturo

## C'est quoi Gesturo

App de **gesture drawing** (dessin de poses chronométrées). Desktop Electron + mobile Capacitor 8. Vanilla JS, pas de framework, pas de bundler. Backend Supabase + Cloudflare R2 pour les images.

**Repo** : `/Users/mardoukhaevvalentin/Documents/Gesturo Project/Gesturo-App/`
**GitHub** : `Vesanerie/Gesturo-App`, branch `main`

## Stack

- **Desktop** : Electron 41, auto-update via electron-updater
- **Mobile** : Capacitor 8 (iOS + Android). iOS testé sur device
- **Backend** : Supabase (Auth + Postgres + Edge Functions Deno) + Cloudflare R2
- **Admin** : `admin-web/` sur Cloudflare Pages (`gesturo-admin.pages.dev`)
- Vanilla JS, pas de TS, pas de bundler, pas de lint

## Fichiers clés

```
main.js                  Electron main process
preload.js               Bridge IPC → window.electronAPI
src/app.js               Renderer principal (boot, auth, R2)
src/categories.js        Catégories, séquences, sélection
src/session.js           Session pose, timer
src/animation.js         Animation frames
src/options.js           Historique, badges, profil, settings
src/favorites.js         Favoris, sync serveur, _scopedKey
src/community.js         Feed communauté

mobile/
  mobile-shim.js         Réimplémente window.electronAPI pour Capacitor
  auth-mobile.js         Auth Supabase PKCE + deep link
  offline-manager.js     Téléchargement packs offline (Capacitor Filesystem)

scripts/
  sync-web.js            Copie les sources dans www/ + injecte scripts mobile
  r2.js                  CLI pour gérer le bucket R2

index.html               Markup principal (~725L, 74 onclick inline)
capacitor.config.json    Config Capacitor (iosScheme: https)
```

## Règles CRITIQUES

1. **JAMAIS copier manuellement dans www/**. Toujours : `node scripts/sync-web.js && npx cap sync ios`
   - `sync-web.js` injecte les `<script>` mobile (auth-mobile.js, mobile-shim.js, offline-manager.js, supabase-config.js) dans www/index.html
   - Un `cp` direct écrase ces injections et casse tout le mobile

2. **Après modif `preload.js`** → vérifier que `mobile/mobile-shim.js` expose les mêmes méthodes

3. **Après modif `src/app.js`** → vérifier que les `onclick="xxx()"` de `index.html` correspondent à des fonctions existantes

4. **Vanilla JS only** — pas de modules, pas de bundler. Toutes les fonctions sont globales

5. **localStorage scopé par email** — `_scopedKey(base)` dans `src/favorites.js` ajoute `:email` aux clés. `_communityEmail` doit être set avant de lire/écrire

6. **Push auto** après chaque modif. Pas de questions, autonomie max. Français.

## État actuel — ce qui marche

- Auth (Google + email/password) desktop + mobile
- Catalogue R2 (1920 poses, 613 frames animation, 5 thèmes)
- Sessions chronométrées (pose + animation)
- Historique, badges, streak (sync serveur)
- Communauté (upload, challenges, modération)
- Admin web 14 onglets
- Cinéma (films de référence)
- Favoris + moodboard (desktop)
- Auto-update desktop
- Mode jour/nuit

## Ce qui est CASSÉ / à faire pour la release iOS

### P0 — Bloquants release

1. **Stripe en mode test**
   - Les clés Stripe sont en mode test dans les Edge Functions
   - Il faut basculer vers les clés live dans Supabase secrets
   - Vérifier le webhook endpoint pointe vers prod

2. **Politique de confidentialité**
   - Apple exige une URL `privacyPolicyUrl` dans le store listing
   - Le fichier `privacy.html` existe sur gesturo.fr mais est peut-être incomplet
   - Doit couvrir : données collectées (email, sessions, photos communauté), stockage (Supabase), partage (aucun tiers), suppression (sur demande)

3. **Screenshots App Store**
   - Formats requis : iPhone 6.7" (1290×2796), iPhone 6.5" (1284×2778), iPad 12.9" (2048×2732)
   - Montrer : écran d'accueil, session pose, animation, communauté, cinéma
   - Les screenshots existants sont dans `assets/screenshots/` mais à vérifier/refaire

### P1 — Important mais pas bloquant

4. **CSP unsafe-inline**
   - 74 `onclick="..."` dans index.html forcent `unsafe-inline` dans la CSP
   - Migration vers `addEventListener` serait idéale mais gros chantier

5. **Secrets .env à rotater**
   - Les credentials R2 dans `.env` n'ont jamais été rotatés
   - `npx supabase secrets list` pour vérifier ce qui est en prod

6. **Android jamais testé sur device réel**
   - Build APK fonctionne en CI mais jamais lancé sur un vrai device

7. **Modération auto images**
   - Code prêt (`moderateImage()` avec Claude Haiku)
   - Manque la clé Anthropic : `npx supabase secrets set ANTHROPIC_API_KEY=...`

## Bugs connus fixés récemment (ne pas régresser)

- `renderHist()` crashait si `hist-streak` n'existe pas dans le HTML → null guard ajouté
- `openProfile()` lisait `localStorage.getItem('gd4_history')` au lieu de `loadHist()` → fixé
- `renderWeekBar()` appelé avant `_communityEmail` set → second appel après auth ajouté
- `www/index.html` manquait les scripts mobile → toujours utiliser `sync-web.js`
- `assets/` pas copié dans `www/` → ajouté dans `sync-web.js`
- Text selection mobile → `user-select: none` global sur body

## Comment builder et tester

```bash
# Desktop
npm start

# Mobile iOS
node scripts/sync-web.js && npx cap sync ios
npx cap open ios
# Puis Run dans Xcode sur device/simulateur

# Après toute modif de fichier source
node scripts/sync-web.js && npx cap sync ios
# JAMAIS de cp manuel vers www/
```

## Tables Supabase

`profiles`, `community_posts`, `post_reactions`, `challenges`, `moderation_log`, `announcements`, `feature_flags`, `app_settings`, `client_errors`, `user_sessions`, `favorited_images`, `rotations`, `rotation_files`

## Conventions

- Breakpoints : phone ≤767px, tablet 768-1399px, desktop ≥1400px
- Tap zones ≥ 44px, safe-area-insets
- Pas d'emoji sauf demande explicite
- Commits concis en anglais, push auto
