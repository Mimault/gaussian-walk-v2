// Configuration du serveur de développement Vite.
// Ajoute trois petites routes pour les photos :
//   POST /api/capture          → enregistre une photo dans le dossier « captures » du projet
//   GET  /api/captures-list    → liste les photos, de la plus récente à la plus ancienne
//   GET  /api/captures-file/…  → renvoie une photo, pour l'afficher dans la galerie
// et une route pour les scènes :
//   GET  /api/scenes-list      → liste les splats du dossier public/scenes, par ordre alphabétique
// V2 : deux routes pour les mondes Marble et les splats Postshot, lus directement dans 01_PROJETS :
//   GET  /api/mondes-list            → les mondes, par ordre chronologique (voir listeMondes)
//   GET  /api/mondes-file/<nom.spz>  → renvoie un fichier .spz de cette liste

import { defineConfig } from "vite";
import fs from "node:fs";
import path from "node:path";

const CAPTURES_DIR = path.resolve(process.cwd(), "captures");
const SCENES_DIR = path.resolve(process.cwd(), "public", "scenes");

// Envoie un fichier au navigateur. Sans ce garde-fou, une erreur de lecture (fichier du Drive indisponible,
// par exemple) arrêterait tout le serveur.
function envoyerFichier(chemin, res) {
  const flux = fs.createReadStream(chemin);
  flux.on("error", (e) => {
    console.error("Lecture impossible :", chemin, e.message);
    if (res.headersSent) {
      res.destroy();
    } else {
      res.statusCode = 500;
      res.end();
    }
  });
  res.on("close", () => flux.destroy());
  flux.pipe(res);
}

// ---------- Mondes Marble (V2) ----------
// Dossiers lus : <corpus>\PROD\<année>_<photo>\03_marble\Vn\ (photos libres seulement ;
// « PROD (licence) » n'existe plus depuis le 8 novembre 2026 : 1945 est séparée entre PROD et NON_COMMERCIAL).
// Copie autonome (export pour le Mac, voir exporter.py) : les mondes sont dans le dossier « mondes » de l'app,
// avec la même organisation ; sinon, ceux de 01_PROJETS (PC de recherche).
// Sur le Mac, Lancer.command indique par GW_MONDES le dossier « mondes » du Drive, qui passe alors en premier.
const MONDES_LOCAL = process.env.GW_MONDES || path.resolve(process.cwd(), "mondes");
const PROJETS_DIR = fs.existsSync(MONDES_LOCAL)
  ? MONDES_LOCAL
  : path.resolve(process.cwd(), "..", "..", "..", "01_PROJETS");
const CORPUS_MONDES = ["raadi_manor", "raadi_porte"];
const DENSITES = ["full_res", "500k"]; // fichiers ERM_…_V<n>_full_res.spz et ERM_…_V<n>_500k.spz

// Clé de tri chronologique d'un dossier de photo, ex. « B1923_Fk449_217 », « 1914_Fk359_440-12 » :
// année, puis « B » (= avant cette année) en premier, puis les numéros de la photo, comparés comme des nombres.
function cleChrono(nom) {
  const m = nom.match(/^(B?)(\d{4})(?:-\d{4})?_(.*)$/); // « 1925-1930 » est classée à sa première année
  if (!m) return [9999, 1, []];
  const numeros = (m[3].match(/\d+/g) || []).map(Number);
  return [Number(m[2]), m[1] ? 0 : 1, numeros];
}

function compareChrono(a, b) {
  const ka = cleChrono(a), kb = cleChrono(b);
  if (ka[0] !== kb[0]) return ka[0] - kb[0];
  if (ka[1] !== kb[1]) return ka[1] - kb[1];
  for (let i = 0; i < Math.max(ka[2].length, kb[2].length); i++) {
    const d = (ka[2][i] ?? -1) - (kb[2][i] ?? -1);
    if (d !== 0) return d;
  }
  return a.localeCompare(b);
}

