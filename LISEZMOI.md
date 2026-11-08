# Gaussian Walk V2 : lancer sur le Mac

Copie autonome de l'app, avec ses mondes (Marble et splats Postshot) dans le dossier `mondes`.

## Première fois

1. Copier tout le dossier sur le Mac (par exemple dans le dossier utilisateur), pas seulement le raccourci du Drive.
2. Vérifier que Node.js est installé : dans le Terminal, `node -v` doit afficher un numéro de version. Sinon, l'installer depuis https://nodejs.org (version LTS).
3. Dans le Terminal, entrer dans le dossier : `cd ` (avec une espace), glisser le dossier dans la fenêtre du Terminal, puis Entrée.
4. Installer les briques de l'app : `npm install` (une seule fois, quelques dizaines de secondes).

## Avec GitHub (code) et le Drive (mondes)

Le code est sur GitHub, dépôt privé https://github.com/Mimault/gaussian-walk-v2. Les mondes (`.spz`) sont trop lourds pour GitHub : ils restent sur le Drive, dans `Nicolas\APPS\gaussian-walk_V2\mondes`.

1. Récupérer le code une première fois avec GitHub Desktop (File, Clone repository, `Mimault/gaussian-walk-v2`).
2. Sur le Mac, installer Google Drive pour ordinateur, ouvrir `Nicolas/APPS/gaussian-walk_V2` dans le Finder et rendre le dossier `mondes` disponible hors connexion (clic droit). L'app lit ce dossier directement et les nouveaux mondes se téléchargent seuls. Sans le Drive, elle lit un dossier `mondes` copié à côté de `package.json`.
3. Double-cliquer sur `Lancer.command` : il installe les briques de l'app la première fois, puis lance tout.
4. Pour une nouvelle version : dans GitHub Desktop, « Fetch origin » puis « Pull origin ».

## À chaque fois

1. Double-cliquer sur `Lancer.command` (Mac) ou `Lancer.bat` (PC). Le navigateur s'ouvre en pleine définition (`full_res`).
2. L'adresse est en général http://localhost:5173
   - `http://localhost:5173/?densite=500k` charge les mondes allégés (plus fluide).
3. Pour arrêter : Ctrl + C dans la fenêtre du lanceur, ou la fermer.

## Définition maximale

1. Ouvrir http://localhost:5173 **sans** `?densite=500k` : tous les splats sont chargés (Marble 1,92 M, Postshot jusqu'à 3 M). Le message en bas indique `(full_res)`.
2. Dans le panneau à droite, dossier « Performance » :
   - « Résolution de rendu » à **2** (Retina complet ; la valeur par défaut est 0,5). Si ça saccade, descendre à 1.
   - « Étendue des splats » à **2,83** (valeur d'origine de Spark ; 2 par défaut ici pour aller plus vite).
   - « Tailles précises » : oui par défaut, pour que les splats grandissent sans à-coups. Si l'app manque de mémoire, cliquer pour passer à non.
3. Ces réglages restent enregistrés dans le navigateur. « Réglages », puis « Réinitialiser » les annule.

## Commandes utiles

- **L** : lancer ou arrêter la séquence automatique. Toucher le clavier, la souris ou la manette l'arrête.
- **← / →** : monde précédent ou suivant.
- **E** : forces (en dehors de la séquence).
- Panneau à droite : tous les réglages ; « Réglages », puis « Réinitialiser » pour revenir aux valeurs par défaut.

## Si quelque chose coince

- « Could not read package.json » : le Terminal n'est pas dans le dossier de l'app.
- Page blanche : le serveur ne tourne pas ; relancer `npm run dev`.
- « Carte graphique perdue » : la mémoire de la carte graphique est saturée ; recharger la page, baisser la résolution de rendu ou ouvrir `?densite=500k`.
