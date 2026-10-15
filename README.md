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

**Vercel** (le fichier `vercel.json` est déjà prêt) :

1. Sur vercel.com : **Add New… → Project**, importe le dépôt GitHub `Amour`.
2. Laisse **Framework Preset : Other** et **Root Directory** vide. Pas besoin de remplir
   Build Command ni Output Directory : `vercel.json` impose `npm run build` et `dist`.
3. **Deploy**. Chaque nouveau push sur la branche de production redéploie le site.

Le build n'a besoin d'**aucun média** : `nos-souvenirs/` n'est jamais envoyé sur Git ni sur
Vercel (`.gitignore`, `.vercelignore`). Le script de build produit alors le site seul, et
les souvenirs s'ajoutent depuis l'iPhone.

Astuce : dans Safari, **Partager → « Sur l'écran d'accueil »** donne une icône d'app et un
affichage plein écran.

---

## 3. Garder les souvenirs entre deux visites : ce qui est vrai

| Méthode | Où sont les fichiers ? | Durée de vie | Partageable ? |
|---|---|---|---|
| Import simple (par défaut) | En mémoire, dans l'onglet | **Perdus** à la fermeture ou au rechargement de la page | Non |
| Interrupteur **« Garder ces souvenirs sur cet appareil »** | Stockage du navigateur (IndexedDB), sur **ce** téléphone, dans **ce** navigateur | Jusqu'à ce que le navigateur les efface (voir ci-dessous) | Non |
| **Version hébergée** (`npm run build`) | Sur l'hébergeur, avec le site | Tant que le site est en ligne | **Oui**, via le lien |
| **Album en ligne privé** (Vercel Blob, voir § 3 bis) | Stockage Vercel Blob **privé** | Tant que tu ne les supprimes pas | **Oui**, avec le code |

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
   Le dossier `dist/` contient le site, les médias et `souvenirs.json`. Si le dossier
   `nos-souvenirs/` est absent ou vide, le build ne plante pas : il produit le site seul. Les vidéos sont
   recompressées en MP4 H.264 (1280 px max) pour se charger vite sur un téléphone, et
   les vidéos illisibles sont écartées. Options : `--max-video=1920`, `--copie-brute`,
   `--source=chemin`.
3. Mets `dist/` en ligne : glisse-le sur Netlify Drop, ou avec la CLI Vercel
   `npx vercel deploy dist --prod`. Vérifie les limites
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

## 3 bis. Album en ligne privé (Vercel Blob) — recommandé

Tu envoies tes photos et vidéos **depuis l'iPhone**, elles sont stockées en ligne, et le même
album s'affiche sur **tous les appareils** : iPhone, PC, téléphone de ta copine.

### Mes souvenirs ont disparu après réouverture : que s'est-il passé ?

Si l'album en ligne n'est pas **entièrement** configuré, le site ne peut rien enregistrer et
utilise l'import local, qui garde les fichiers seulement dans l'onglet ouvert. Cela arrive si :
- le stockage ou une variable manque (`ALBUM_CODE`, `ADMIN_CODE`, `SESSION_SECRET`) ;
- le site n'a pas été redéployé après l'ajout des variables ;
- une ancienne version est déployée.

Jusqu'ici, rien ne te prévenait. Désormais, l'écran d'import affiche toujours un **bandeau
d'état** :

| Bandeau | Signification |
|---|---|
| ☁️ vert « Sauvegarde en ligne active » | Chaque fichier affiche « ✓ enregistré en ligne » une fois vérifié par le serveur |
| ⚠️ orange « Sauvegarde en ligne non configurée… Il manque sur Vercel : … » | Ajoute les variables listées, puis redéploie |
| ⚠️ orange « Le serveur de l'album ne répond pas (/api/session : erreur …) » | Le déploiement n'a pas de fonctions `/api`, ou elles plantent : redéploie la dernière version, puis consulte Vercel → **Logs** |
| 👀 « code de l'album (lecture seule) » | Tu es connecté avec `ALBUM_CODE` : ce que tu ajoutes n'est pas sauvegardé. Touche « Changer de code » et utilise `ADMIN_CODE` |
| 📱 « cet appareil uniquement » | Tu as choisi de ne rien envoyer en ligne |

