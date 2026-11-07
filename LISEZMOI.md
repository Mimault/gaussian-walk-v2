# Gaussian Walk V2 : lancer sur le Mac

Copie autonome de l'app, avec ses mondes Marble dans le dossier `mondes`.

## Première fois

1. Copier tout le dossier sur le Mac (par exemple dans le dossier utilisateur), pas seulement le raccourci du Drive.
2. Vérifier que Node.js est installé : dans le Terminal, `node -v` doit afficher un numéro de version. Sinon, l'installer depuis https://nodejs.org (version LTS).
3. Dans le Terminal, entrer dans le dossier : `cd ` (avec une espace), glisser le dossier dans la fenêtre du Terminal, puis Entrée.
4. Installer les briques de l'app : `npm install` (une seule fois, quelques dizaines de secondes).

## Avec GitHub (code) et le Drive (mondes)

Le code est sur GitHub, dépôt privé https://github.com/Mimault/gaussian-walk-v2. Les mondes (`.spz`) sont trop lourds pour GitHub : ils restent sur le Drive, dans `Nicolas\APPS\gaussian-walk_V2\mondes`.

1. Récupérer le code une première fois avec GitHub Desktop (File, Clone repository, `Mimault/gaussian-walk-v2`).
2. Copier le dossier `mondes` du Drive dans le dossier du dépôt (à côté de `package.json`). Git l'ignore.
3. `npm install` une fois, puis `npm run dev` comme ci-dessous.
4. Pour une nouvelle version : dans GitHub Desktop, « Fetch origin » puis « Pull origin ». Recopier `mondes` seulement s'il y a de nouveaux mondes.

## À chaque fois

1. Dans le Terminal, dans le dossier de l'app : `npm run dev`
2. Ouvrir dans Chrome l'adresse affichée, en général http://localhost:5173
   - `http://localhost:5173/?densite=500k` charge les mondes allégés (plus fluide).
3. Accepter l'accès à la caméra quand Chrome le demande (webcam dans le cadre ; rien n'est enregistré).
4. Pour arrêter : Ctrl + C dans le Terminal.

## Commandes utiles

- **L** : lancer ou arrêter la séquence automatique. Toucher le clavier, la souris ou la manette l'arrête.
- **← / →** : monde précédent ou suivant.
- **E** : forces (en dehors de la séquence).
- Panneau à droite : tous les réglages ; « Réglages », puis « Réinitialiser » pour revenir aux valeurs par défaut.

## Si quelque chose coince

- « Could not read package.json » : le Terminal n'est pas dans le dossier de l'app.
- Page blanche : le serveur ne tourne pas ; relancer `npm run dev`.
- « Webcam indisponible » : autoriser la caméra pour Chrome dans Réglages Système, Confidentialité et sécurité, Caméra.
