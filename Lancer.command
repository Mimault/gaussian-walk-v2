#!/bin/bash
# Gaussian Walk V2 sur le Mac : double-clic pour lancer l'app en pleine définition dans Chrome.
# Les mondes sont lus directement dans le dossier « mondes » du Drive (Google Drive pour ordinateur) ;
# à défaut, dans un dossier « mondes » copié à côté de ce fichier.

cd "$(dirname "$0")" || exit 1
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"

fin() {
  echo
  read -r -p "Appuie sur Entrée pour fermer cette fenêtre." _
  exit "$1"
}

if ! command -v npm >/dev/null 2>&1; then
  echo "Node.js n'est pas installé. Installe la version LTS depuis https://nodejs.org puis relance."
  fin 1
fi

# Cherche le dossier « mondes » sur le Drive
for d in "$HOME"/Library/CloudStorage/GoogleDrive-*/.shortcut-targets-by-id/*/Nicolas/APPS/gaussian-walk_V2/mondes \
         "$HOME"/Library/CloudStorage/GoogleDrive-*/*/Nicolas/APPS/gaussian-walk_V2/mondes; do
  if [ -d "$d/raadi_manor" ]; then
    export GW_MONDES="$d"
    break
  fi
done

if [ -n "$GW_MONDES" ]; then
  echo "Mondes lus sur le Drive : $GW_MONDES"
elif [ -d mondes ]; then
  echo "Drive introuvable : mondes lus dans le dossier de l'app."
else
  echo "Dossier des mondes introuvable."
  echo "Vérifie que Google Drive pour ordinateur est ouvert et que le dossier Nicolas y apparaît."
  fin 1
fi

# Installe les briques de l'app la première fois, ou si elles ont changé
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  echo "Installation des briques de l'app..."
  npm install || fin 1
  touch node_modules/.package-lock.json
fi

echo
echo "Pour arrêter : Ctrl + C dans cette fenêtre."
echo
export BROWSER="${BROWSER:-Google Chrome}"
npm run dev -- --open
fin 0
