# Feature : "Une œuvre par jour" — Page d'accueil

## Contexte

App Gesturo (Electron + Capacitor iOS). Vanilla JS, pas de framework.
Bottom tab bar mobile existante dans `index.html` (`#bottom-tab-bar`).
L'onglet doit s'intégrer comme premier tab de la barre (position gauche).

## Concept

Page contemplative affichée au lancement. L'utilisateur voit UN dessin
de la communauté mis en avant chaque jour. Pas de feed, pas de scroll infini :
une seule œuvre, plein écran, comme une galerie d'art.

## Layout principal

- **Fond neutre** : blanc cassé (`#f5f0eb`) ou noir (`#0a0e18`) selon le
  thème jour/nuit (respecter le thème existant de l'app)
- **Dessin plein écran** : centré, `object-fit: contain`, occupe ~70% de
  la hauteur visible. Ombre douce ou pas d'ombre selon le fond
- **Date du jour** : en haut, discrète, typo Syne 13px, couleur `#4a5870`
  Format : "Lundi 28 avril 2026"
- **Titre** : sous le dessin, 16px bold, couleur principale
- **Phrase de l'artiste** : sous le titre, 13px italic, couleur muted
  (humeur, contexte, technique — ex: "Encre de Chine, 45 min, inspiré par Egon Schiele")
- **Aucun bouton visible** au premier abord — on contemple

## Gestures (mobile)

### Swipe up → Détails
Révèle un panel bottom-sheet avec :
- Technique utilisée (ex: "Crayon graphite HB")
- Temps passé
- Inspirations citées par l'artiste
- Croquis préparatoires (carousel horizontal si plusieurs images)
- Bouton "Voir le profil de l'artiste"

### Swipe down → Archives
Transition vers une grille scrollable des œuvres des jours précédents.
Chaque card = miniature + date. Tap → ouvre l'œuvre en plein écran
(même layout que la page principale).

### Swipe gauche → Carte à collectionner
Transition slide-left vers une "carte" stylisée du dessin :
- Format carte (aspect ratio 2.5:3.5, coins arrondis 16px)
- Dessin en haut (60%), infos en bas (40%)
- Nom artiste, date, numéro (#127), badge rareté
- Fond dégradé peach→lavande (palette Gesturo)
- Animation d'apparition (scale 0.8→1 + fade)

### Tap long → Mode respiration
- Tout disparaît sauf le dessin (date, titre, tab bar, status bar)
- Fond pur (blanc ou noir)
- Le dessin pulse très légèrement (scale 1→1.01→1, cycle 4s, ease)
- Tap n'importe où pour sortir
- Ambiance méditative

## Intégration bottom tab bar

- Nouvel onglet **"Œuvre"** en première position (icône : petit cadre/tableau)
- Les autres onglets se décalent d'un cran à droite
- C'est le tab actif par défaut au lancement (au lieu de Config)
- Sur desktop (≥1400px) : intégré dans la sidebar gauche, premier item

## Données

### Source
Les œuvres viennent de `community_posts` (table Supabase existante).
Un post est "œuvre du jour" s'il a le flag `featured: true` dans la table.
L'admin met en avant une œuvre par jour via l'onglet Modération existant.

### Champs nécessaires
- `image_url` : URL R2 du dessin
- `user_id` → `profiles.display_name` : nom de l'artiste
- `caption` : phrase de l'artiste
- `created_at` : date
- Nouveaux champs optionnels à ajouter à `community_posts` :
  - `technique` (text, nullable)
  - `time_spent` (text, nullable, ex: "45 min")
  - `inspirations` (text, nullable)
  - `prep_sketches` (text[], nullable — URLs R2 des croquis préparatoires)

### API
- Endpoint existant `user-data` action `getCommunityPosts` avec filtre `featured=true`
- Ou nouvel action `getFeaturedPost` qui retourne le dernier post featured
  + les 30 précédents pour les archives

## Fichiers à créer/modifier

### Nouveau
- `src/oeuvre.js` — logique de la page (fetch, render, gestures, archives)
- `styles/screens/oeuvre.css` — styles spécifiques

### À modifier
- `index.html` — ajouter `#screen-oeuvre` + tab dans `#bottom-tab-bar`
- `src/app.js` — `showScreen('screen-oeuvre')` au boot, gestion du tab actif
- `styles/components/tab-bar.css` — ajuster pour le nouveau tab
- `supabase/functions/user-data/index.ts` — action `getFeaturedPost`

## Contraintes techniques

- **Performance** : une seule image à charger, pas de feed. Preload l'image
  pendant le splash screen si possible.
- **Offline** : si pas de réseau, afficher la dernière œuvre cachée en
  localStorage (image en base64 ou URL cachée par le service worker)
- **Safe areas** : respecter `env(safe-area-inset-top)` et bottom
- **Tap zones ≥ 44px** sur mobile
- **Pas de innerHTML rebuild** au changement de jour — juste updater le contenu
- **Animations** : CSS transitions/animations uniquement, pas de librairie
  JS d'animation. `transition: 0.3s ease` pour les panels.
- **Breakpoints** : phone ≤767px, tablet 768-1399px, desktop ≥1400px
- Tests : ajouter les onclick dans le test `html-integrity`

## UX priorités

1. La contemplation d'abord — l'UI doit disparaître
2. Les gestures sont progressives (rien de forcé)
3. Le mode respiration est le moment "zen" de l'app
4. Les archives donnent un sentiment de collection/progression
5. La carte à collectionner ajoute un côté ludique/partage
