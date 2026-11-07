"""exporter.py : copie autonome de Gaussian Walk V2, avec ses mondes, pour un autre ordinateur (le Mac).

Copie l'app (sans node_modules ni captures) et, dans <destination>\\mondes, les mondes Marble que la V2
affiche : pour chaque photo des PROD de raadi_manor et raadi_porte, la version Vn la plus haute qui a un .spz,
avec ses .spz full_res et 500k, son _cadrage.json, la photo du cadre, et la fiche_muis.json de la photo.
La V2 (vite.config.js) lit le dossier « mondes » s'il existe à côté d'elle.

Usage : py -3.12 exporter.py <destination>
Ne supprime rien ; un fichier déjà présent avec la même taille n'est pas recopié.
"""
import json
import shutil
import sys
from pathlib import Path

APP = Path(__file__).resolve().parent
ENM = APP.parents[2]
CORPUS = ["raadi_manor", "raadi_porte"]
APP_FICHIERS = ["index.html", "package.json", "package-lock.json", "vite.config.js", "LISEZMOI.md"]
APP_DOSSIERS = ["src", "reglages"]
PUBLIC_EXCLUS = {"scene.ply"}  # scène de repli de la V1 (64 Mo), inutile ici


def copier(src, dst, bilan):
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists() and dst.stat().st_size == src.stat().st_size:
        return
    shutil.copy2(src, dst)
    bilan["fichiers"] += 1
    bilan["octets"] += src.stat().st_size


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)
    dest = Path(sys.argv[1])
    bilan = {"fichiers": 0, "octets": 0}

    # L'app
    for nom in APP_FICHIERS:
        if (APP / nom).exists():
            copier(APP / nom, dest / nom, bilan)
    for d in APP_DOSSIERS:
        for f in (APP / d).rglob("*"):
            if f.is_file():
                copier(f, dest / f.relative_to(APP), bilan)
    for f in (APP / "public").rglob("*"):
        if f.is_file() and f.name not in PUBLIC_EXCLUS:
            copier(f, dest / f.relative_to(APP), bilan)

    # Les mondes
    for corpus in CORPUS:
        prod = ENM / "01_PROJETS" / corpus / "PROD"
        for photo in sorted(p for p in prod.iterdir() if p.is_dir()):
            marble = photo / "03_marble"
            if not marble.exists():
                continue
            versions = sorted((v for v in marble.iterdir() if v.is_dir() and v.name[1:].isdigit()),
                              key=lambda v: int(v.name[1:]), reverse=True)
            version = next((v for v in versions if list(v.glob("*.spz"))), None)
            if not version:
                continue
            cible = dest / "mondes" / corpus / "PROD" / photo.name
            if (photo / "fiche_muis.json").exists():
                copier(photo / "fiche_muis.json", cible / "fiche_muis.json", bilan)
            for f in version.iterdir():
                if f.name.endswith(("_full_res.spz", "_500k.spz", "_cadrage.json")):
                    copier(f, cible / "03_marble" / version.name / f.name, bilan)
                if f.name.endswith("_cadrage.json"):
                    chemin = json.loads(f.read_text(encoding="utf-8")).get("photo")
                    if chemin and Path(chemin).exists():
                        copier(Path(chemin), cible / "03_marble" / version.name / Path(chemin).name, bilan)
            print(f"{corpus:12} {photo.name:22} {version.name}")

    total = sum(f.stat().st_size for f in dest.rglob("*") if f.is_file())
    nb = sum(1 for f in dest.rglob("*") if f.is_file())
    print(f"\nCopiés cette fois : {bilan['fichiers']} fichiers, {bilan['octets'] / 1e6:.1f} Mo")
    print(f"Dans la destination : {nb} fichiers, {total / 1e6:.1f} Mo")


if __name__ == "__main__":
    main()