// Pour chaque photo : la version Vn la plus haute qui contient au moins un .spz.
// Une génération en cours (fiche .json sans .spz) est donc ignorée.
// Splats Postshot des photos non commerciales : <corpus>\NON_COMMERCIAL\<photo>\04_splat\ (ou Vn), avec un
// _cadrage.json (03_OUTILS\prod\cadrage.py) et des copies .spz lisibles par Spark (03_OUTILS\prod\ply_vers_spz.py).
function splatsLocaux(corpus) {
  const racine = path.join(PROJETS_DIR, corpus, "NON_COMMERCIAL");
  const mondes = [];
  let photos = [];
  try {
    photos = fs.readdirSync(racine, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return mondes;
  }
  for (const photo of photos) {
    const base = path.join(racine, photo, "04_splat");
    if (!fs.existsSync(base)) continue;
    const versions = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory() && /^V\d+$/.test(d.name)).map((d) => d.name)
      .sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)));
    for (const version of [...versions, ""]) { // la Vn la plus haute, sinon le dossier 04_splat lui-même
      const dossier = version ? path.join(base, version) : base;
      const fichiers = fs.readdirSync(dossier);
      const fc = fichiers.find((n) => n.endsWith("_cadrage.json"));
      const parDensite = {};
      for (const densite of DENSITES) {
        const f = fichiers.find((n) => n.toLowerCase().endsWith(`_${densite}.spz`));
        if (f) parDensite[densite] = { nom: f, chemin: path.join(dossier, f) };
      }
      if (!fc || Object.keys(parDensite).length === 0) continue;
      let fiche = null;
      try {
        fiche = JSON.parse(fs.readFileSync(path.join(racine, photo, "fiche_muis.json"), "utf-8"));
      } catch {
        fiche = null;
      }
      const cadrage = JSON.parse(fs.readFileSync(path.join(dossier, fc), "utf-8"));
      mondes.push({ photo, corpus, version: version || "V1", fichiers: parDensite, cadrage, fiche, dossier });
      break;
    }
  }
  return mondes;
}