Vérification rapide : ouvre `https://<ton-site>.vercel.app/api/session`.
- Une page 404 signifie que les fonctions ne sont pas déployées.
- `"configured":false` : la liste `missing` dit ce qu'il manque.
- `"configured":true` : tout est prêt.

Une fois connecté avec `ADMIN_CODE`, le bouton **« 🔎 Tester la sauvegarde en ligne »** fait
un vrai essai : écriture d'un fichier test, vérification, relecture par lien signé, accès à
la base (Supabase), puis suppression. Chaque étape affiche ✓ ou ✗ avec le message exact.

### Confirmation fichier par fichier

Pendant l'envoi, chaque fichier passe par ces états : *en attente* → *envoi xx %* →
*vérification…* → **✓ enregistré en ligne** (ou **✗ raison**).

Le « ✓ » n'apparaît que lorsque le serveur a vérifié que le fichier est réellement présent
dans le stockage, avec la bonne taille, et l'a inscrit dans l'album (route `/api/confirmer`).
Après chaque envoi, la liste est relue depuis le serveur : c'est elle qui fait foi.

### Option B : Supabase Storage + base de données

Si tu préfères Supabase à Vercel Blob :
- les fichiers vont dans un **bucket privé** ;
- la liste des médias est tenue dans une **table `souvenirs`** : une ligne est ajoutée
  seulement après vérification du fichier.

1. Crée un projet sur supabase.com.
2. Dans **SQL Editor**, colle et exécute `supabase/schema.sql`. Ce script crée le bucket
   privé `souvenirs` et la table avec RLS : les clés publiques ne peuvent rien lire.
3. Dans **Project Settings → API**, récupère :
   - l'**URL** du projet ;
   - la clé **secrète** (`service_role`, ou `sb_secret_…`). Elle ne va que sur Vercel, jamais
     dans le code.
4. Dans Vercel → **Settings → Environment Variables**, ajoute `SUPABASE_URL` et
   `SUPABASE_SERVICE_ROLE_KEY`, plus `ALBUM_CODE`, `ADMIN_CODE` et `SESSION_SECRET`.
   Ne garde **pas** `BLOB_READ_WRITE_TOKEN` en même temps : s'il est présent, Vercel Blob
   est prioritaire.
5. Redéploie, puis lance « 🔎 Tester la sauvegarde en ligne ».

Limites à connaître (offre gratuite, à vérifier sur supabase.com/pricing) :
- environ **1 Go** de stockage ;
- **50 Mo maximum par fichier** par défaut : les longues vidéos d'iPhone peuvent dépasser,
  et seront alors signalées « ✗ trop volumineux » ;
- un projet gratuit est **mis en pause après 7 jours d'inactivité** : il faut alors le
  réactiver dans le tableau de bord.

Pour un album avec des vidéos, Vercel Blob reste l'option la plus simple.

### Redéployer

1. Pousse la dernière version de la branche suivie par Vercel (Settings → Git →
   Production Branch).
2. Après tout ajout ou changement de variable, lance **Deployments → ⋯ → Redeploy** sur le
   **dernier** déploiement de cette branche : les variables ne s'appliquent qu'aux nouveaux
   déploiements.
3. Vérifie `/api/session`, puis le bouton « 🔎 Tester la sauvegarde en ligne ».

### Comment c'est protégé

- Le magasin Vercel Blob est **privé** : aucun fichier n'a d'adresse publique.
- On entre dans l'album avec un **code** :
  - `ALBUM_CODE`, à lui donner : il permet de **voir** l'album ;
  - `ADMIN_CODE`, à garder pour toi : il permet de voir, **envoyer** et **supprimer**.
- Le serveur vérifie le code, puis pose un cookie de session signé (`HttpOnly`). Les médias
  sont ensuite lus par des **liens signés qui expirent** au bout de 24 h au maximum.
- **Aucune clé secrète dans le navigateur.** Le jeton `BLOB_READ_WRITE_TOKEN` reste sur le
  serveur. Pour chaque envoi, le téléphone reçoit un jeton temporaire limité à un seul
  fichier, à un nom imposé et aux formats photo/vidéo.
