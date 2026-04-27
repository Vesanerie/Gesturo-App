# Performance (audit 2026-04-27)

15 fixes appliqués. Patterns à respecter pour ne pas régresser :

- **Pas de `innerHTML = ''` + full rebuild** dans les fonctions appelées
  fréquemment. `renderCategories`, `renderSelectionPile`, `renderCommunity`
  ont été optimisés — ne pas réintroduire de full rebuild au clic.
- **Toujours `clearInterval`** avant de détruire des DOM qui portent des
  intervals (ex: preview animation sur les seq cards).
- **`preloadCache`** borné à 20 séquences (`_evictPreloadCache()`). Appeler
  après chaque `preloadCache[x] = true`.
- **`loadHist()`** est caché 50ms via `_histCache` — ne pas bypasser avec
  `JSON.parse(localStorage...)` directement.
- **`bubbles.js`** se pause automatiquement hors `screen-config`. Ne pas
  retirer ce guard.
- **Textures SVG** (`body::before/::after` noise/paper) désactivées sur
  mobile+tablet via CSS. Ne pas overrider.
- **`renderHistList`** paginé à 50 items (`HIST_PAGE_SIZE`). Bouton
  "Voir plus" pour le reste.
- **Timeline animation** : thumbs lazy-loadées via `IntersectionObserver`
  (10 premières immédiates, reste au scroll).
- **Séquences** : preload par batches de 10 (`selectSeqPreload`), pas de
  `Promise.all` sur 200+ images.
- **Community feed** : hash comparison (`_lastCommunityHash`) pour skip le
  DOM rebuild quand les posts n'ont pas changé. Passer `forceRebuild=true`
  pour les actions user explicites (switch tab, filter, upload).