function listeMondes() {
  const mondes = [];
  for (const corpus of CORPUS_MONDES) {
    mondes.push(...splatsLocaux(corpus));
    const prod = path.join(PROJETS_DIR, corpus, "PROD");
    let photos = [];
    try {
      photos = fs.readdirSync(prod, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      continue;
    }
    for (const photo of photos) {
      const marble = path.join(prod, photo, "03_marble");
      let versions = [];
      try {
        versions = fs
          .readdirSync(marble)
          .filter((v) => /^V\d+$/.test(v))
          .sort((a, b) => Number(b.slice(1)) - Number(a.slice(1))); // la plus haute d'abord
      } catch {
        continue;
      }
      for (const version of versions) {
        const dossier = path.join(marble, version);
        const fichiers = fs.readdirSync(dossier);
        const parDensite = {};
        for (const densite of DENSITES) {
          const f = fichiers.find((n) => n.toLowerCase().endsWith(`_${densite}.spz`));
          if (f) parDensite[densite] = { nom: f, chemin: path.join(dossier, f) };
        }
        if (Object.keys(parDensite).length > 0) {
          // Point de vue de la photo d'origine (écrit par 03_OUTILS\prod\cadrage.py), s'il existe
          let cadrage = null;
          const fc = fichiers.find((n) => n.endsWith("_cadrage.json"));
          if (fc) {
            try {
              cadrage = JSON.parse(fs.readFileSync(path.join(dossier, fc), "utf-8"));
            } catch {
              cadrage = null;
            }
          }
          // Petite fiche MuIS pour le HUD (écrite par 03_OUTILS\prod\fiche_muis.py), si elle existe
          let fiche = null;
          try {
            fiche = JSON.parse(fs.readFileSync(path.join(prod, photo, "fiche_muis.json"), "utf-8"));
          } catch {
            fiche = null;
          }
          mondes.push({ photo, corpus, version, fichiers: parDensite, cadrage, fiche, dossier });
          break;
        }
      }
    }
  }
  return mondes.sort((a, b) => compareChrono(a.photo, b.photo));
}

function capturesPlugin() {
  return {
    name: "gaussian-walk-captures",
    configureServer(server) {
      server.middlewares.use("/api/capture", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }

        // Nom de fichier : on ne garde que des caractères sûrs, et jamais de chemin
        const requested = String(req.headers["x-filename"] || "");
        const safe = path.basename(requested).replace(/[^a-zA-Z0-9._-]/g, "_");
        const filename = /\.(png|jpe?g)$/i.test(safe) ? safe : `capture-${Date.now()}.png`;

        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => {
          try {
            fs.mkdirSync(CAPTURES_DIR, { recursive: true });
            fs.writeFileSync(path.join(CAPTURES_DIR, filename), Buffer.concat(chunks));
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true, path: `captures/${filename}` }));
          } catch (e) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: String(e) }));
          }
        });
      });

      // Liste des photos pour la galerie
      server.middlewares.use("/api/captures-list", (req, res) => {
        let files = [];
        try {
          files = fs
            .readdirSync(CAPTURES_DIR)
            .filter((name) => /\.(png|jpe?g)$/i.test(name))
            .map((name) => {
              const stat = fs.statSync(path.join(CAPTURES_DIR, name));
              return { name, time: stat.mtimeMs, size: stat.size };
            })
            .sort((a, b) => b.time - a.time);
        } catch {
          files = []; // pas encore de dossier « captures » : galerie vide
        }
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(files));
      });

      // Liste des scènes : les fichiers splat de public/scenes (servis par Vite à l'adresse /scenes/…)
      server.middlewares.use("/api/scenes-list", (req, res) => {
        let files = [];
        try {
          files = fs
            .readdirSync(SCENES_DIR)
            .filter((name) => /\.(ply|spz|splat|ksplat)$/i.test(name))
            .sort((a, b) => a.localeCompare(b, "fr", { numeric: true }));
        } catch {
          files = []; // pas de dossier public/scenes
        }
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(files));
      });

      // V2 : liste des mondes Marble (sans les chemins complets, inutiles à la page)
      server.middlewares.use("/api/mondes-list", (req, res) => {
        const mondes = listeMondes().map((m) => ({
          photo: m.photo,
          corpus: m.corpus,
          version: m.version,
          cadrage: m.cadrage,
          fiche: m.fiche,
          fichiers: Object.fromEntries(Object.entries(m.fichiers).map(([d, f]) => [d, f.nom])),
        }));
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(mondes));
      });

      // V2 : la photo d'origine d'un monde (image projetée par SplatKit, chemin noté dans son _cadrage.json),
      // cherchée par le nom du dossier de la photo (jamais un chemin libre)
      server.middlewares.use("/api/mondes-photo", (req, res) => {
        const nom = path.basename(decodeURIComponent((req.url || "").split("?")[0].replace(/^\//, "")));
        const monde = listeMondes().find((m) => m.photo === nom);
        let chemin = monde?.cadrage?.photo;
        // Copie autonome : la photo est rangée à côté du monde (le chemin noté est celui du PC)
        if (chemin && !fs.existsSync(chemin)) chemin = path.join(monde.dossier, chemin.split(/[\\/]/).pop());
        if (!chemin || !fs.existsSync(chemin)) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader("Content-Type", /\.png$/i.test(chemin) ? "image/png" : "image/jpeg");
        envoyerFichier(chemin, res);
      });

      // V2 : un fichier .spz, cherché par son nom dans la liste des mondes (jamais un chemin libre)
      server.middlewares.use("/api/mondes-file", (req, res) => {
        const nom = path.basename(decodeURIComponent((req.url || "").split("?")[0].replace(/^\//, "")));
        let chemin = null;
        for (const m of listeMondes()) {
          for (const f of Object.values(m.fichiers)) if (f.nom === nom) chemin = f.chemin;
        }
        if (!chemin) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Content-Length", fs.statSync(chemin).size);
        envoyerFichier(chemin, res);
      });

      // Une photo, pour l'afficher
      server.middlewares.use("/api/captures-file", (req, res) => {
        const requested = decodeURIComponent((req.url || "").split("?")[0].replace(/^\//, ""));
        const name = path.basename(requested); // jamais de chemin : uniquement un fichier de « captures »
        const file = path.join(CAPTURES_DIR, name);
        if (!/\.(png|jpe?g)$/i.test(name) || !fs.existsSync(file)) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader("Content-Type", /\.png$/i.test(name) ? "image/png" : "image/jpeg");
        envoyerFichier(file, res);
      });
    },
  };
}

// Vite ajoute à la page un petit programme relié au serveur. Quand ce lien se coupait (« server connection lost »),
// il rechargeait toute la page : écran blanc en pleine séquence. On le retire ; après une modification du code,
// il faut donc recharger la page à la main.
function sansRechargement() {
  return {
    name: "sans-rechargement",
    apply: "serve",
    transformIndexHtml: {
      order: "post",
      handler: (html) => html.replace(/\s*<script[^>]*\/@vite\/client[^>]*><\/script>/, ""),
    },
  };
}

export default defineConfig({
  plugins: [capturesPlugin(), sansRechargement()],
  server: {
    // Ne pas recharger la page quand une nouvelle photo arrive dans le dossier
    watch: { ignored: ["**/captures/**", "**/mondes/**"] },
    ws: false, // voir sansRechargement
  },
});