- Changer un code dans Vercel (puis redéployer) déconnecte les sessions ouvertes avec l'ancien.
- Choisis des codes longs (une petite phrase). Les mauvais codes sont ralentis, mais le
  site n'a pas de verrouillage après plusieurs essais.

### Limites et coûts (vérifiés en octobre 2026, à reconfirmer sur vercel.com/pricing)

- Offre **Hobby** (gratuite, usage personnel et non commercial), d'après la page de tarifs
  de Vercel :
  - **1 Go** de stockage Blob ;
  - **10 Go** de transfert Blob par mois ;
  - **10 000** opérations simples et **2 000** opérations avancées par mois (un envoi ou un
    affichage de la liste = une opération avancée).
- Ce que ça représente :
  - un album d'environ 300 Mo tient dans le stockage ;
  - regarder tout l'album consomme à peu près son poids en transfert (environ 30 visionnages
    complets par mois pour 300 Mo) ;
  - les grosses vidéos pèsent vite lourd.
- En cas de dépassement sur Hobby, consulte l'onglet **Usage** : Vercel peut limiter le
  service jusqu'au mois suivant ou proposer de passer à l'offre Pro, qui est payante.
- Pourquoi pas Supabase Storage ? Il est aussi très bien, mais un projet gratuit se met en
  pause après 7 jours d'inactivité. Avec Vercel Blob, ton site et tes fichiers restent au
  même endroit, sans compte supplémentaire.

### Mise en place (une seule fois)

Comment le site utilise Vercel Blob :
- **Envoi** : le navigateur envoie chaque fichier directement à Vercel Blob (« client
  upload » du SDK officiel `@vercel/blob`), en plusieurs morceaux à partir de 8 Mo, avec
  reprise automatique. Les fichiers ne passent pas par les fonctions Vercel, donc la limite
  de 4,5 Mo de leur corps de requête ne s'applique pas.
- **Autorisation d'envoi** : la fonction `api/televersement` délivre une autorisation
  limitée à un seul fichier, à un nom imposé, aux formats photo/vidéo, à 1 Go, sans
  écrasement possible et valable 1 h. Elle n'est délivrée qu'avec le code administrateur.
- **Confirmation** : un fichier n'est compté qu'après l'acceptation par Vercel, puis la
  vérification serveur `head()` (fichier présent et bonne taille, via `api/confirmer`).
- **Liste** : `list({ prefix: 'souvenirs/' })` relit le contenu réel du Blob Store. Les
  informations d'affichage (date, nom) sont rangées dans le nom du fichier, donc aucune base
  de données n'est nécessaire et la liste ne peut pas diverger du stockage.
- **Lecture** : uniquement par liens signés temporaires (`presignUrl`, 24 h au maximum).

Étapes dans Vercel :

