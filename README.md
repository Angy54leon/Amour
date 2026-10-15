# L'amour des deux zigs 💞

Un album de souvenirs romantique et interactif : un bouton taquin qui esquive trois fois,
vos photos et vidéos dans un ordre surprise, un titre toujours présent et une déclaration
finale : « Je t'aime mon coeur ❤️ ».

Aucune dépendance à installer : HTML, CSS et JavaScript, plus quelques scripts Node.js
facultatifs (Node 18 ou plus récent).

---

## 1. Lancer le site sur l'ordinateur

```bash
npm start
```

Ouvre ensuite **http://localhost:8080**, puis clique sur **« Ajouter nos souvenirs »**
(ou **« Choisir le dossier nos-souvenirs »**), puis sur **« Commencer la surprise ✨ »**.

Les fichiers sont lus par le navigateur et ne sont **envoyés nulle part**.

---

## 2. Utiliser l'album depuis l'iPhone

Le bouton **« Ajouter nos souvenirs »** ouvre la photothèque de l'iPhone dans Safari. Touche
plusieurs photos et vidéos, puis valide. Tu peux recommencer pour en ajouter d'autres, sans
créer de doublons. Pas besoin de Google Drive ni de passer par le PC.

Il faut d'abord que le site soit accessible depuis le téléphone. Deux solutions :

### A. Depuis ton PC, sur le même Wi-Fi (rapide, gratuit, temporaire)

1. Sur le PC : `npm start`. Le terminal affiche une adresse du type
   `Sur l'iPhone (même Wi-Fi) : http://192.168.1.42:8080`.
