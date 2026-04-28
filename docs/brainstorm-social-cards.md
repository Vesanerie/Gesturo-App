# Brainstorm — App sociale pour dessinateurs (type Instagram)

## Concept retenu (2 piliers)

### 1. Une oeuvre par jour (page d'accueil)
- Dessin plein ecran, fond neutre, contemplatif
- Date discrete + numero de serie, pas de texte superflu
- Swipe pour naviguer dans les archives
- Notification quotidienne "le dessin du jour est arrive"

### 2. Cartes a collectionner echangeables (le coeur de l'app)
- Chaque dessin publie = une carte epuree (dessin + numero de serie, rien d'autre)
- Design minimaliste, pas de texte sur la carte
- Dos uniforme type carte a jouer (motif/logo de l'artiste)
- Rarete signifiee par la bordure :
  - Fine blanche = commun
  - Epaisse doree = rare
  - Holographique animee = unique

### Effets visuels
- Holo sur les cartes rares (gyroscope iPhone)
- Parallax leger qui suit le mouvement du telephone
- Flip 3D avec animation de poids
- Haptic feedback (Capacitor Haptics)
- Ombre portee dynamique

---

## Mecanique sociale — l'echange

Les utilisateurs echangent leurs cartes (= leurs dessins) contre ceux des autres pour constituer leur propre collection d'art. C'est du troc d'art sous forme de cartes.

### Questions ouvertes a trancher

| Question | Options |
|---|---|
| Qui cree des cartes ? | Tout le monde / dessinateurs verifies / acces merite |
| Tirage par dessin ? | Limite (l'artiste decide) ou illimite |
| Comment obtenir ses premieres cartes ? | Ses propres dessins / starter pack / packs |
| Mecanique d'echange ? | 1 contre 1 / marketplace / matchmaking |
| Valeur des cartes ? | Toutes egales / rarete / marche libre |
| Monetisation ? | Gratuit / packs payants / abonnement |

---

## Points d'attention

- **App Store** : eviter l'argent reel ou respecter les regles Apple
- **Droits d'auteur** : definir ce que "posseder une carte" signifie legalement
- **Moderation** : empecher le vol de dessins (upload du travail d'un autre)
- **Positionnement** : concept proche des NFT mais sans blockchain ni speculation

---

## Idees bonus a garder

- **Editions limitees** + "premiere edition" marquee (type 1st edition Pokemon)
- **Historique de la carte** : parcours entre proprietaires visibles
- **Cartes "vintage"** : marque speciale si pas echangee depuis longtemps
- **Collection croisee** : badge si tu possedes une carte de chaque artiste suivi
- **Palette interactive** : filtre par couleur dominante
- **Devine le process** : voir le croquis avant le rendu final (swipe up pour reveler)

---

## Idees de page perso eliminees

- Livre qu'on feuillette → mal adapte a l'ecran vertical iPhone
- Mur de galerie horizontal → fatigue du pouce
- Portfolio en cuir → animations lourdes, peu d'espace utile
- Galerie 3D → trop lourd en webview

---

## Stack technique

- **Capacitor** pour iOS (+ Android/web potentiel)
- Framework web par-dessus (a confirmer)
- Gyroscope iOS pour effets holo
- Capacitor Haptics pour feedback tactile

---

*Brainstorm du 28/04/2026*