1. **Connecter le Blob Store au projet** : Vercel → **Storage** → ton Blob Store →
   **Projects** (ou **Connect Project**) → choisis « L'amour des deux zigs », coche
   **Production** et **Preview**, puis garde le préfixe proposé **`BLOB`**. Vercel ajoute
   alors l'accès au stockage, sous l'une de ces deux formes (le site gère les deux) :
   - `BLOB_READ_WRITE_TOKEN` (jeton classique) ;
   - `BLOB_STORE_ID` (connexion OIDC sans jeton secret ; Vercel fournit le reste à
     l'exécution).

   Vérifie dans **Settings → Environment Variables** que l'une des deux apparaît. Si tu
   as choisi un autre préfixe, la variable aura un autre nom et le site ne la trouvera pas :
   reconnecte avec `BLOB`.
2. **Accès privé** : dans les réglages du Blob Store, l'accès doit être **Private**. Si ton
   store est public, l'envoi affichera « réglage d'accès du Blob Store différent ». Le plus
   sûr est alors de créer un nouveau store **Private** et de le connecter à la place, pour
   que les photos ne soient jamais accessibles par une URL publique.
3. **Ajouter les codes** : dans **Settings → Environment Variables**, ajoute pour
   Production (et Preview) :
   - `ALBUM_CODE` : le code pour elle, par exemple une phrase qui vous ressemble ;
   - `ADMIN_CODE` : ton code à toi, différent du premier ;
   - `SESSION_SECRET` : une longue suite de caractères au hasard (64 environ),
     **obligatoire** si Vercel a fourni `BLOB_STORE_ID` plutôt qu'un jeton.

   Coche **Sensitive** pour ces trois variables. Majuscules, accents et espaces en trop
   sont tolérés à la saisie des codes.
4. **Redéployer** : **Deployments** → dernier déploiement de la branche de production →
   **⋯ → Redeploy**. Les variables ne s'appliquent qu'aux nouveaux déploiements.
5. **Vérifier** : ouvre `https://<ton-site>.vercel.app/api/session`. Tu dois voir
   `"configured":true`, `"storage":"vercel-blob"` et `"uploadMode":"client-token"` ou
   `"presigned"`. Si `missing` n'est pas vide, la liste indique ce qu'il manque.
6. **Tester** : sur l'iPhone, entre ton `ADMIN_CODE`, vérifie que le bandeau est vert, puis
   touche « 🔎 Tester la sauvegarde en ligne ». Toutes les étapes doivent afficher ✓.

### Envoyer les souvenirs depuis l'iPhone

1. Ouvre le site dans **Safari** et entre ton **ADMIN_CODE**.
2. Touche **« Ajouter nos souvenirs »**, puis sélectionne tes photos et vidéos dans la
   photothèque.
3. L'envoi démarre tout seul. La barre de progression affiche le pourcentage, le nombre de
   fichiers, les octets envoyés et les fichiers en cours.
4. **Garde Safari ouvert et l'écran allumé** pendant l'envoi. Les gros fichiers partent en
   plusieurs morceaux, qui sont relancés automatiquement en cas de coupure.
5. Si des envois échouent, la liste des échecs s'affiche avec leur cause. Touche
   **« Envoyer en ligne »** pour réessayer.
6. Tu peux renvoyer la même sélection sans risque : les fichiers déjà en ligne sont reconnus
   (empreinte du contenu) et ignorés.
7. Les photos que tu avais choisies avant cette mise à jour ne sont pas restées dans le
   site, sauf si tu avais activé « Garder ces souvenirs sur cet appareil » : dans ce cas,
   un bouton **« Envoyer en ligne (N) »** les propose directement. Sinon, sélectionne-les
   de nouveau dans ta photothèque, elles y sont toujours.
8. Conseil : procède par lots d'environ 50 fichiers, en Wi-Fi.

Pour retirer un souvenir : **« Gérer les souvenirs en ligne »** → **Supprimer**.

### Le lien pour elle

Envoie-lui `https://<ton-site>.vercel.app/#code=<ALBUM_CODE>`, en remplaçant les espaces
par `%20`. Elle arrive directement sur « Tu veux voir le bonheur ? ».

- Le code n'est jamais envoyé au serveur dans l'adresse, et il est effacé de la barre
  d'adresse à l'ouverture.
- Son appareil reste connecté pendant 6 mois.
- Elle peut aussi ouvrir le site sans le code dans le lien et le taper.
- ⚠️ Ce lien est une clé : toute personne qui l'a peut voir l'album.

### Tester sur l'ordinateur sans Vercel

```bash
STOCKAGE_LOCAL=./stockage-test ALBUM_CODE="notre code" ADMIN_CODE="mon code" SESSION_SECRET=test npm start
```

Les fichiers sont alors rangés dans `stockage-test/` (ignoré par Git), avec exactement le
même fonctionnement : codes, liens signés, progression.

Pour utiliser le vrai stockage depuis ton PC : `npm install`, puis
`npx vercel env pull .env.local`, puis `npm start`.

Sans stockage configuré, le site fonctionne **exactement comme avant** : import local,
« Garder sur cet appareil », version hébergée.

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
js/cloud.js           album en ligne : code, liste, envoi avec progression
js/vendor/blob-client.js  client d'envoi @vercel/blob (généré : npm run vendor:blob)
api/*.js              fonctions Vercel (session, connexion, souvenirs, envoi)
server/               logique serveur : codes et sessions, stockage (Vercel Blob ou Supabase), confirmation
supabase/schema.sql   bucket privé + table « souvenirs » (option Supabase)
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
