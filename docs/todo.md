# TODO

## P0 — Release iOS
- **Stripe prod** — basculer les clés test → live dans Supabase secrets
- ~~Politique de confidentialité~~ — fait (gesturo.fr/privacy.html)
- ~~Screenshots App Store~~ — fait (assets/screenshots/)

## P1
- ~~Réactiver `webSecurity`~~ — déjà fait (`webSecurity: true` dans main.js)
- **Offline packs CORS** — fetch() bloqué depuis Capacitor WebView.
  Solutions : config CORS R2, ou img+canvas, ou cacher la feature pour v1.
  NE PAS utiliser CapacitorHttp (casse le chargement images).

## P2 — UX
- ~~Widget iOS~~ — fait (challenge du jour, 3 tailles, deep link Participer)
- **Bouton profil/dessins en bas à droite** — style tab bar Instagram.
  Bouton cliquable (bottom-right) qui ouvre une vue avec les dessins de
  l'utilisateur et son profil. UX réseau social, accès rapide au contenu perso.

## À faire plus tard
- **Modération auto images** — code prêt (`moderateImage()`, Claude Haiku
  ~$0.001/image). Manque la clé API Anthropic. Pour activer :
  `npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-api03-...`
- **Phase D — Rotations** — DB prête (tables rotations/rotation_files).
  Reste : Edge Functions (create/schedule/execute) + UI admin.
- ~~Email user / Broadcast email~~ — opérationnel (Resend API configuré)
- **Stripe dashboard admin** — lire stripe-webhook, ajouter adminGetStripeData
- **Bannière annonce sur gesturo.fr** — reprendre la modale dans le site
- **1er run Android device** — iOS OK, Android pas encore testé
- ~~Tests~~ — vitest en place, 5 suites, `npm test`