2. Sur l'iPhone, connecté au **même Wi-Fi**, ouvre cette adresse dans **Safari**.
3. Sous Windows, si la page ne charge pas, autorise Node.js dans le pare-feu
   (fenêtre « Autoriser l'accès » au premier lancement, réseau **privé**).

Limite : le PC doit rester allumé avec `npm start` lancé, et cela ne marche que chez toi.

### B. En ligne, sans PC (recommandé)

Le **code** du site ne contient **aucune photo**. On peut donc le publier sans risque, puis
ajouter les souvenirs directement depuis l'iPhone.

**GitHub Pages** (le workflow est déjà prêt dans `.github/workflows/pages.yml`) :

1. Fusionne cette branche dans `main`.
2. Sur GitHub : **Settings → Pages → Source : « GitHub Actions »**.
3. Chaque push sur `main` publie le site. L'adresse apparaît dans **Settings → Pages**
   (du type `https://<ton-compte>.github.io/<dépôt>/`).
   Sur un compte gratuit, GitHub Pages exige un dépôt public : c'est sans danger ici,
   puisque `nos-souvenirs/` est exclu du dépôt par le `.gitignore`.

**Ou Netlify Drop**, sans compte GitHub : lance `npm run build:site`, puis glisse le dossier
`dist/` sur https://app.netlify.com/drop.

Astuce : dans Safari, **Partager → « Sur l'écran d'accueil »** donne une icône d'app et un
affichage plein écran.

---

## 3. Garder les souvenirs entre deux visites : ce qui est vrai

| Méthode | Où sont les fichiers ? | Durée de vie | Partageable ? |
|---|---|---|---|
| Import simple (par défaut) | En mémoire, dans l'onglet | **Perdus** à la fermeture ou au rechargement de la page | Non |
| Interrupteur **« Garder ces souvenirs sur cet appareil »** | Stockage du navigateur (IndexedDB), sur **ce** téléphone, dans **ce** navigateur | Jusqu'à ce que le navigateur les efface (voir ci-dessous) | Non |
| **Version hébergée** (`npm run build`) | Sur l'hébergeur, avec le site | Tant que le site est en ligne | **Oui**, via le lien |

À propos de l'interrupteur « Garder sur cet appareil » :

- les fichiers ne quittent pas le téléphone, et ta copine ne les verra pas sur **son** téléphone ;
- Safari peut les effacer : manque de place, données de sites effacées, navigation privée,
  ou site non visité pendant un certain temps (Safari applique une règle d'environ 7 jours
  aux sites non ajoutés à l'écran d'accueil). Ajouter le site à l'écran d'accueil aide ;
- **ce n'est pas une sauvegarde** : garde toujours les originaux dans Photos.

### Partager l'album complet avec ta copine (médias hébergés)

1. Copie ton dossier `nos-souvenirs` à la racine du projet (il est ignoré par Git).
2. Installe [ffmpeg](https://ffmpeg.org/download.html) (conseillé), puis lance :
   ```bash
   npm run build
   ```
   Le dossier `dist/` contient le site, les médias et `souvenirs.json`. Les vidéos sont
   recompressées en MP4 H.264 (1280 px max) pour se charger vite sur un téléphone, et
   les vidéos illisibles sont écartées. Options : `--max-video=1920`, `--copie-brute`,
   `--source=chemin`.
3. Mets `dist/` en ligne : glisse-le sur Netlify Drop, par exemple. Vérifie les limites
   de taille de ton hébergeur : certains refusent les fichiers de plus de 25 Mo, et le
   script te prévient le cas échéant.
4. Envoie-lui le lien : l'écran d'accueil s'ouvre directement sur « Tu veux voir le bonheur ? ».

⚠️ **Confidentialité** : toute personne qui a le lien peut voir les photos. Le site demande
aux moteurs de recherche de ne pas l'indexer (`noindex`), mais ce n'est pas une protection.
Ne publie **jamais** `nos-souvenirs/` sur un dépôt GitHub public. Pour un vrai accès privé,
utilise un hébergeur avec mot de passe (option souvent payante) ou un stockage avec
connexion (Firebase, Supabase…), ce qui demande un vrai développement en plus.

Variante sans hébergement, sur le Wi-Fi local : place `nos-souvenirs/` dans le projet,
lance `npm run liste` puis `npm start`. Tout appareil du réseau ouvre alors directement
l'album. Ajoute `?ajouter` à l'adresse pour revenir à l'écran d'import.

---

## 4. Formats pris en charge

- **Photos** : JPG, JPEG, PNG, WEBP, GIF, AVIF, HEIC et HEIF.
  - Sur iPhone, Safari fournit en général les photos HEIC directement en JPEG compatible.
  - Dans un navigateur qui ne lit pas le HEIC (Chrome, Firefox…), elles sont
    **converties en JPEG dans le navigateur** (`js/vendor/heic2any.min.js`, licence MIT,
    chargé uniquement si besoin).
- **Vidéos** : MP4, MOV, M4V, WEBM.
  - Les MOV en HEVC (iPhone) se lisent dans Safari, mais pas forcément dans Chrome sous
    Windows. L'import le détecte, les met de côté et le signale. `npm run build` les
    convertit en MP4 H.264, lisible partout.
- Les fichiers cachés (`._IMG…`, `.DS_Store`), les doublons et les fichiers vides sont ignorés.

---

## 5. Ce que fait l'album

- **Bouton taquin** : les tentatives 1, 2 et 3 (clic, toucher ou clavier) le font esquiver
  vers un autre endroit de l'écran, sans jamais sortir de l'écran. La 4e ouvre l'album.
- **Ordre surprise** : mélange aléatoire à chaque lecture, avec les vidéos réparties entre
  les photos (pas deux vidéos d'affilée quand c'est possible) et les photos prises en
  rafale écartées les unes des autres. Chaque souvenir apparaît une fois par lecture.
- **9 transitions** qui varient (fondu, zoom, envol, page qui tourne, glissé, profondeur,
  flou, rebond, polaroïd), sans que deux souvenirs se superposent.
- **Vidéos** lues jusqu'au bout avec le son. Si le navigateur bloque le son automatique,
  un bouton « Lancer la vidéo » apparaît. Un seul lecteur vidéo pour tout l'album.
- **Navigation** : boutons ‹ ❚❚ ›, compteur « 7 / 42 », flèches du clavier, espace,
  balayage gauche/droite sur téléphone, toucher sur la vidéo pour pause/lecture.
- **Mémoire** : URL `blob:` créées à la demande et révoquées dès qu'elles ne servent plus
  (seuls le souvenir précédent, l'actuel et le suivant restent ouverts). Une seule vidéo
  est chargée à la fois.
- **Accessibilité** : si le système demande de réduire les animations, les transitions
  deviennent de simples fondus.
- **Fin** : « Je t'aime mon coeur ❤️ » et un bouton « Revoir l'album » (nouvel ordre).

---

## 6. Personnaliser

- Durée d'affichage d'une photo : `PHOTO_DURATION_MS` dans `js/album.js` (6 s par défaut).
- Petites phrases du bouton taquin : `TEASES` dans `js/intro.js`.
- Couleurs et polices : variables en haut de `css/style.css`.

## 7. Organisation

```
index.html            écrans : import, accueil, album, fin
css/style.css         direction artistique et animations
js/utils.js           outils (hasard, tailles…)
js/library.js         import des fichiers, contrôle, conversion HEIC, URL blob
js/storage.js         option « Garder sur cet appareil » (IndexedDB)
js/playlist.js        mélange intelligent
js/intro.js           le bouton qui esquive 3 fois
js/album.js           lecteur, transitions, vidéos, gestes
js/app.js             enchaînement des écrans
js/exif.js            date de prise de vue (affichée sous la photo)
js/hearts.js          cœurs décoratifs
scripts/serve.mjs     serveur local (Wi-Fi, lecture vidéo par plages)
scripts/generer-liste.mjs  crée souvenirs.json depuis nos-souvenirs/
scripts/build.mjs     prépare dist/ pour la mise en ligne
```
