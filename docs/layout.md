# Layout projet

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
  app.js                     Core renderer (~553L) — chargé en premier
  categories.js              Catégories + séquences + pile sélection (~620L)
  community.js               Feed, challenges, upload, share (~1110L)
  session.js                 Session pose, timer, preload (~290L)
  animation.js               Animation, study mode, timeline (~420L)
  favorites.js               Favoris, moodboard pin, sync (~461L)
  options.js                 Options, profil, badges, onboarding (~1560L)
  cinema.js                  Films catalog + playback (~219L)
  bubbles.js                 Animation canvas d'accueil (~44L)
  haptics.js                 Retour tactile Capacitor (light/medium/success)
  mobile-native.js           Splash, swipe gestures, toasts, PTR

mobile/
  mobile-shim.js             Réimplémente window.electronAPI via Capacitor
  auth-mobile.js             Supabase PKCE + deep link (+ widget deep links)

ios/App/GesturoWidget/
  GesturoWidget.swift        Entry point WidgetBundle
  PoseOfDayWidget.swift      Provider (download+resize image) + entry + config
  PoseOfDayView.swift        Vues small/medium/large, GeometryReader constrained
ios/App/App/
  GesturoWidgetBridge.swift  Plugin Capacitor → UserDefaults App Group + reload
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
