// Gaussian Walk — étape 5 ter
// Splat + clavier/souris/gamepad (vol libre) + forces inspirées de Niagara
// + répulsion : les splats proches glissent vers les bords de l'écran
// + curl noise dans une couronne autour de la zone de répulsion (vortex retiré pour l'instant)
// + déclenchement au bouton
// + objectif : focale, mise au point et flou de profondeur.

import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { SparkRenderer, SplatMesh, dyno } from "@sparkjsdev/spark";
import GUI from "lil-gui";
import Stats from "three/addons/libs/stats.module.js";
import { Line2 } from "three/addons/lines/Line2.js";               // V2 : lignes épaisses (cadre)
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";

// ---------- Page : plein écran, sans marges ----------
document.body.style.margin = "0";
document.body.style.overflow = "hidden";
document.body.style.background = "#000";

// ---------- Moteur de rendu, scène, caméra ----------
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 1000);
camera.position.set(0, 0, 0); // V2 : départ au point de vue du panorama Marble

// Spark garde la taille des splats sur 256 valeurs entre deux images : un changement de taille se voit
// alors par paliers de 8,6 %. L'encodage étendu les rend continus, au prix de plus de mémoire.
const CLE_TAILLES_PRECISES = "gaussian-walk-v2.taillesPrecises";
let taillesPrecises = true;
try {
  taillesPrecises = localStorage.getItem(CLE_TAILLES_PRECISES) !== "0";
} catch (e) {}
const spark = new SparkRenderer({ renderer, accumExtSplats: taillesPrecises });
scene.add(spark);

// ---------- Compteur d'images par seconde ----------
const stats = new Stats();
document.body.appendChild(stats.dom);

// ---------- HUD : croix centrale et 4 angles, en SVG par-dessus la 3D ----------
// C'est une couche HTML posée sur le canvas : le navigateur la dessine, pas la carte graphique.
function createHUD({ crossSize = 24, cornerSize = 32, margin = 24, strokeWidth = 1.5 } = {}) {
  const hud = document.createElement("div");
  // pointer-events: none → les clics traversent le HUD et atteignent la 3D et le panneau
  hud.style.cssText = "position:fixed; inset:0; pointer-events:none; z-index:5;";

  const line = `fill="none" stroke="white" stroke-width="${strokeWidth}" stroke-linecap="square"`;

  // Croix centrale : un petit SVG centré au milieu de l'écran
  const c = crossSize;
  let html = `
    <svg width="${c}" height="${c}" viewBox="0 0 ${c} ${c}"
         style="position:absolute; left:50%; top:50%; transform:translate(-50%, -50%); overflow:visible">
      <path d="M${c / 2} 0 V${c} M0 ${c / 2} H${c}" ${line} />
    </svg>`;

  // Les 4 angles : chacun est un « L » placé dans son coin, tourné vers l'intérieur
  const s = cornerSize;
  const corners = [
    { pos: `left:${margin}px; top:${margin}px`,     d: `M0 ${s} V0 H${s}` },     // haut gauche
    { pos: `right:${margin}px; top:${margin}px`,    d: `M0 0 H${s} V${s}` },     // haut droite
    { pos: `left:${margin}px; bottom:${margin}px`,  d: `M0 0 V${s} H${s}` },     // bas gauche
    { pos: `right:${margin}px; bottom:${margin}px`, d: `M0 ${s} H${s} V0` },     // bas droite
  ];
  for (const corner of corners) {
    html += `
    <svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}"
         style="position:absolute; ${corner.pos}; overflow:visible">
      <path d="${corner.d}" ${line} />
    </svg>`;
  }

  hud.innerHTML = html;
  document.body.appendChild(hud);
  return hud;
}

const hud = createHUD();

// ---------- Réglages (modifiables en direct dans le panneau) ----------
const params = {
  // Déclenchement
  active: true,
  modeEffet: "Appui = bascule", // V2 : actives à l'arrivée, E pour couper ou remettre
  fondu: 0.3,          // secondes pour que l'effet monte ou retombe

  // Répulsion : les splats proches glissent vers les bords de l'écran, la caméra passe au milieu
  repForce: 1.0,       // 0 = aucune ; 1 = écart maximal (égal au rayon tout près de la caméra)
  repRayon: 1.5,       // taille de la zone : Rayon sur les côtés et derrière, Rayon × Rayon devant
  repBordBruite: 0.3,  // 0 = bord lisse ; 0.3 = le rayon varie de ±30 % selon le bruit
  repSuivreCurl: true, // le bord utilise la fréquence, les octaves et le défilement du curl noise
  repBruitFrequence: 1.5, // réglages propres du bord (quand il ne suit pas le curl noise)
  repBruitOctaves: 1,
  repBruitVitesse: 0.2,   // vitesse d'ondulation du bord
  repBruitDedans: 0.0,    // part du curl noise qui agit aussi dans la zone de répulsion (0 à 1)

  // Curl noise : autour de la zone de répulsion (mêmes réglages qu'avant)
  bruitEpaisseur: 1.5, // épaisseur de la couronne de bruit, au-delà de la zone de répulsion
  douceur: 0.6,        // 0 = bord extérieur net, 1 = effet estompé jusqu'au bord
  curlForce: 0.06,      // amplitude du déplacement
  curlFrequence: 1.5,  // taille des tourbillons (grand = fins)
  curlOctaves: 2,      // couches de détail superposées (1 = lisse, 4 = très détaillé)
  panX: 0.0,           // défilement du champ de bruit dans le temps
  panY: -0.14,
  panZ: 0.0,
  graine: 0,           // change le motif sans changer son caractère
  sillageDuree: 3.0,       // secondes avant que le sillage du bruit se referme (0 = pas de sillage)
  sillageEspacement: 0.25, // distance entre deux points de la traînée ; longueur max = 16 × espacement

  // Objectif
  focale: 24,        // en mm, comme un objectif photo (équivalent plein format)
  fov: 0,            // calculé automatiquement, affiché dans le panneau
  miseAuPoint: 30,    // distance nette, en mètres
  ouverture: 0,      // 0 = tout net (par défaut) ; plus c'est grand, plus le flou est fort (0.01 = réglage « Démo flou »)
  seuilProche: 1,    // en dessous de cette mise au point (m), l'ouverture descend progressivement à 0
  fonduOuverture: 0.5, // secondes pour que l'ouverture descende à 0 (ou remonte)
  ouvertureAppliquee: 0, // ouverture réellement utilisée, affichée dans le panneau
  autofocus: false,  // met au point automatiquement sur ce qui est au centre de l'image
  vitesseAF: 0.25,   // secondes pour que l'autofocus rejoigne sa cible
  // Bouton de démonstration : un réglage où le flou saute aux yeux
  demoFlou: () => {
    params.ouverture = 0.01; // bridée au minimum pour rester fluide
    params.autofocus = true;
  },
  toutNet: () => {
    params.ouverture = 0;
    params.autofocus = false;
  },

  // HUD
  hudVisible: true,
  hudOpacite: 0.3,

  // Scènes
  sceneNom: "",            // nom de la scène affichée (lecture seule)
  sceneResetCamera: true,  // revenir au point de départ à chaque changement de scène
  // V2 : point de vue de la photo d'origine (fichier _cadrage.json de chaque monde)
  cadreVisible: true,      // cadre fin au bord de la photo d'origine
  cadreOpacite: 0.6,
  cadreEpaisseur: 5,       // px
  envolCourbe: 1,          // disparition : 1 = les splats partent en l'air tout de suite ; 2 = départ lent (à l'origine)
  croissance: 1,           // part du mouvement de chaque splat pendant laquelle il grandit (apparition) ou rapetisse (disparition) ; à l'origine 0.15
  cadreMarge: 1.1,         // 1 = la photo touche les bords de l'écran ; 1.1 = 10 % de monde généré autour
  lacetCorrection: 0,      // degrés : à régler si le centre du panorama n'est pas « devant » dans Marble
  // V2 : séquence automatique (pose, avancée, élévation, monde suivant, en boucle)
  seqActive: true,
  seqPose: 2,              // s : immobile au point de vue de la photo
  seqAvanceDuree: 5,       // s : avancée en ligne droite (les forces montent, les splats reviennent à 100 %)
  seqAvanceDist: 1.5,        // m
  seqFocaleCible: 12,      // mm : focale prise au début du tour sur soi, commune à tous les mondes (si la photo est plus serrée)
  seqTourDuree: 25,        // s : tour sur elle-même vers la droite, en montant très doucement
  seqTourMontee: 1.5,        // m : hauteur gagnée pendant ce tour (il commence à monter)
  seqTourDist: 4,          // m : il continue d'avancer pendant ce tour (à l'horizontale)
  seqReculDuree: 15,       // s : prend de la distance avec le manoir, en montant toujours
  seqReculPct: 25,         // % : recul, en part de la distance (horizontale) au manoir
  seqMonteeHaut: 20,       // m : hauteur finale (recul, orbite)
  seqEnvolAnticipation: 0.1, // part du rapetissement restante quand l'envol (transition) démarre ; 0 = à la fin exacte
  seqRegardCadre: 0.5,     // pendant l'orbite, le regard glisse du manoir (0) vers le cadre 3D (1) ; 0,5 = entre les deux
  seqOrbiteAngle: 315,     // degrés : l'orbite autour du manoir n'est pas un tour complet
  seqPhoto: true,          // photo d'origine dans le cadre pendant la pose, effacée par un flash blanc
  seqPhotoAvance: 0.25,    // la photo apparaît pendant cette dernière part de la chute du monde (avant que les particules soient en place)
  cadreTraceDuree: 1.5,    // s : tracé du cadre pendant la chute du monde ; il se ferme à la fin de la chute
  seqFlashDuree: 0.8,      // s : retombée du flash blanc
  ficheVisible: true,      // fiche MuIS tapée en haut à gauche
  ficheVitesse: 45,        // caractères par seconde
  chapitreVisible: true,   // chapitre en haut à droite
  chapitreFondu: 1.5,      // s : apparition en fondu d'un nouveau chapitre
  chapitreVideDuree: 4,    // s : temps d'affichage, dans le noir, d'un chapitre sans image
  seqOrbiteDuree: 21.5,    // s : durée de l'orbite autour du manoir
  seqPauseFin: 0,          // s : après l'orbite, avant le rapetissement (place prévue pour une autre phase)
  horsCadreTaille: 0.25,   // taille des splats hors du cadre de la photo pendant la pose (1 = normale)
  fpsMax: 30,              // V2 : images par seconde au maximum (0 = sans limite) ; 30 pour soulager la machine
  cadreDistance: 1,        // m : distance du cadre 3D devant le point de vue (la caméra le traverse en avançant)
  seqCibleMin: 8,          // m : distance minimale de la cible (le manoir), mesurée au centre de la photo
  transitionDuree: 2.0,    // durée de chaque phase : disparition, puis apparition (0 = changement sec)
  transitionEtalement: 0.6, // 0 = toutes les gaussiennes ensemble ; 1 = très étalé, grain par grain
  chuteHauteur: 4,         // hauteur de l'envol (disparition) et de la chute (apparition)
  paquets: 0.7,            // 0 = grain par grain au hasard ; 1 = par paquets de gaussiennes voisines
  paquetTaille: 1.5,       // taille des paquets
  ordreHauteur: 0.7,       // ordre par distance : 0 = aléatoire ; 1 = strictement des plus proches aux plus lointaines
  cameraInclinaison: 34,   // degrés : la caméra lève les yeux à la disparition et les redescend à l'apparition (0 = immobile)
  cameraRetard: 0.5,       // secondes d'attente, au début de la disparition, avant que la caméra suive les particules

  // Photo
  photoResolution: 2,   // résolution des photos, indépendante de la résolution de rendu (2 = Retina complet)
  photoFormat: "PNG",   // PNG = sans perte, fichiers lourds ; JPEG = plus léger
  flashLumiere: true,   // au déclenchement, un écran blanc bref (il n'est pas sur la photo)
  flashDuree: 0.5,      // secondes pour que le flash s'éteigne
  apercu: true,         // affiche la photo en vignette en bas à gauche
  apercuDuree: 3,       // secondes d'affichage de la vignette
  apercuTaille: 240,    // largeur de la vignette, en pixels

  // Performance
  resolution: 0.5,           // 1 = un pixel de rendu par point d'écran ; 2 = Retina complet (4× plus de pixels)
  etendue: 2,                // étendue dessinée de chaque gaussienne (défaut Spark : 2.83) ; plus petit = plus rapide, un peu plus « dur »
};

// Opacité de départ du HUD
hud.style.opacity = params.hudOpacite;

// Résolution de rendu de départ (sur Mac Retina, 1 au lieu de 2 divise le travail par 4)
renderer.setPixelRatio(params.resolution);
renderer.setSize(window.innerWidth, window.innerHeight);

// Étendue des splats de départ
spark.maxStdDev = params.etendue;

// ---------- Traînée : les dernières positions de la zone d'influence ----------
const TRAIL_N = 16; // nombre de points mémorisés
const uTrail = Array.from({ length: TRAIL_N }, () => dyno.dynoVec4(new THREE.Vector4(0, 0, 0, 0)));
const trailPoints = [];          // du plus récent au plus ancien : { pos, time }
const effectCenter = new THREE.Vector3().copy(camera.position); // position de la caméra, pour le sillage

// « Uniforms » : valeurs envoyées de JavaScript vers le GPU à chaque image
const u = {
  time:     dyno.dynoFloat(0),
  camPos:   dyno.dynoVec3(new THREE.Vector3()),         // position exacte de la caméra
  camFwd:   dyno.dynoVec3(new THREE.Vector3(0, 0, -1)), // direction du regard
  // Répulsion
  repForce: dyno.dynoFloat(0),
  repR:     dyno.dynoFloat(params.repRayon),
  repStretch: dyno.dynoFloat(params.repRayon),
  edgeNoise: dyno.dynoFloat(params.repBordBruite),
  edgeFreq:  dyno.dynoFloat(params.curlFrequence),
  edgeOct:   dyno.dynoInt(1),
  edgePan:   dyno.dynoVec3(new THREE.Vector3()),
  edgeSeed:  dyno.dynoFloat(0),
  noiseInside: dyno.dynoFloat(0),
  // Bruit
  radius:    dyno.dynoFloat(params.repRayon + params.bruitEpaisseur), // bord extérieur de la couronne
  softness:  dyno.dynoFloat(params.douceur),
  curlForce: dyno.dynoFloat(0),
  curlFreq:  dyno.dynoFloat(params.curlFrequence),
  octaves:   dyno.dynoInt(params.curlOctaves),
  pan:       dyno.dynoVec3(new THREE.Vector3()),
  seed:      dyno.dynoFloat(params.graine),
  // Transition entre scènes
  spread:    dyno.dynoFloat(params.transitionEtalement),
  fallHeight: dyno.dynoFloat(params.chuteHauteur),
  packs:     dyno.dynoFloat(params.paquets),
  packSize:  dyno.dynoFloat(params.paquetTaille),
  heightOrder: dyno.dynoFloat(params.ordreHauteur),

  // Flash lumineux

  // V2 : cadre de la photo, vu depuis son point de vue (l'origine du monde)
  horsCadre:   dyno.dynoFloat(1),                                 // taille des splats hors du cadre (1 = normale)
  tailleGlobale: dyno.dynoFloat(1),                               // taille de tous les splats (fin de l'élévation)
  croissance:  dyno.dynoFloat(1),                                 // voir params.croissance
  envolCourbe: dyno.dynoFloat(1),                                 // voir params.envolCourbe
  cadreFwd:    dyno.dynoVec3(new THREE.Vector3(0, 0, -1)),        // axe de la photo
  cadreRight:  dyno.dynoVec3(new THREE.Vector3(1, 0, 0)),
  cadreUp:     dyno.dynoVec3(new THREE.Vector3(0, 1, 0)),
  cadreTanH:   dyno.dynoFloat(1),                                 // tangente du demi-champ horizontal
  cadreTanV:   dyno.dynoFloat(1),
};

// ---------- GLSL : bruit simplex avec gradient, puis curl noise ----------
// Simplex 3D (Ashima Arts / Stefan Gustavson, domaine public), version qui renvoie
// aussi son gradient : la direction dans laquelle le bruit augmente le plus vite.
const NOISE_GLSL = `
vec3 gw_mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 gw_mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 gw_permute(vec4 x) { return gw_mod289(((x * 34.0) + 1.0) * x); }
vec4 gw_taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float gw_snoise(vec3 v, out vec3 gradient) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g  = step(x0.yzx, x0.xyz);
  vec3 l  = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = gw_mod289(i);
  vec4 p = gw_permute(gw_permute(gw_permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j  = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x  = x_ * ns.x + ns.yyyy;
  vec4 y  = y_ * ns.x + ns.yyyy;
  vec4 h  = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = gw_taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m  = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  vec4 m2 = m * m;
  vec4 m4 = m2 * m2;
  vec4 pdotx = vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3));
  vec4 temp = m2 * m * pdotx;
  gradient = -8.0 * (temp.x * x0 + temp.y * x1 + temp.z * x2 + temp.w * x3);
  gradient += m4.x * p0 + m4.y * p1 + m4.z * p2 + m4.w * p3;
  gradient *= 42.0;
  return 42.0 * dot(m4, pdotx);
}

// Curl noise : le « rotationnel » de trois champs de bruit.
// Résultat : un écoulement qui tourbillonne sans jamais agglutiner ni vider une zone,
// comme un fluide. C'est ce que fait le module Curl Noise Force de Niagara.
vec3 gw_curl(vec3 p) {
  vec3 g1, g2, g3;
  gw_snoise(p, g1);
  gw_snoise(p + vec3(31.416, -47.853, 12.679), g2);
  gw_snoise(p + vec3(-233.145, -113.408, -185.31), g3);
  return vec3(g3.y - g2.z, g1.z - g3.x, g2.x - g1.y);
}

// Bruit scalaire à plusieurs octaves (pour le bord de la répulsion), entre −1 et 1 environ
float gw_fbm(vec3 p, int octaves) {
  vec3 g;
  float sum = 0.0;
  float amp = 1.0;
  float total = 0.0;
  for (int i = 0; i < 4; i++) {
    if (i >= octaves) break;
    sum += gw_snoise(p, g) * amp;
    total += amp;
    p *= 2.0;
    amp *= 0.5;
  }
  return sum / total;
}

// Plusieurs octaves : on superpose des tourbillons de plus en plus petits et faibles
vec3 gw_curlFbm(vec3 p, int octaves) {
  vec3 sum = vec3(0.0);
  float amp = 1.0;
  float total = 0.0;
  for (int i = 0; i < 4; i++) {
    if (i >= octaves) break;
    sum += gw_curl(p) * amp;
    total += amp;
    p *= 2.0;
    amp *= 0.5;
  }
  return sum / total;
}
`;

// Génère le code GLSL qui parcourt les 16 points de la traînée
// (on l'écrit en JavaScript pour ne pas répéter 16 fois le même bloc à la main)
function trailLoop(inputs) {
  let code = "";
  for (let i = 0; i < TRAIL_N; i++) {
    const tp = inputs["tr" + i];
    code += `
            if (${tp}.w > 0.0) {
              float dt${i} = distance(c, ${tp}.xyz);
              fTrail = max(fTrail, (1.0 - smoothstep(inner, ${inputs.radius}, dt${i})) * ${tp}.w);
            }`;
  }
  return code;
}

// ---------- Le bloc de forces, exécuté sur le GPU pour chaque splat ----------
function makeForcesModifier(grow, fall, dMin, dMax, origin) {
  return dyno.dynoBlock(
    { gsplat: dyno.Gsplat },
    { gsplat: dyno.Gsplat },
    ({ gsplat }) => {
      const forces = new dyno.Dyno({
        inTypes: {
          gsplat: dyno.Gsplat,
          t: "float",
          camPos: "vec3",
          camFwd: "vec3",
          repForce: "float",
          repR: "float",
          repStretch: "float",
          edgeNoise: "float",
          edgeFreq: "float",
          edgeOct: "int",
          edgePan: "vec3",
          edgeSeed: "float",
          noiseInside: "float",
          radius: "float",
          softness: "float",
          curlForce: "float",
          curlFreq: "float",
          octaves: "int",
          pan: "vec3",
          seed: "float",
          grow: "float",   // transition : 1 = scène entière, 0 = disparue
          fall: "float",   // 1 = apparition en tombant du ciel, 0 = disparition en rapetissant
          fallHeight: "float",
          packs: "float",
          packSize: "float",
          heightOrder: "float",
          dMin: "float",   // distance des gaussiennes les plus proches de la caméra (propre à chaque scène)
          dMax: "float",   // distance des plus lointaines
          origin: "vec3",  // position de la caméra au début de la phase, pour mesurer ces distances
          spread: "float", // étalement de la dissolution
          horsCadre: "float",
          tailleGlobale: "float",
          croissance: "float",
          envolCourbe: "float",
          cadreFwd: "vec3",
          cadreRight: "vec3",
          cadreUp: "vec3",
          cadreTanH: "float",
          cadreTanV: "float",
          // les 16 points de la traînée : xyz = position, w = poids (1 = récent, 0 = effacé)
          tr0: "vec4",
          tr1: "vec4",
          tr2: "vec4",
          tr3: "vec4",
          tr4: "vec4",
          tr5: "vec4",
          tr6: "vec4",
          tr7: "vec4",
          tr8: "vec4",
          tr9: "vec4",
          tr10: "vec4",
          tr11: "vec4",
          tr12: "vec4",
          tr13: "vec4",
          tr14: "vec4",
          tr15: "vec4",
        },
        outTypes: { gsplat: dyno.Gsplat },
        globals: () => [dyno.unindent(NOISE_GLSL)],
        statements: ({ inputs, outputs }) => dyno.unindentLines(`
          ${outputs.gsplat} = ${inputs.gsplat};
          {
            vec3 c = ${inputs.gsplat}.center;
            vec3 fwd = normalize(${inputs.camFwd});
            vec3 rel = c - ${inputs.camPos};
            float along = dot(rel, fwd);                 // distance devant (+) ou derrière (−) la caméra
            vec3 side = rel - fwd * along;               // de l'axe du regard vers le splat
            float s = along > 0.0 ? ${inputs.repStretch} : 1.0;
            float dq = length(side + fwd * (along / s)); // distance dans une zone allongée vers l'avant
            float R = ${inputs.repR};

            // Bord bruité : le rayon de la répulsion varie d'un endroit à l'autre selon un bruit
            // (ses propres réglages, ou ceux du curl noise quand « Suivre le curl noise » est coché).
            if (${inputs.edgeNoise} > 0.0 && dq < ${inputs.radius} * (1.0 + ${inputs.edgeNoise})) {
              vec3 pe = c * ${inputs.edgeFreq} + ${inputs.edgePan} * ${inputs.t}
                      + vec3(17.13, 31.71, 9.37) * ${inputs.edgeSeed} + vec3(5.2, 1.3, 7.7);
              R *= 1.0 + ${inputs.edgeNoise} * gw_fbm(pe, ${inputs.edgeOct});
            }

            vec3 disp = vec3(0.0);
            bool moved = false;

            // 1. Répulsion : dans la zone, les splats glissent vers les bords de l'écran,
            //    sur le côté de l'axe du regard, et la caméra passe au milieu.
            if (${inputs.repForce} > 0.0 && dq < R) {
              float sl = length(side);
              vec3 dir = sl > 1e-4 ? side / sl : normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
              disp += dir * (R - dq) * ${inputs.repForce};
              moved = true;
            }

            // 2. Curl noise : dans la couronne autour de la zone de répulsion, et dans le sillage.
            float inner = ${inputs.radius} * (1.0 - ${inputs.softness});
            float fRing = 1.0 - smoothstep(inner, ${inputs.radius}, dq);
            float fTrail = 0.0;
            ${trailLoop(inputs)}
            // Dans la zone de répulsion, le bruit est réduit à « Bruit dans la zone » ;
            // il atteint sa pleine force en douceur juste après le bord
            float fIn = mix(${inputs.noiseInside}, 1.0, smoothstep(R, mix(R, ${inputs.radius}, 0.3), dq));
            float fNoise = max(fRing, fTrail) * fIn;

            if (${inputs.curlForce} != 0.0 && fNoise > 0.0) {
              vec3 seedOffset = vec3(17.13, 31.71, 9.37) * ${inputs.seed};
              vec3 p = c * ${inputs.curlFreq} + ${inputs.pan} * ${inputs.t} + seedOffset;
              disp += gw_curlFbm(p, ${inputs.octaves}) * 0.3 * ${inputs.curlForce} * fNoise;
              moved = true;
            }

            if (moved) ${outputs.gsplat}.center = c + disp;

            // V2 : hors du cadre de la photo (vu depuis l'origine, son point de vue), les splats
            // sont réduits. Coupure nette : on voit la limite entre le documenté et le généré.
            if (${inputs.horsCadre} < 1.0) {
              float zc = dot(c, ${inputs.cadreFwd});
              bool dansCadre = zc > 0.0
                && abs(dot(c, ${inputs.cadreRight})) <= zc * ${inputs.cadreTanH}
                && abs(dot(c, ${inputs.cadreUp})) <= zc * ${inputs.cadreTanV};
              if (!dansCadre) ${outputs.gsplat}.scales *= ${inputs.horsCadre};
            }
            // V2 : taille de l'ensemble (les splats rapetissent à la fin de l'élévation,
            // et la disparition part de cette taille réduite)
            ${outputs.gsplat}.scales *= ${inputs.tailleGlobale};

            // Transition entre scènes : chaque gaussienne a son propre moment, dans un ordre
            // aléatoire mais toujours le même pour une gaussienne donnée.
            if (${inputs.grow} < 1.0) {
              // Moment de passage de chaque gaussienne : un mélange entre
              // - un hasard propre à chaque gaussienne (grain par grain)
              // - un bruit de basse fréquence : les gaussiennes voisines passent ensemble, en paquets
              float hRand = fract(sin(dot(c, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
              vec3 gp;
              float hPack = smoothstep(-0.6, 0.6,
                gw_snoise(c / max(${inputs.packSize}, 0.01) + vec3(3.1, 7.7, 1.9), gp));
              float h = mix(hRand, hPack, ${inputs.packs});
              // Ordre par distance : les plus proches de la caméra arrivent en premier,
              // les plus lointaines en dernier ; à la disparition (sens inverse),
              // les plus lointaines partent en premier et les plus proches en dernier.
              float dOrigin = distance(c, ${inputs.origin});
              float hDist = clamp((dOrigin - ${inputs.dMin}) / max(${inputs.dMax} - ${inputs.dMin}, 1e-3), 0.0, 1.0);
              h = mix(h, hDist, ${inputs.heightOrder});
              float w = mix(1.0, 0.08, ${inputs.spread});   // durée propre de chaque gaussienne
              float k = clamp((${inputs.grow} - h * (1.0 - w)) / w, 0.0, 1.0); // 0 = hors scène, 1 = à sa place
              // Taille : nulle loin de sa place ; grandit (ou rapetisse) sur « croissance » de son mouvement
              float appear = clamp(k / max(${inputs.croissance}, 0.01), 0.0, 1.0);

              if (${inputs.fall} > 0.5) {
                // Apparition : surgit en hauteur puis tombe, de plus en plus vite, jusqu'à sa place
                ${outputs.gsplat}.center.y += ${inputs.fallHeight} * (1.0 - k * k);
              } else {
                // Disparition : le sens contraire, s'envole vers le haut, de plus en plus vite
                // V2 : « Envol : courbe » : 1 = part tout de suite à vitesse constante ; 2 = accélère (à l'origine)
                float up = 1.0 - k;
                ${outputs.gsplat}.center.y += ${inputs.fallHeight} * pow(up, ${inputs.envolCourbe});
              }
              ${outputs.gsplat}.scales *= appear;
              if (appear <= 0.0) ${outputs.gsplat}.rgba.a = 0.0;
            }
          }
        `),
      });

      gsplat = forces.apply({
        gsplat,
        t: u.time,
        camPos: u.camPos,
        camFwd: u.camFwd,
        repForce: u.repForce,
        repR: u.repR,
        repStretch: u.repStretch,
        edgeNoise: u.edgeNoise,
        edgeFreq: u.edgeFreq,
        edgeOct: u.edgeOct,
        edgePan: u.edgePan,
        edgeSeed: u.edgeSeed,
        noiseInside: u.noiseInside,
        radius: u.radius,
        softness: u.softness,
        curlForce: u.curlForce,
        curlFreq: u.curlFreq,
        octaves: u.octaves,
        pan: u.pan,
        seed: u.seed,
        grow,
        fall,
        fallHeight: u.fallHeight,
        packs: u.packs,
        packSize: u.packSize,
        heightOrder: u.heightOrder,
        dMin,
        dMax,
        origin,
        spread: u.spread,
        horsCadre: u.horsCadre,
        tailleGlobale: u.tailleGlobale,
        croissance: u.croissance,
        envolCourbe: u.envolCourbe,
        cadreFwd: u.cadreFwd,
        cadreRight: u.cadreRight,
        cadreUp: u.cadreUp,
        cadreTanH: u.cadreTanH,
        cadreTanV: u.cadreTanV,
        tr0: uTrail[0],
        tr1: uTrail[1],
        tr2: uTrail[2],
        tr3: uTrail[3],
        tr4: uTrail[4],
        tr5: uTrail[5],
        tr6: uTrail[6],
        tr7: uTrail[7],
        tr8: uTrail[8],
        tr9: uTrail[9],
        tr10: uTrail[10],
        tr11: uTrail[11],
        tr12: uTrail[12],
        tr13: uTrail[13],
        tr14: uTrail[14],
        tr15: uTrail[15],
      }).gsplat;

      return { gsplat };
    },
  );
}

// ---------- Scènes (V2) : les mondes Marble de 01_PROJETS ----------
// La liste est fournie par le serveur (voir vite.config.js), par ordre chronologique,
// avec pour chaque photo sa version Vn la plus haute.
// Densité chargée : pleine densité par défaut ; http://localhost:5173/?densite=500k pour la version allégée.
const MONDES_URL = "/api/mondes-file/";
const DENSITE = new URLSearchParams(location.search).get("densite") === "500k" ? "500k" : "full_res";
let sceneFiles = [];       // V2 : objets { photo, corpus, version, fichiers: { full_res, 500k } }
let sceneIndex = 0;
let splat = null;          // la scène affichée

function densiteDe(monde) {
  return monde.fichiers[DENSITE] ? DENSITE : Object.keys(monde.fichiers)[0]; // densité demandée, ou l'autre
}

function creerMonde(monde) {
  const mesh = makeSplat(MONDES_URL + encodeURIComponent(monde.fichiers[densiteDe(monde)]), 0); // démarre invisible
  mesh.userData.cadrage = monde.cadrage; // point de vue de la photo d'origine (ou null)
  // Splat Postshot : on le replace pour que le point de vue de la photo soit à l'origine, comme un monde Marble
  const r = monde.cadrage?.repere;
  if (r) {
    const [w, x, y, z] = r.rotation_wxyz;
    mesh.quaternion.multiply(new THREE.Quaternion(x, y, z, w));
    mesh.position.fromArray(r.origine).applyQuaternion(mesh.quaternion).negate();
  }
  mesh.userData.photoTex = chargerPhoto(monde); // photo d'origine, affichée dans le cadre pendant la pose
  mesh.userData.fiche = monde.fiche || null;    // fiche MuIS, pour le HUD
  return mesh;
}

// Lit et décompresse le monde suivant en arrière-plan, pendant l'orbite, sans l'afficher : il n'occupe pas encore
// la carte graphique. Le reste (libérer l'ancien monde, envoi à la carte) se fait dans le noir.
let precharge = null; // { index, mesh }
function prechargerSuivant() {
  if (precharge || sceneFiles.length < 2) return;
  const index = (sceneIndex + 1) % sceneFiles.length;
  precharge = { index, mesh: creerMonde(sceneFiles[index]) };
}

let loadingScene = false;

function makeSplat(url, startGrow = 1) {
  const chargement = { progres: 0 }; // part du fichier reçue, de 0 à 1 (barre de chargement)
  const mesh = new SplatMesh({
    url,
    onProgress: (e) => {
      chargement.progres = e.total ? Math.min(1, e.loaded / e.total) : 1;
    },
  });
  mesh.userData.chargement = chargement;
  mesh.quaternion.set(1, 0, 0, 0); // retourne la scène ; à retirer si elle apparaît à l'envers
  mesh.userData.grow = dyno.dynoFloat(startGrow); // avancement de la transition (0 à 1)
  mesh.userData.fall = dyno.dynoFloat(0);         // 1 pendant l'apparition (chute), 0 sinon
  mesh.userData.dMin = dyno.dynoFloat(0);         // distances à la caméra des plus proches et des plus
  mesh.userData.dMax = dyno.dynoFloat(10);        // lointaines, mesurées au début de chaque phase (setOrderOrigin)
  mesh.userData.origin = dyno.dynoVec3(new THREE.Vector3());
  const ud = mesh.userData;
  mesh.worldModifier = makeForcesModifier(ud.grow, ud.fall, ud.dMin, ud.dMax, ud.origin);
  mesh.updateGenerator();
  return mesh;
}

// ---------- Panneau de réglages ----------
const gui = new GUI({ title: "Forces" });

const fZone = gui.addFolder("Déclenchement");
fZone.add(params, "active").name("Active");
fZone.add(params, "modeEffet", ["Toujours", "Maintenir pour activer", "Maintenir pour couper", "Appui = bascule"]).name("Mode");
fZone.add(params, "fondu", 0, 2, 0.01).name("Fondu (s)");

const fRep = gui.addFolder("Répulsion");
fRep.add(params, "repForce", 0, 1, 0.01).name("Force");
fRep.add(params, "repRayon", 1, 5, 0.05).name("Rayon");

const fRepNoise = fRep.addFolder("Bruit de la répulsion");
fRepNoise.add(params, "repBordBruite", 0, 1, 0.01).name("Bord bruité");
const repOwn = [];
fRepNoise.add(params, "repSuivreCurl").name("Suivre le curl noise").onChange((v) => {
  repOwn.forEach((ctrl) => ctrl.enable(!v)); // réglages propres grisés quand le bord suit le curl noise
});
repOwn.push(fRepNoise.add(params, "repBruitFrequence", 0.1, 10, 0.05).name("Fréquence du bord"));
repOwn.push(fRepNoise.add(params, "repBruitOctaves", 1, 4, 1).name("Octaves du bord"));
repOwn.push(fRepNoise.add(params, "repBruitVitesse", -2, 2, 0.01).name("Vitesse du bord"));
repOwn.forEach((ctrl) => ctrl.enable(!params.repSuivreCurl));
fRepNoise.add(params, "repBruitDedans", 0, 1, 0.01).name("Bruit dans la zone");

const fCurl = gui.addFolder("Curl noise (autour)");
fCurl.add(params, "bruitEpaisseur", 0.1, 10, 0.05).name("Épaisseur de la couronne");
fCurl.add(params, "douceur", 0, 1, 0.01).name("Douceur du bord");
fCurl.add(params, "curlForce", 0, 3, 0.01).name("Force");
fCurl.add(params, "curlFrequence", 0.1, 10, 0.05).name("Fréquence");
fCurl.add(params, "curlOctaves", 1, 4, 1).name("Octaves");
fCurl.add(params, "panX", -2, 2, 0.01).name("Défilement X");
fCurl.add(params, "panY", -2, 2, 0.01).name("Défilement Y");
fCurl.add(params, "panZ", -2, 2, 0.01).name("Défilement Z");
fCurl.add(params, "graine", 0, 100, 1).name("Graine");
fCurl.add(params, "sillageDuree", 0, 15, 0.1).name("Durée du sillage (s)");
fCurl.add(params, "sillageEspacement", 0.05, 1.5, 0.01).name("Espacement du sillage");

const fLens = gui.addFolder("Objectif");
fLens.add(params, "focale", 10, 200, 1).name("Focale (mm)").listen();
fLens.add(params, "fov").name("FOV (°)").listen().disable();
fLens.add(params, "miseAuPoint", 0.1, 30, 0.01).name("Mise au point (m)").listen();
fLens.add(params, "ouverture", 0, 0.2, 0.001).name("Ouverture (flou)").listen(); // petites valeurs : au-delà de 0.01, le Mac rame
fLens.add(params, "ouvertureAppliquee").name("Ouverture appliquée").listen().disable();
fLens.add(params, "seuilProche", 0.2, 5, 0.05).name("Seuil de mise au point proche (m)");
fLens.add(params, "fonduOuverture", 0, 3, 0.05).name("Fondu de l'ouverture (s)");
fLens.add(params, "autofocus").name("Autofocus (centre)").listen();
fLens.add(params, "vitesseAF", 0, 2, 0.01).name("Vitesse autofocus (s)");
fLens.add(params, "demoFlou").name("▶ Démo flou");
fLens.add(params, "toutNet").name("Tout net");

const fHud = gui.addFolder("HUD");
fHud.add(params, "hudVisible").name("Afficher").onChange((v) => {
  hud.style.display = v ? "block" : "none";
});
fHud.add(params, "ficheVisible").name("Fiche MuIS (haut gauche)");
fHud.add(params, "ficheVitesse", 5, 200, 1).name("Fiche : vitesse de frappe");
fHud.add(params, "chapitreVisible").name("Chapitre (haut droite)");
fHud.add(params, "chapitreFondu", 0, 5, 0.1).name("Chapitre : fondu (s)");
fHud.add(params, "chapitreVideDuree", 0, 15, 0.5).name("Chapitre sans image (s)");
fHud.add(params, "hudOpacite", 0, 1, 0.01).name("Opacité").onChange((v) => {
  hud.style.opacity = v;
});

const fScenes = gui.addFolder("Scènes");
fScenes.add(params, "sceneNom").name("Scène").listen().disable();
fScenes.add({ precedente: () => changerDeMonde(-1) }, "precedente").name("◀ Précédente");
fScenes.add({ suivante: () => changerDeMonde(1) }, "suivante").name("Suivante ▶");
fScenes.add(params, "sceneResetCamera").name("Revenir au départ");
fScenes.add(params, "cadreVisible").name("Cadre de la photo");
fScenes.add(params, "cadreOpacite", 0, 1, 0.01).name("Opacité du cadre");
fScenes.add(params, "cadreEpaisseur", 1, 20, 0.5).name("Épaisseur du cadre (px)");
fScenes.add(params, "cadreMarge", 1, 2, 0.01).name("Marge autour de la photo");
fScenes.add(params, "cadreDistance", 0.1, 10, 0.05).name("Distance du cadre (m)");
fScenes.add(params, "lacetCorrection", -180, 180, 1).name("Correction du lacet (°)"); // le cadre suit tout seul (updateCadre)
fScenes.add({ pdv: () => allerAuPointDeVue() }, "pdv").name("Revenir au point de vue");

const fSeq = gui.addFolder("Séquence automatique");
fSeq.add(params, "seqActive").name("Active (L)").listen(); // lue à chaque image par updateSequence
fSeq.add(params, "seqPose", 0, 20, 0.5).name("Pose (s)");
fSeq.add(params, "seqAvanceDuree", 1, 30, 0.5).name("Avancée : durée (s)");
fSeq.add(params, "seqAvanceDist", 0, 10, 0.1).name("Avancée : distance (m)");
fSeq.add(params, "seqFocaleCible", 10, 100, 1).name("Avancée : focale d'arrivée (mm)");
fSeq.add(params, "seqTourDuree", 1, 120, 0.5).name("Tour sur soi : durée (s)");
fSeq.add(params, "seqTourDist", 0, 10, 0.1).name("Tour sur soi : avancée (m)");
fSeq.add(params, "seqTourMontee", 0, 20, 0.1).name("Tour sur soi : montée (m)");
fSeq.add(params, "seqReculDuree", 1, 60, 0.5).name("Recul : durée (s)");
fSeq.add(params, "seqReculPct", 0, 300, 5).name("Recul (% de la distance)");
fSeq.add(params, "seqMonteeHaut", 0, 50, 0.5).name("Hauteur finale (m)");
fSeq.add(params, "seqOrbiteDuree", 1, 120, 0.5).name("Orbite : durée (s)");
fSeq.add(params, "seqOrbiteAngle", 0, 360, 5).name("Orbite : angle (°)");
fSeq.add(params, "seqRegardCadre", 0, 1, 0.05).name("Orbite : regard vers le cadre");
fSeq.add(params, "seqPhoto").name("Photo d'origine (pose)");
fSeq.add(params, "seqFlashDuree", 0, 3, 0.05).name("Flash blanc : durée (s)");
fSeq.add(params, "seqPhotoAvance", 0, 1, 0.05).name("Photo : apparition (fin de chute)");
fSeq.add(params, "cadreTraceDuree", 0, 5, 0.1).name("Cadre : durée du tracé (s)");
fSeq.add(params, "seqEnvolAnticipation", 0, 0.5, 0.01).name("Envol : anticipation (part)");
fSeq.add(params, "seqPauseFin", 0, 20, 0.5).name("Pause après l'orbite (s)");
fSeq.add(params, "horsCadreTaille", 0, 1, 0.01).name("Taille de base (pose, fin)");
fSeq.add(params, "seqCibleMin", 1, 50, 0.5).name("Cible : distance min. (m)");
fScenes.add(params, "transitionDuree", 0, 5, 0.1).name("Durée de chaque phase (s)");
fScenes.add(params, "transitionEtalement", 0, 1, 0.01).name("Étalement");
fScenes.add(params, "chuteHauteur", 0, 20, 0.1).name("Hauteur d'envol / de chute");
fScenes.add(params, "paquets", 0, 1, 0.01).name("Regroupement en paquets");
fScenes.add(params, "paquetTaille", 0.1, 10, 0.05).name("Taille des paquets");
fScenes.add(params, "ordreHauteur", 0, 1, 0.01).name("Ordre par distance");
fScenes.add(params, "croissance", 0.05, 1, 0.01).name("Grandir / rapetisser (part)");
fScenes.add(params, "envolCourbe", 0.5, 3, 0.05).name("Envol : courbe (1 = immédiat)");
fScenes.add(params, "cameraInclinaison", 0, 80, 1).name("Mouvement caméra (°)");
fScenes.add(params, "cameraRetard", 0, 3, 0.05).name("Retard de la caméra (s)");

const fPhoto = gui.addFolder("Photo");
fPhoto.add({ prendre: () => requestPhoto() }, "prendre").name("📷 Prendre une photo");
fPhoto.add({ galerie: () => toggleGallery() }, "galerie").name("🖼 Ouvrir / fermer la galerie");
fPhoto.add(params, "photoResolution", 0.5, 3, 0.25).name("Résolution photo");
fPhoto.add(params, "photoFormat", ["PNG", "JPEG"]).name("Format");
fPhoto.add(params, "flashLumiere").name("Flash blanc");
fPhoto.add(params, "flashDuree", 0.05, 3, 0.05).name("Durée du flash (s)");
fPhoto.add(params, "apercu").name("Aperçu en vignette");
fPhoto.add(params, "apercuDuree", 0.5, 10, 0.5).name("Durée de l'aperçu (s)");
fPhoto.add(params, "apercuTaille", 120, 480, 10).name("Taille de l'aperçu (px)");

const fPerf = gui.addFolder("Performance");
fPerf.add(params, "fpsMax", { "30 i/s": 30, "60 i/s": 60, "Sans limite": 0 }).name("Images par seconde (max)");
fPerf.add(params, "resolution", 0.5, 2, 0.05).name("Résolution de rendu").onChange((v) => {
  renderer.setPixelRatio(v);
  renderer.setSize(window.innerWidth, window.innerHeight);
});
fPerf.add(params, "etendue", 1.5, 3, 0.01).name("Étendue des splats").onChange((v) => {
  spark.maxStdDev = v;
});
// Un bouton, pas une case : ce choix ne doit pas passer par la sauvegarde du panneau (il recharge la page)
fPerf.add({
  basculer() {
    try {
      localStorage.setItem(CLE_TAILLES_PRECISES, taillesPrecises ? "0" : "1");
    } catch (e) {}
    location.reload();
  },
}, "basculer").name(`Tailles précises : ${taillesPrecises ? "oui" : "non"} (cliquer pour changer)`);

// ---------- Sauvegarde des réglages ----------
// Chaque modification du panneau est enregistrée dans le navigateur et restaurée au rechargement.
// Pour changer de version de réglages sans conflit, il suffit de changer ce nom.
// V2 : réglages séparés de ceux de la V1. Au premier lancement, valeurs par défaut du code
// (celles de reglages\reglages_2026-11-07.json).
const STORAGE_KEY = "gaussian-walk-v2.reglages.v7";

function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(gui.save()));
  } catch (e) {
    console.warn("Sauvegarde des réglages impossible :", e);
  }
}

function loadSettings() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    // Sans réglages enregistrés, on garde les valeurs par défaut du code (reglages_2026-11-07.json) ;
    // on ne reprend plus ceux de la V1.
    if (saved) gui.load(JSON.parse(saved)); // applique aussi les effets (résolution, HUD…)
    // Nouvelles valeurs par défaut, appliquées une seule fois par-dessus les réglages enregistrés
    // (Celles du 7 novembre 2026 ont été retirées : les valeurs par défaut du code sont désormais
    //  celles de reglages\reglages_2026-11-07.json, qui en tiennent compte.)
    const MIGRATIONS = [];
    for (const m of MIGRATIONS) {
      const cle = "gaussian-walk-v2.migration." + m.id;
      if (localStorage.getItem(cle)) continue;
      Object.assign(params, m.valeurs);
      localStorage.setItem(cle, "1");
    }
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
  } catch (e) {
    console.warn("Réglages sauvegardés illisibles, valeurs par défaut utilisées :", e);
  }
}

// Exporter : télécharge un fichier .json avec tous les réglages actuels
function exportSettings() {
  const blob = new Blob([JSON.stringify(gui.save(), null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "gaussian-walk-reglages.json";
  link.click();
  URL.revokeObjectURL(link.href);
}

// Importer : ouvre un fichier .json exporté auparavant et l'applique
const fileInput = document.createElement("input");
fileInput.type = "file";
fileInput.accept = ".json,application/json";
fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file) return;
  try {
    gui.load(JSON.parse(await file.text()));
    saveSettings();
  } catch (e) {
    alert("Ce fichier ne contient pas de réglages valides.");
  }
  fileInput.value = "";
});

const settingsActions = {
  reinitialiser: () => {
    gui.reset();                          // revient aux valeurs écrites dans le code
    localStorage.removeItem(STORAGE_KEY);
  },
  exporter: exportSettings,
  importer: () => fileInput.click(),
};

const fSettings = gui.addFolder("Réglages");
fSettings.add(settingsActions, "exporter").name("Exporter (.json)");
fSettings.add(settingsActions, "importer").name("Importer (.json)");
fSettings.add(settingsActions, "reinitialiser").name("Réinitialiser");

loadSettings();
params.toutNet(); // démarre toujours sans flou de focale, quels que soient les réglages sauvegardés
gui.onFinishChange(saveSettings);                     // à chaque réglage modifié dans le panneau
window.addEventListener("beforeunload", saveSettings); // et à la fermeture (garde aussi zoom et mise au point faits à la manette)

// ---------- Souris : regarder autour ----------
const look = new PointerLockControls(camera, renderer.domElement);
renderer.domElement.addEventListener("click", () => look.lock());

// ---------- Clavier ----------
const keys = {};
window.addEventListener("keydown", (e) => (keys[e.code] = true));
window.addEventListener("keyup", (e) => (keys[e.code] = false));

// ---------- Commandes abstraites ----------
const input = { forward: 0, right: 0, up: 0, yaw: 0, pitch: 0, effect: 0, zoom: 0, focus: 0, photo: 0, gallery: 0, scene: 0, sequence: 0 };

function resetInput() {
  for (const k in input) input[k] = 0;
}

function readKeyboard() {
  input.forward += (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);       // Z / S
  input.right   += (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);       // D / Q
  input.up      += (keys.Space ? 1 : 0) - (keys.ShiftLeft ? 1 : 0); // Espace / Maj
  input.scene   += (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0); // ← / → : scène précédente / suivante
  input.pitch   += (keys.ArrowUp ? 1 : 0) - (keys.ArrowDown ? 1 : 0);
  input.effect  += keys.KeyE ? 1 : 0;                                // E : déclencher l'effet
  input.zoom    += (keys.KeyR ? 1 : 0) - (keys.KeyF ? 1 : 0);       // R / F : zoom
  input.focus   += (keys.KeyT ? 1 : 0) - (keys.KeyG ? 1 : 0);       // T / G : mise au point
  input.photo   += keys.KeyP ? 1 : 0;                                // P : prendre une photo
  input.gallery += keys.KeyB ? 1 : 0;                                // B : ouvrir / fermer la galerie
  input.sequence += keys.KeyL ? 1 : 0;                               // L : lancer / arrêter la séquence (V2)
}

// ---------- Gamepad ----------
const DEADZONE = 0.15;
function dz(v) {
  if (Math.abs(v) < DEADZONE) return 0;
  return Math.sign(v) * (Math.abs(v) - DEADZONE) / (1 - DEADZONE);
}

window.addEventListener("gamepadconnected", (e) => console.log("Manette connectée :", e.gamepad.id));
window.addEventListener("gamepaddisconnected", () => console.log("Manette déconnectée"));

function readGamepad() {
  const pad = [...navigator.getGamepads()].find((p) => p);
  if (!pad) return;
  input.forward += -dz(pad.axes[1] ?? 0);
  input.right   +=  dz(pad.axes[0] ?? 0);
  input.yaw     +=  dz(pad.axes[2] ?? 0);
  input.pitch   += -dz(pad.axes[3] ?? 0);
  input.up      += (pad.buttons[7]?.value ?? 0) - (pad.buttons[6]?.value ?? 0);
  input.effect  += pad.buttons[0]?.pressed ? 1 : 0;                                       // A (Xbox) / Croix (PlayStation)
  input.zoom    += (pad.buttons[12]?.pressed ? 1 : 0) - (pad.buttons[13]?.pressed ? 1 : 0); // croix directionnelle haut / bas
  input.focus   += (pad.buttons[5]?.pressed ? 1 : 0) - (pad.buttons[4]?.pressed ? 1 : 0);   // RB / LB
  input.photo   += pad.buttons[3]?.pressed ? 1 : 0;                                       // Y (Xbox) / Triangle (PlayStation)
  input.gallery += pad.buttons[8]?.pressed ? 1 : 0;                                       // View / Select / Share
  input.sequence += pad.buttons[9]?.pressed ? 1 : 0;                                      // Menu / Start : séquence (V2)
  input.scene   += (pad.buttons[15]?.pressed ? 1 : 0) - (pad.buttons[14]?.pressed ? 1 : 0); // croix gauche / droite
}

function clampInput() {
  for (const k in input) input[k] = THREE.MathUtils.clamp(input[k], -1, 1);
}

// ---------- Appliquer les commandes à la caméra (vol libre) ----------
const speed = 1.5;
const lookSpeed = 1.8;
const euler = new THREE.Euler(0, 0, 0, "YXZ");
const forwardDir = new THREE.Vector3();
const rightDir = new THREE.Vector3();

function applyInput(dt) {
  euler.setFromQuaternion(camera.quaternion);
  euler.y -= input.yaw * lookSpeed * dt;
  euler.x += input.pitch * lookSpeed * dt;
  euler.x = THREE.MathUtils.clamp(euler.x, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
  camera.quaternion.setFromEuler(euler);

  camera.getWorldDirection(forwardDir);
  rightDir.crossVectors(forwardDir, camera.up).normalize();

  camera.position.addScaledVector(forwardDir, input.forward * speed * dt);
  camera.position.addScaledVector(rightDir, input.right * speed * dt);
  camera.position.y += input.up * speed * dt;
}

// ---------- Envoyer les réglages et la caméra au GPU ----------
// Inertie : le centre de la zone rejoint la caméra progressivement
function updateEffectCenter(dt) {
  effectCenter.copy(camera.position); // plus d'inertie : tout part de la position exacte de la caméra
}

// Sillage : on enregistre un point chaque fois que la zone a parcouru « espacement »,
// puis chaque point s'efface avec son âge
function updateTrail(now) {
  const last = trailPoints[0];
  if (!last || last.pos.distanceTo(effectCenter) > params.sillageEspacement) {
    trailPoints.unshift({ pos: effectCenter.clone(), time: now });
    if (trailPoints.length > TRAIL_N) trailPoints.pop();
  }

  for (let i = 0; i < TRAIL_N; i++) {
    const tp = trailPoints[i];
    if (!tp || !params.active || params.sillageDuree <= 0) {
      uTrail[i].value.set(0, 0, 0, 0);
      continue;
    }
    const age = now - tp.time;
    const timeFade = Math.max(0, 1 - age / params.sillageDuree); // s'efface avec le temps
    const indexFade = 1 - i / TRAIL_N;                           // évite qu'un point disparaisse d'un coup
    const w = Math.min(timeFade, indexFade);
    uTrail[i].value.set(tp.pos.x, tp.pos.y, tp.pos.z, w * w);  // w² : fermeture plus douce
  }
}

// ---------- Déclenchement de l'effet au bouton, avec fondu ----------
let effectLevel = 0;         // intensité actuelle : 0 = éteint, 1 = plein effet
let effectToggled = true;    // état du mode « bascule » (V2 : forces actives au démarrage)
let effectWasPressed = false;

function updateEffectLevel(dt) {
  const pressed = input.effect > 0;
  if (pressed && !effectWasPressed) effectToggled = !effectToggled; // un appui = un changement
  effectWasPressed = pressed;

  let target = 1;
  if (params.modeEffet === "Maintenir pour activer") target = pressed ? 1 : 0;
  if (params.modeEffet === "Maintenir pour couper")  target = pressed ? 0 : 1;
  if (params.modeEffet === "Appui = bascule")        target = effectToggled ? 1 : 0;
  if (seq) target = seq.forces; // V2 : pendant la séquence, c'est elle qui dose les forces
  else if (params.seqActive) target = 0; // V2 : entre deux séquences (transition, chargement), forces coupées
  if (!params.active) target = 0;

  // Fondu : l'intensité rejoint la cible progressivement
  const k = params.fondu <= 0 ? 1 : 1 - Math.exp(-dt / params.fondu);
  effectLevel += (target - effectLevel) * k;
}

// ---------- Autofocus : mesure la distance de ce qui est au centre de l'image ----------
const raycaster = new THREE.Raycaster();
const screenCenter = new THREE.Vector2(0, 0);
let afTarget = null;     // distance visée par l'autofocus
let afTimer = 0;
const AF_INTERVAL = 0.15; // on mesure environ 7 fois par seconde, pas à chaque image (c'est coûteux)

function measureFocus(dt) {
  afTimer += dt;
  if (afTimer < AF_INTERVAL) return;
  afTimer = 0;
  try {
    if (!splat) return;
    raycaster.setFromCamera(screenCenter, camera);
    const hits = raycaster.intersectObject(splat, false);
    if (hits.length > 0) afTarget = hits[0].distance;
  } catch (e) {
    console.warn("Autofocus indisponible :", e);
    params.autofocus = false;
  }
}

// ---------- Objectif : focale, mise au point, flou ----------
let nearBlend = 1; // 1 = ouverture réglée, 0 = ouverture fermée (mise au point proche)

function updateLens(dt) {
  // Zoom progressif (vitesse proportionnelle, comme une vraie bague)
  params.focale = THREE.MathUtils.clamp(params.focale * Math.exp(input.zoom * dt), 10, 200);

  // Toucher la bague de mise au point (RB/LB ou T/G) coupe l'autofocus
  if (input.focus !== 0) params.autofocus = false;

  if (params.autofocus) {
    measureFocus(dt);
    if (afTarget !== null && afTarget > 0.01) {
      const k = params.vitesseAF <= 0 ? 1 : 1 - Math.exp(-dt / params.vitesseAF);
      // On interpole en « dioptries » (1 / distance), comme la bague d'un vrai objectif :
      // le flou perçu dépend de l'inverse de la distance, donc la transition paraît
      // aussi progressive vers l'avant-plan que vers l'arrière-plan.
      const invCurrent = 1 / params.miseAuPoint;
      const invTarget = 1 / afTarget;
      params.miseAuPoint = 1 / (invCurrent + (invTarget - invCurrent) * k);
    }
  } else {
    // Mise au point manuelle, deux fois plus rapide qu'avant pour qu'elle se sente
    params.miseAuPoint = THREE.MathUtils.clamp(params.miseAuPoint * Math.exp(input.focus * 2 * dt), 0.1, 30);
  }

  camera.setFocalLength(params.focale); // three.js convertit la focale en FOV
  params.fov = Math.round(camera.fov);

  // Flou de profondeur de Spark : l'ouverture se traduit en angle
  spark.focalDistance = params.miseAuPoint;
  // Mise au point sous le seuil (1 m) : l'ouverture appliquée descend progressivement jusqu'à 0,
  // en « Fondu de l'ouverture » secondes ; au-dessus du seuil, elle remonte à la valeur réglée.
  const nearTarget = params.miseAuPoint < params.seuilProche ? 0 : 1;
  const kNear = params.fonduOuverture <= 0 ? 1 : 1 - Math.exp(-dt / (params.fonduOuverture / 3));
  nearBlend += (nearTarget - nearBlend) * kNear;
  const ouvertureEffective = params.ouverture * nearBlend;
  params.ouvertureAppliquee = Math.round(ouvertureEffective * 10000) / 10000; // affichée dans le panneau
  spark.apertureAngle = ouvertureEffective > 0 ? 2 * Math.atan(0.5 * ouvertureEffective / params.miseAuPoint) : 0;
}

// ---------- Économie au repos ----------
// Toutes les forces (sillage compris) sont multipliées par l'intensité de l'effet.
// Quand elle est retombée à zéro, les splats sont à leur place d'origine : inutile de les
// recalculer à chaque image. On fait un dernier calcul pour les remettre en place,
// puis on s'arrête jusqu'au prochain déclenchement.
let wasIdle = false;

// ---------- Flash de la prise de vue ----------
// Retour visuel du déclenchement : juste APRÈS la prise de vue, un écran blanc (flashDiv) passe à 1
// (voir takePhoto), puis s'éteint progressivement. Les gaussians ne changent pas.
let flashLevel = 0;

function updateFlash(dt) {
  if (flashLevel > 0) {
    flashLevel *= Math.exp(-dt / Math.max(params.flashDuree / 3, 0.01)); // quasi éteint après « Durée du flash »
    if (flashLevel < 0.01) flashLevel = 0;
  }
}

function isIdle() {
  return effectLevel < 0.001;
}

function updateForces(elapsed) {
  const on = effectLevel < 0.001 ? 0 : effectLevel; // 0 à 1, piloté par le bouton et le fondu

  u.time.value = elapsed;
  u.camPos.value.copy(camera.position);
  camera.getWorldDirection(u.camFwd.value);

  u.repForce.value = params.repForce * on;
  u.repR.value = params.repRayon;
  u.repStretch.value = params.repRayon; // un seul réglage : l'allongement devant suit le rayon
  u.edgeNoise.value = params.repBordBruite;
  if (params.repSuivreCurl) {
    // Continuité : le bord utilise exactement le même bruit que le curl noise
    u.edgeFreq.value = params.curlFrequence;
    u.edgeOct.value = params.curlOctaves;
    u.edgePan.value.set(params.panX, params.panY, params.panZ);
  } else {
    u.edgeFreq.value = params.repBruitFrequence;
    u.edgeOct.value = params.repBruitOctaves;
    u.edgePan.value.set(0, params.repBruitVitesse, 0);
  }
  u.edgeSeed.value = params.graine;
  u.noiseInside.value = params.repBruitDedans;

  u.radius.value = params.repRayon + params.bruitEpaisseur; // la couronne commence au bord de la répulsion
  u.softness.value = params.douceur;
  u.curlForce.value = params.curlForce * on;
  u.curlFreq.value = params.curlFrequence;
  u.octaves.value = params.curlOctaves;
  u.pan.value.set(params.panX, params.panY, params.panZ);
  u.seed.value = params.graine;
  u.spread.value = params.transitionEtalement;
  u.fallHeight.value = params.chuteHauteur;
  u.packs.value = params.paquets;
  u.packSize.value = params.paquetTaille;
  u.heightOrder.value = params.ordreHauteur;

  // V2 : taille hors cadre, pilotée par la séquence ; un changement demande un recalcul
  const horsCadreChange = u.horsCadre.value !== horsCadreActuel || u.tailleGlobale.value !== tailleGlobaleActuelle;
  u.horsCadre.value = horsCadreActuel;
  u.tailleGlobale.value = tailleGlobaleActuelle;
  u.croissance.value = params.croissance;
  u.envolCourbe.value = params.envolCourbe;

  // Spark recalcule les splats avec les nouvelles valeurs… sauf au repos
  const idle = isIdle() && !horsCadreChange;
  if (splat && (!idle || !wasIdle)) splat.updateVersion(); // au passage au repos : un dernier calcul pour tout remettre en place
  wasIdle = idle;
}

// ---------- Photo ----------
// La photo contient uniquement l'image 3D : ni HUD, ni panneau, ni compteur.
// Elle est envoyée au serveur de développement (voir vite.config.js), qui l'enregistre
// dans le dossier « captures » du projet. Sans ce serveur, elle est téléchargée normalement.
let photoRequested = false;
let photoWasPressed = false;

function requestPhoto() {
  photoRequested = true; // la photo est prise dans la boucle, juste après le rendu
}

// Déclenchement par la couche de contrôle : un appui = une photo
function updatePhotoTrigger() {
  const pressed = input.photo > 0;
  if (pressed && !photoWasPressed) requestPhoto();
  photoWasPressed = pressed;
}

function timestamp() {
  const d = new Date();
  const two = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}_${two(d.getHours())}-${two(d.getMinutes())}-${two(d.getSeconds())}`;
}

// Petit message en bas de l'écran
const toast = document.createElement("div");
toast.style.cssText =
  "position:fixed; left:50%; bottom:32px; transform:translateX(-50%); padding:8px 14px; border-radius:6px;" +
  "background:rgba(0,0,0,0.6); color:#fff; font:13px system-ui, sans-serif; opacity:0; transition:opacity .4s;" +
  "pointer-events:none; z-index:20;";
document.body.appendChild(toast);
let toastTimer = null;
function showToast(text) {
  toast.textContent = text;
  toast.style.opacity = "1";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.style.opacity = "0"), 2500);
}

// Vignette : la photo apparaît en bas à gauche, au-dessus de l'angle du HUD, puis disparaît
const preview = document.createElement("img");
preview.style.cssText =
  "position:fixed; left:24px; bottom:72px; height:auto; border:3px solid #fff; border-radius:2px;" +
  "box-shadow:0 4px 18px rgba(0,0,0,0.5); opacity:0; transform:translateY(12px);" +
  "transition:opacity .3s ease-out, transform .3s ease-out; pointer-events:none; z-index:16; cursor:pointer;";
preview.title = "Ouvrir la galerie";
preview.addEventListener("click", () => openGallery()); // cliquer sur la vignette ouvre la galerie
document.body.appendChild(preview);
let previewTimer = null;
let previewUrl = null;

function showPreview(blob) {
  if (!params.apercu) return;
  if (previewUrl) URL.revokeObjectURL(previewUrl); // libère la vignette précédente
  previewUrl = URL.createObjectURL(blob);
  preview.src = previewUrl;
  preview.style.width = params.apercuTaille + "px";
  preview.style.opacity = "1";
  preview.style.transform = "translateY(0)";
  preview.style.pointerEvents = "auto"; // cliquable tant qu'elle est visible
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    preview.style.opacity = "0";
    preview.style.transform = "translateY(12px)";
    preview.style.pointerEvents = "none";
  }, params.apercuDuree * 1000);
}

async function savePhoto(blob, filename) {
  try {
    const res = await fetch("/api/capture", {
      method: "POST",
      headers: { "Content-Type": blob.type, "X-Filename": filename },
      body: blob,
    });
    if (!res.ok) throw new Error("réponse " + res.status);
    const { path } = await res.json();
    showToast("Photo enregistrée : " + path + "  ·  B / Select : galerie");
    if (galleryOpen) refreshGallery(); // la nouvelle photo apparaît tout de suite dans la galerie ouverte
  } catch (e) {
    // Repli : téléchargement classique, dans le dossier Téléchargements
    console.warn("Enregistrement dans le projet impossible, téléchargement à la place :", e);
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
    showToast("Photo téléchargée : " + filename);
  }
}

function takePhoto() {
  const canvas = renderer.domElement;
  const previousRatio = renderer.getPixelRatio();

  // On refait un rendu à la résolution photo, on le copie, puis on revient à la normale
  renderer.setPixelRatio(params.photoResolution);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.render(scene, camera);

  const jpeg = params.photoFormat === "JPEG";
  const filename = `gaussian-walk_${timestamp()}.${jpeg ? "jpg" : "png"}`;
  canvas.toBlob((blob) => {
    if (blob) {
      showPreview(blob);
      savePhoto(blob, filename);
    } else {
      showToast("La photo a échoué");
    }
  }, jpeg ? "image/jpeg" : "image/png", 0.95); // l'image est copiée immédiatement, avant le retour à la normale

  renderer.setPixelRatio(previousRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);

  if (params.flashLumiere) flashLevel = 1; // le flash s'allume après la prise de vue : il n'est pas sur la photo
}

// ---------- Galerie ----------
// Un volet sur la gauche liste toutes les photos du dossier « captures », de la plus récente
// à la plus ancienne. La liste et les images sont fournies par le serveur (voir vite.config.js).
let galleryOpen = false;
let galleryWasPressed = false;

const gallery = document.createElement("div");
gallery.style.cssText =
  "position:fixed; top:0; left:0; bottom:0; width:340px; max-width:85vw; display:flex; flex-direction:column;" +
  "background:rgba(14,14,14,0.92); backdrop-filter:blur(6px); color:#fff; font:13px system-ui, sans-serif;" +
  "transform:translateX(-100%); transition:transform .3s ease-out; z-index:30;";
gallery.innerHTML = `
  <div style="display:flex; align-items:center; gap:10px; padding:14px 16px; border-bottom:1px solid rgba(255,255,255,.12)">
    <strong style="font-size:14px">Galerie</strong>
    <span data-count style="opacity:.55; flex:1"></span>
    <button data-close title="Fermer (B / Select)"
      style="background:none; border:none; color:#fff; font-size:18px; cursor:pointer; opacity:.7">✕</button>
  </div>
  <div data-grid style="flex:1; overflow-y:auto; padding:12px; display:grid; grid-template-columns:1fr 1fr; gap:10px; align-content:start"></div>`;
document.body.appendChild(gallery);
const galleryGrid = gallery.querySelector("[data-grid]");
const galleryCount = gallery.querySelector("[data-count]");
gallery.querySelector("[data-close]").addEventListener("click", () => closeGallery());

// Grand affichage d'une photo : clic ou Échap pour fermer
const lightbox = document.createElement("div");
lightbox.style.cssText =
  "position:fixed; inset:0; background:rgba(0,0,0,0.9); display:none; align-items:center; justify-content:center;" +
  "z-index:40; cursor:zoom-out;";
lightbox.innerHTML = `<img style="max-width:94vw; max-height:90vh; box-shadow:0 8px 40px rgba(0,0,0,.6)">`;
document.body.appendChild(lightbox);
const lightboxImg = lightbox.querySelector("img");
lightbox.addEventListener("click", () => (lightbox.style.display = "none"));
window.addEventListener("keydown", (e) => {
  if (e.code === "Escape") lightbox.style.display = "none";
});

function captureUrl(name) {
  return "/api/captures-file/" + encodeURIComponent(name);
}

async function refreshGallery() {
  try {
    const res = await fetch("/api/captures-list");
    if (!res.ok) throw new Error("réponse " + res.status);
    const files = await res.json();
    galleryCount.textContent = files.length + (files.length > 1 ? " photos" : " photo");
    galleryGrid.innerHTML = "";
    if (files.length === 0) {
      galleryGrid.innerHTML = `<p style="grid-column:1/-1; opacity:.6">Aucune photo pour l'instant. P ou Y / Triangle pour déclencher.</p>`;
      return;
    }
    for (const file of files) {
      const item = document.createElement("figure");
      item.style.cssText = "margin:0; cursor:zoom-in;";
      const date = new Date(file.time).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "medium" });
      item.innerHTML = `
        <img loading="lazy" src="${captureUrl(file.name)}"
             style="width:100%; aspect-ratio:16/10; object-fit:cover; display:block; border-radius:2px; background:#222">
        <figcaption style="margin-top:4px; opacity:.6; font-size:11px">${date}</figcaption>`;
      item.addEventListener("click", () => {
        lightboxImg.src = captureUrl(file.name);
        lightbox.style.display = "flex";
      });
      galleryGrid.appendChild(item);
    }
  } catch (e) {
    galleryCount.textContent = "";
    galleryGrid.innerHTML =
      `<p style="grid-column:1/-1; opacity:.7">Galerie indisponible : vérifier que <code>vite.config.js</code> est à jour, puis redémarrer le serveur (Ctrl + C, puis npm run dev).</p>`;
    console.warn("Galerie :", e);
  }
}

function openGallery() {
  galleryOpen = true;
  gallery.style.transform = "translateX(0)";
  if (document.pointerLockElement) document.exitPointerLock(); // libère la souris pour cliquer dans la galerie
  refreshGallery();
}

function closeGallery() {
  galleryOpen = false;
  gallery.style.transform = "translateX(-100%)";
  lightbox.style.display = "none";
}

function toggleGallery() {
  if (galleryOpen) closeGallery();
  else openGallery();
}

// Déclenchement par la couche de contrôle : un appui = ouvrir ou fermer
function updateGalleryTrigger() {
  const pressed = input.gallery > 0;
  if (pressed && !galleryWasPressed) toggleGallery();
  galleryWasPressed = pressed;
}

// ---------- Changer de scène ----------
function resetCamera() {
  camera.position.set(0, 0, 0); // V2 : un monde Marble est vu depuis l'origine (point de vue du panorama)
  camera.quaternion.set(0, 0, 0, 1);
  effectCenter.copy(camera.position);
  trailPoints.length = 0; // efface le sillage de la scène précédente
}

// Changement de monde : l'ancien disparaît, sa mémoire est libérée, et le nouveau est mis en place pendant le noir.
// Il n'y a donc jamais deux mondes sur la carte graphique, et un à-coup de chargement ne se voit pas.
function loadScene(index) {
  const n = sceneFiles.length;
  if (n === 0) return;
  mondeVise = ((index % n) + n) % n; // boucle : après la dernière, la première
  const charger = () => chargerMonde(mondeVise, 0);
  if (loadingScene) {
    // Nouvelle demande pendant un chargement : on saute au monde voulu, sans attendre le précédent
    if (transition?.phase === "out") {
      transition.charger = charger;
      entrerDansLeNoir();
    } else if (transition?.phase === "noir") {
      charger();
    }
    return;
  }
  loadingScene = true;
  if (transition) finishTransition(); // une apparition encore en cours : on la termine
  startTransition(splat, charger);
}

// Flèches et boutons : on part du monde déjà demandé, pour pouvoir faire défiler plusieurs mondes d'affilée
function changerDeMonde(dir) {
  params.seqActive = true; // changer de monde remet toujours en mode automatique (comme L)
  loadScene((loadingScene ? mondeVise : sceneIndex) + dir);
}

let mondeVise = 0;     // dernier monde demandé
let chargementId = 0;  // seul le chargement le plus récent a le droit d'aboutir

// Un chargement abandonné se termine en arrière-plan, puis il est libéré
function abandonnerMonde(mesh) {
  mesh.userData.photoTex?.dispose?.();
  mesh.dispose?.();
}

async function chargerMonde(index, essais) {
  const id = ++chargementId;
  const nextIndex = (index + sceneFiles.length) % sceneFiles.length; // boucle : après la dernière, la première
  mondeVise = nextIndex;
  const monde = sceneFiles[nextIndex];
  const intermede = annoncerChapitre(monde); // on est dans le noir : le nouveau chapitre apparaît ici, en fondu
  // Densité demandée, ou l'autre si elle manque dans ce dossier
  const densite = monde.fichiers[DENSITE] ? DENSITE : Object.keys(monde.fichiers)[0];
  const name = `${monde.photo} ${monde.version} (${densite})`;
  showToast("Chargement… " + name);

  // Si la séquence l'a déjà préparé pendant l'orbite, on le reprend tel quel
  let next;
  if (precharge && precharge.index === nextIndex) {
    next = precharge.mesh;
  } else {
    precharge?.mesh.dispose?.(); // préparation d'un autre monde : abandonnée
    next = creerMonde(monde);
  }
  precharge = null;
  mondeEnChargement = next;
  try {
    await next.initialized;
  } catch (e) {
    if (id !== chargementId) {
      abandonnerMonde(next);
      return;
    }
    console.warn("Chargement impossible :", name, e);
    showToast("Impossible de charger " + name);
    next.dispose?.();
    // L'ancien monde est déjà parti : on essaie le suivant plutôt que de rester dans le noir
    if (essais + 1 < sceneFiles.length) return chargerMonde(nextIndex + 1, essais + 1);
    transition = null;
    loadingScene = false;
    return;
  }

  if (id !== chargementId) { // entre-temps, un autre monde a été demandé
    abandonnerMonde(next);
    return;
  }
  mondeEnChargement = null;  // chargé : la barre s'efface, même si un chapitre sans image reste à l'écran
  await intermede;           // le monde attend la fin de l'annonce d'un chapitre sans image
  if (id !== chargementId) {
    abandonnerMonde(next);
    return;
  }

  // Échantillon de gaussiennes de la nouvelle scène : sert à mesurer sa hauteur (ici)
  // et ses distances à la caméra (au début de l'apparition), pour l'ordre spatial
  sampleSplats(next);

  sceneIndex = nextIndex;
  params.sceneNom = name;
  switchToIn(next);
  wasIdle = false; // force un premier calcul des forces sur la nouvelle scène
  showToast(`${sceneIndex + 1} / ${sceneFiles.length} — ${name}`);
  loadingScene = false;
  if (params.transitionDuree <= 0) finishTransition(); // durée 0 : changement sec
}

// ---------- Échantillon de gaussiennes (pour l'ordre spatial de la transition) ----------
// Au chargement, on garde les positions d'environ 20 000 gaussiennes. Elles servent à mesurer
// la hauteur de la scène, et, au début de chaque phase, les distances à la caméra.
// On ignore les 2 % les plus extrêmes : quelques gaussiennes isolées très loin (« floaters »)
// fausseraient sinon l'échelle.
function percentileRange(values) {
  values.sort((a, b) => a - b);
  return [values[Math.floor(values.length * 0.02)], values[Math.floor(values.length * 0.98)]];
}

function sampleSplats(mesh) {
  mesh.updateMatrixWorld(true);
  const pts = [];
  const v = new THREE.Vector3();
  try {
    const packed = mesh.packedSplats;
    if (packed?.forEachSplat) {
      const step = Math.max(1, Math.floor((packed.numSplats || 0) / 20000)); // un échantillon suffit
      packed.forEachSplat((index, center) => {
        if (index % step === 0) {
          v.copy(center).applyMatrix4(mesh.matrixWorld);
          pts.push(v.x, v.y, v.z);
        }
      });
    }
  } catch (e) {
    console.warn("Échantillonnage des gaussiennes impossible :", e);
  }
  mesh.userData.sample = pts;
  if (pts.length <= 30) console.warn("Échantillon de gaussiennes vide : distances par défaut (0 à 10)");
}

// Distances des gaussiennes à la caméra, depuis sa position au début d'une phase
function setOrderOrigin(mesh, origin) {
  mesh.userData.origin.value.copy(origin);
  const pts = mesh.userData.sample || [];
  if (pts.length <= 30) return; // valeurs par défaut (0 à 10)
  const ds = [];
  for (let i = 0; i < pts.length; i += 3) {
    const dx = pts[i] - origin.x, dy = pts[i + 1] - origin.y, dz = pts[i + 2] - origin.z;
    ds.push(Math.sqrt(dx * dx + dy * dy + dz * dz));
  }
  const [dMin, dMax] = percentileRange(ds);
  mesh.userData.dMin.value = dMin;
  mesh.userData.dMax.value = dMax;
}

// ---------- Transition entre scènes ----------
// 1. « out » : l'ancienne scène se dissout (ses gaussiennes rapetissent, dans un ordre aléatoire)
// 2. « noir » : plus rien n'est visible ; l'ancienne est retirée de la mémoire et la nouvelle se charge
// 3. « in » : les gaussiennes de la nouvelle scène tombent du ciel, dans un ordre aléatoire
let transition = null; // { phase, from, to, t } pendant une transition, sinon null

// Mouvement de caméra pendant la transition : elle lève les yeux pendant la disparition,
// puis les redescend vers son orientation de départ pendant l'apparition.
const camTilt = { yaw: 0, pitch: 0, startPitch: 0 };
const tiltEuler = new THREE.Euler(0, 0, 0, "YXZ");
const MAX_PITCH = Math.PI / 2 - 0.05;

// Moment de la phase d'entrée (entre 0 et 1) où l'ensemble des particules est arrivé.
// Les dernières arrivées isolées finissent plus tard ; on retient le moment où 97 % sont en place,
// estimé en imitant le calcul du shader (hasard + hauteur) sur 2 000 tirages.
function particlesLandedAt() {
  const o = params.ordreHauteur;
  const w = 1 + (0.08 - 1) * params.transitionEtalement; // même formule que dans le shader
  const n = 2000;
  const hs = [];
  for (let i = 0; i < n; i++) hs.push((1 - o) * Math.random() + o * Math.random());
  hs.sort((a, b) => a - b);
  return Math.min(1, w + (1 - w) * hs[Math.floor(n * 0.97)]);
}

function smooth01(x) {
  return x * x * (3 - 2 * x); // départ et arrivée en douceur
}

function setCameraOrientation(pitch, yaw) {
  tiltEuler.set(THREE.MathUtils.clamp(pitch, -MAX_PITCH, MAX_PITCH), yaw, 0);
  camera.quaternion.setFromEuler(tiltEuler);
}

function startTransition(from, charger) {
  transition = { phase: "out", from, to: null, t: 0, charger };
  // Orientation actuelle : point de départ du mouvement vers le haut
  tiltEuler.setFromQuaternion(camera.quaternion, "YXZ");
  camTilt.yaw = tiltEuler.y;
  camTilt.pitch = tiltEuler.x;
  camTilt.startPitch = tiltEuler.x;
  if (from) setOrderOrigin(from, camera.position); // ordre de départ mesuré depuis la caméra actuelle
  if (from) effacerFiche(); // la fiche du monde reste jusqu'à sa disparition
  if (!from || params.transitionDuree <= 0) entrerDansLeNoir(); // rien à faire disparaître
}

function entrerDansLeNoir() {
  const { from, charger } = transition;
  if (from) {
    scene.remove(from);
    from.dispose?.(); // libère la mémoire de l'ancienne scène
  }
  splat = null;
  seq = null;
  transition.phase = "noir";
  transition.t = 0;
  charger();
}

function switchToIn(to) {
  transition.to = to;
  if (params.sceneResetCamera) {
    resetCamera(); // invisible : plus rien n'est affiché à cet instant
    camTilt.yaw = 0;   // l'orientation de départ devient la cible de l'apparition
    camTilt.pitch = 0;
  }
  // V2 : la nouvelle scène impose le point de vue et la focale de sa photo d'origine
  cadrageActuel = to.userData.cadrage || null;
  photoTexMonde?.dispose?.();                  // photo du monde précédent
  photoTexMonde = to.userData.photoTex || null;
  cadreTrace = params.seqActive ? 0 : 1;       // en séquence, le cadre se trace après la chute
  lancerFiche(to.userData.fiche, to.userData.cadrage?.generation);            // fiche MuIS tapée dans le HUD à l'arrivée du monde
  majCadre();
  if (params.sceneResetCamera && cadrageActuel) {
    const pdv = pointDeVue(cadrageActuel);
    camTilt.yaw = pdv.yaw;
    camTilt.pitch = pdv.pitch;
    setCameraOrientation(pdv.pitch, pdv.yaw); // sans mouvement de caméra (0°), c'est l'orientation finale
    params.focale = focalePourPhoto(cadrageActuel);
  }
  // Séquence : elle repart de zéro pour chaque monde ; le monde arrive déjà avec les splats hors cadre réduits
  seq = null;
  tailleGlobaleActuelle = 1; // le nouveau monde grandit jusqu'à sa taille normale
  if (params.seqActive) effectLevel = 0; // forces à zéro pour l'arrivée, sans fondu
  const avecCadre = cadreVersGPU();
  horsCadreActuel = params.seqActive && avecCadre ? params.horsCadreTaille : 1;
  to.userData.grow.value = 0;
  to.userData.fall.value = 1;
  setOrderOrigin(to, camera.position); // ordre d'arrivée mesuré depuis la caméra (au départ, si réinitialisée)
  scene.add(to);
  to.updateVersion();
  splat = to; // les forces et l'autofocus s'appliquent maintenant à la nouvelle scène
  transition.phase = "in";
  transition.t = 0;
  transition.inEnd = particlesLandedAt(); // la caméra arrive en même temps que les particules
}

// ---------- V2 : point de vue et cadre de la photo d'origine ----------
// Le cadrage (03_OUTILS\prod\cadrage.py) donne le champ de vision horizontal et vertical de la photo
// telle que SplatKit l'a projetée dans le panorama, son inclinaison (pitch) et son lacet (toujours 0 :
// la photo est au centre du panorama). La caméra se place à l'origine, tournée vers la photo, avec
// une focale qui fait tenir toute la photo dans l'écran (plus la marge).
let cadrageActuel = null;

function pointDeVue(c) {
  return {
    yaw: THREE.MathUtils.degToRad((c.yaw_deg || 0) + params.lacetCorrection),
    pitch: THREE.MathUtils.degToRad(c.pitch_deg || 0),
  };
}

// three.js (setFocalLength) : pellicule de 35 mm sur le grand côté de l'écran
function focalePourPhoto(c) {
  const a = camera.aspect;
  const tH = Math.tan(THREE.MathUtils.degToRad(c.h_fov_deg) / 2) * params.cadreMarge;
  const tV = Math.tan(THREE.MathUtils.degToRad(c.v_fov_deg) / 2) * params.cadreMarge;
  const tanDemiV = Math.max(tV, tH / a); // demi-champ vertical de l'écran nécessaire
  return THREE.MathUtils.clamp(17.5 / (Math.max(a, 1) * tanDemiV), 10, 200);
}

// Cadre : rectangle fixe dans l'espace 3D, à « Distance du cadre » devant le point de vue, à la taille
// exacte de la photo à cette distance : vu du point de vue, il épouse les bords de la photo ;
// en avançant, la caméra le traverse. Dessiné par-dessus les splats.
const cadreMat = new LineMaterial({
  color: 0xffffff,
  linewidth: params.cadreEpaisseur, // en pixels d'écran
  transparent: true,
  depthTest: false,
  depthWrite: false,
});
cadreMat.resolution.set(window.innerWidth, window.innerHeight);
const cadre = new Line2(new LineGeometry(), cadreMat);
cadre.renderOrder = 9999;
cadre.frustumCulled = false;
cadre.visible = false;
scene.add(cadre);

function majCadre() {
  const c = cadrageActuel;
  if (!c) {
    cadre.visible = false;
    return;
  }
  const D = params.cadreDistance;
  const x = D * Math.tan(THREE.MathUtils.degToRad(c.h_fov_deg) / 2);
  const y = D * Math.tan(THREE.MathUtils.degToRad(c.v_fov_deg) / 2);
  const pdv = pointDeVue(c);
  const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(pdv.pitch, pdv.yaw, 0, "YXZ"));
  // La photo d'origine occupe exactement le cadre
  photoPlan.scale.set(2 * x, 2 * y, 1);
  photoPlan.position.set(0, 0, -D).applyQuaternion(rot);
  photoPlan.quaternion.copy(rot);
  if (cadreTrace <= 0) return; // rien à dessiner pour l'instant
  // Rectangle fermé, parcouru depuis le coin haut gauche dans le sens des aiguilles d'une montre
  const coins = [[-x, y], [x, y], [x, -y], [-x, -y], [-x, y]].map(([px, py]) => new THREE.Vector3(px, py, -D).applyQuaternion(rot));
  // Seule la part déjà tracée du contour : vitesse constante le long des côtés
  const pts = [coins[0]];
  let reste = cadreTrace * 4 * (x + y); // périmètre
  for (let i = 1; i < coins.length; i++) {
    const cote = i % 2 === 1 ? 2 * x : 2 * y;
    if (reste >= cote) {
      pts.push(coins[i]);
      reste -= cote;
    } else {
      if (reste > 0) pts.push(coins[i - 1].clone().lerp(coins[i], reste / cote));
      break;
    }
  }
  if (pts.length < 2) return;
  cadre.geometry.dispose();
  cadre.geometry = new LineGeometry();
  cadre.geometry.setPositions(pts.flatMap((p) => [p.x, p.y, p.z]));
}

// ---------- V2 : photo d'origine dans le cadre, et flash blanc ----------
const texLoader = new THREE.TextureLoader();
const photoMat = new THREE.MeshBasicMaterial({
  transparent: true,
  depthTest: false,
  depthWrite: false,
  side: THREE.DoubleSide,
  toneMapped: false,
});
let cadreFondu = 1; // 1 = cadre visible ; 0 une fois l'avancée finie (séquence)
let cadreTrace = 1; // part du contour déjà tracée (de 0 à 1)
const photoPlan =new THREE.Mesh(new THREE.PlaneGeometry(1, 1), photoMat);
photoPlan.renderOrder = 9998; // par-dessus les splats, sous le trait du cadre
photoPlan.frustumCulled = false;
photoPlan.visible = false;
scene.add(photoPlan);
let photoOpacite = 0; // piloté par la séquence

const flashDiv = document.createElement("div");
flashDiv.style.cssText = "position:fixed; inset:0; background:#fff; opacity:0; pointer-events:none; z-index:5;";
document.body.appendChild(flashDiv);
let flashBlanc = 0;   // piloté par la séquence

// Barre de chargement, pendant le noir entre deux mondes. Elle suit la réception du fichier ;
// une fois pleine, elle pulse pendant la décompression, dont Spark ne donne pas l'avancement.
const barre = document.createElement("div");
barre.style.cssText = "position:fixed; left:50%; top:calc(50% + 48px); width:240px; height:2px; margin-left:-120px;" +
  "background:rgba(255,255,255,.2); z-index:6; pointer-events:none; display:none;";
const barreRemplie = document.createElement("div");
barreRemplie.style.cssText = "height:100%; width:0; background:#fff;";
barre.appendChild(barreRemplie);
document.body.appendChild(barre);
let mondeEnChargement = null;

function updateBarre() {
  const monde = transition && transition.phase === "noir" ? mondeEnChargement : null;
  barre.style.display = monde ? "block" : "none";
  if (!monde) return;
  const p = monde.userData.chargement?.progres ?? 0;
  barreRemplie.style.width = `${p * 100}%`;
  barreRemplie.style.opacity = p < 1 ? 1 : 0.6 + 0.4 * Math.sin(performance.now() / 150);
}

function chargerPhoto(monde) {
  if (!monde.cadrage?.photo) return null;
  const tex = texLoader.load("/api/mondes-photo/" + encodeURIComponent(monde.photo));
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let photoTexMonde = null;     // photo d'origine du monde affiché

function updatePhoto() {
  if (!seq) {
    if (transition && transition.phase === "in" && params.seqActive) {
      // Chute du nouveau monde : la photo apparaît juste avant que les particules soient en place,
      // et le cadre se trace pendant ce temps ; il se ferme à la fin de la chute
      photoOpacite = fenetre(transition.t, 1 - params.seqPhotoAvance, 1);
      const D = params.transitionDuree, Dc = params.cadreTraceDuree;
      cadreTrace = Dc > 0 ? THREE.MathUtils.clamp((transition.t * D - (D - Dc)) / Dc, 0, 1) : 1;
    } else if (transition || !params.seqActive) {
      photoOpacite = 0; // disparition du monde, ou séquence arrêtée
    } // sinon (entre la fin de la chute et le départ de la séquence) : la photo reste
    flashBlanc = 0;
    if (!params.seqActive || (transition && transition.phase === "in")) cadreFondu = 1;
    if (!params.seqActive) cadreTrace = 1;
  }
  // Monde suivant demandé : le cadre et la photo s'effacent pendant la première moitié de la disparition
  if (transition && transition.phase === "out") cadreFondu = Math.min(cadreFondu, 1 - fenetre(transition.t, 0, 0.5));
  if (transition && transition.phase === "noir") cadreFondu = 0;
  // Une séquence interrompue par un changement de monde ne doit pas laisser le flash allumé
  if (transition || loadingScene) flashBlanc = 0;
  if (photoMat.map !== photoTexMonde) {
    photoMat.map = photoTexMonde;
    photoMat.needsUpdate = true;
  }
  photoMat.opacity = photoOpacite * cadreFondu;
  photoPlan.visible = params.seqPhoto && photoMat.opacity > 0 && !!photoTexMonde;
  flashDiv.style.opacity = Math.max(params.seqPhoto ? flashBlanc : 0, flashLevel); // séquence, ou prise de vue
}

// ---------- V2 : chapitre en haut à droite ----------
// Plusieurs mondes appartiennent au même chapitre (src/chapitres.json). Le texte reste affiché tant que le chapitre
// dure ; quand il change, dans le noir entre deux mondes, l'ancien s'efface et le nouveau apparaît en fondu.
const chapitreDiv = document.createElement("div");
chapitreDiv.style.cssText =
  "position:fixed; top:16px; right:16px; z-index:6; pointer-events:none; white-space:pre; text-align:right; opacity:0;" +
  "font:13px/1.55 ui-monospace, Consolas, 'Courier New', monospace; color:#fff;";
document.body.appendChild(chapitreDiv);
let chapitreAffiche = null; // numéro du chapitre à l'écran
let chapitreJeton = 0;      // annule un fondu en attente si le chapitre change encore

function ecrireChapitre(c) {
  const span = (t, italique) => {
    const el = document.createElement("span");
    el.textContent = t;
    el.style.background = "#000"; // surlignage : chaque lettre et chaque espace sur fond noir
    if (italique) el.style.fontStyle = "italic";
    return el;
  };
  chapitreDiv.replaceChildren(
    span(`Peatükk/`), span(`Chapter`, true), span(` ${c.n} · ${c.dates}\n`),
    span(`${c.et}\n`),
    span(c.en, true),
    ...(c.sansImage ? [span(`\nPilte ei ole/`), span(`No images`, true)] : []),
  );
}

// En avançant, un chapitre sans monde s'annonce seul dans le noir avant le chapitre suivant
let chapitreCourse = 0;
async function annoncerChapitre(monde) {
  const course = ++chapitreCourse;
  const vides = monde.chapitresVides || [];
  if (chapitreAffiche !== null && monde.chapitre && chapitreAffiche < monde.chapitre.n) {
    for (const c of vides) {
      afficherChapitre({ ...c, sansImage: true });
      await new Promise((fin) => setTimeout(fin, params.chapitreVideDuree * 1000));
      if (course !== chapitreCourse) return;
    }
  }
  afficherChapitre(monde.chapitre);
}

function afficherChapitre(c) {
  const n = c?.n ?? null;
  if (n === chapitreAffiche) return; // même chapitre : le texte ne bouge pas
  const visible = chapitreAffiche !== null;
  chapitreAffiche = n;
  const jeton = ++chapitreJeton;
  const apparaitre = () => {
    if (jeton !== chapitreJeton || !c) return;
    ecrireChapitre(c);
    chapitreDiv.style.transition = "none";
    chapitreDiv.style.opacity = 0;
    void chapitreDiv.offsetWidth; // le navigateur doit voir l'opacité 0 avant de lancer le fondu
    chapitreDiv.style.transition = `opacity ${params.chapitreFondu}s ease`;
    chapitreDiv.style.opacity = 1;
  };
  if (visible) {
    chapitreDiv.style.transition = "opacity .4s ease";
    chapitreDiv.style.opacity = 0;
    setTimeout(apparaitre, 400);
  } else {
    apparaitre();
  }
}

// Le panneau de réglages occupe le coin : tant qu'il est là, le chapitre se place à sa gauche
function placerChapitre() {
  chapitreDiv.style.display = params.chapitreVisible ? "block" : "none";
  const panneau = gui.domElement.getBoundingClientRect();
  chapitreDiv.style.right = panneau.width > 0 ? `${window.innerWidth - panneau.left + 16}px` : "16px";
}

// ---------- V2 : fiche MuIS, tapée façon terminal en haut à gauche ----------
// Mêmes éléments que la fiche « At a glance » de MyMuiZ (03_OUTILS\prod\fiche_muis.py), en estonien puis en
// anglais (en italique), sous la forme Maailm/World. Le contenu technique (modèles, outils) n'est pas traduit.
// Elle se tape à l'arrivée du monde et reste jusqu'à sa disparition.
const ficheDiv = document.createElement("div");
ficheDiv.style.cssText =
  "position:fixed; top:16px; left:16px; z-index:6; pointer-events:none; white-space:pre;" +
  "font:13px/1.55 ui-monospace, Consolas, 'Courier New', monospace; color:#fff;";
document.body.appendChild(ficheDiv);
let ficheMorceaux = []; // { t: texte, el: <span> }
let ficheN = 0;         // nombre de caractères déjà tapés
let ficheAffiche = -1;  // dernier nombre de caractères écrit dans la page

const LARGEUR_LIBELLE = "> Treenimine/Training  ".length;
const texteDroit = (t) => ({ t, italique: false });
const texteItalique = (t) => ({ t, italique: true });
const texteVide = (t) => ({ t, vide: true }); // décalage de mise en page : espaces sans surlignage

function ligneFiche(et, en, ...valeur) {
  const debut = en ? `> ${et}/` : `> ${et}`;
  const blanc = " ".repeat(Math.max(1, LARGEUR_LIBELLE - debut.length - (en ? en.length : 0)));
  return [texteDroit(debut), texteItalique(en || ""), texteVide(blanc), ...valeur];
}

function suiteFiche(morceau) {
  return [texteVide(" ".repeat(LARGEUR_LIBELLE)), morceau];
}

const FIABILITE_ET = { sure: "kindel", probable: "tõenäoline", uncertain: "ebakindel" };

const dateAnglais = (d) => d.replace(/umbes /g, "c. ");
const lieuAnglais = (l) => l.replace("Eesti", "Estonia").replace("Tartumaa", "Tartu County").replace(/ loss\b/, " manor house");

// Ce qui a produit le monde (cadrage.generation, écrit par 03_OUTILS/prod/cadrage.py) :
// le panorama vient du workflow ComfyUI de Nico, le monde 3D de Marble
function lignesGeneration(g) {
  if (!g) return [];
  const p = g.panorama || {}, m = g.monde || {};
  const lignes = [];
  if (p.workflow) {
    lignes.push(ligneFiche("Panoraam", "Pano", texteDroit(`ComfyUI · ${p.workflow}${p.version ? ` (${p.version})` : ""}`)));
    for (const mod of p.modeles || []) lignes.push(suiteFiche(texteDroit(mod)));
  }
  if (g.dataset?.workflow) {
    lignes.push(ligneFiche("Andmestik", "Dataset", texteDroit(`${g.dataset.outil} · ${g.dataset.workflow}`)));
    for (const mod of g.dataset.modeles || []) lignes.push(suiteFiche(texteDroit(mod)));
  }
  if (g.entrainement) {
    const e = g.entrainement;
    lignes.push(ligneFiche("Treenimine", "Training", texteDroit(`${e.outil} · ${e.modele} · ${Math.round(e.etapes / 1000)}k steps · ${(e.splats / 1e6).toFixed(2)}M splats`)));
  }
  if (m.outil) lignes.push(ligneFiche("Maailm", "World", texteDroit(`${m.outil}${m.modele ? ` · ${m.modele}` : ""}${m.variante ? ` ${m.variante}` : ""}`)));
  return lignes;
}

function lignesFiche(f) {
  if (!f) return [];
  const lignes = [ligneFiche("Fk ID", "", texteDroit(f.inv))];
  lignes.push(ligneFiche("Nimetus", "Title", texteDroit(f.titre_et)));
  if (f.titre_en) lignes.push(suiteFiche(texteItalique(f.titre_en)));
  if (f.date) {
    const fiabilite = FIABILITE_ET[f.date_conf]
      ? [texteDroit(`  [${FIABILITE_ET[f.date_conf]}/`), texteItalique(f.date_conf), texteDroit("]")]
      : [];
    lignes.push(ligneFiche("Kuupäev", "Date", texteDroit(f.date), ...fiabilite));
    if (dateAnglais(f.date) !== f.date) lignes.push(suiteFiche(texteItalique(dateAnglais(f.date))));
  } else {
    lignes.push(ligneFiche("Kuupäev", "Date", texteDroit("dateerimata/"), texteItalique("undated"),
      texteDroit(`  · CONTRECHAMP: ${f.date_projet || "?"}`)));
  }
  if (f.auteur) lignes.push(ligneFiche("Autor", "Author", texteDroit(f.auteur)));
  if (f.lieu) {
    lignes.push(ligneFiche("Koht", "Place", texteDroit(f.lieu)));
    if (lieuAnglais(f.lieu) !== f.lieu) lignes.push(suiteFiche(texteItalique(lieuAnglais(f.lieu))));
  }
  return lignes;
}

function lancerFiche(f, g) {
  const haut = lignesFiche(f), bas = lignesGeneration(g);
  const lignes = haut.length && bas.length ? [...haut, [], ...bas] : [...haut, ...bas];
  // Une seule suite de morceaux, chacun dans son <span>, avec les retours à la ligne entre les lignes
  const suite = lignes.flatMap((l, i) => (i ? [texteDroit("\n"), ...l] : l)).filter((m) => m.t);
  ficheMorceaux = suite.map((m) => {
    const el = document.createElement("span");
    if (!m.vide) el.style.background = "#000"; // surlignage du texte ; les décalages restent transparents
    if (m.italique) el.style.fontStyle = "italic";
    return { t: m.t, el };
  });
  ficheDiv.replaceChildren(...ficheMorceaux.map((m) => m.el));
  ficheN = 0;
  ficheAffiche = -1;
}

function effacerFiche() {
  ficheMorceaux = [];
  ficheDiv.replaceChildren();
  ficheN = 0;
  ficheAffiche = -1;
}

function updateFiche(dt) {
  ficheDiv.style.display = params.ficheVisible ? "block" : "none";
  placerChapitre();
  ficheN += dt * params.ficheVitesse;
  const n = Math.floor(ficheN);
  if (n === ficheAffiche || !ficheMorceaux.length) return;
  ficheAffiche = n;
  // Tapée caractère par caractère, sans curseur
  let reste = n;
  for (const m of ficheMorceaux) {
    const part = m.t.slice(0, Math.max(0, reste));
    if (m.el.textContent !== part) m.el.textContent = part;
    reste -= m.t.length;
  }
}

let cadreDessine = ""; // réglages utilisés pour le dernier dessin du cadre
function updateCadre() {
  const etat = `${params.lacetCorrection}|${params.cadreDistance}|${cadreTrace}`;
  if (cadreDessine !== etat) {
    cadreDessine = etat;
    majCadre();
  }
  cadre.visible = params.cadreVisible && !!cadrageActuel && cadreFondu > 0 && cadreTrace > 0;
  cadreMat.opacity = params.cadreOpacite * cadreFondu;
  cadreMat.linewidth = params.cadreEpaisseur;
}

function allerAuPointDeVue() {
  if (!cadrageActuel) return;
  resetCamera();
  const pdv = pointDeVue(cadrageActuel);
  setCameraOrientation(pdv.pitch, pdv.yaw);
  params.focale = focalePourPhoto(cadrageActuel);
}

// ---------- V2 : séquence automatique ----------
// Pour chaque monde, une fois arrivé :
//   1. pose      : immobile au point de vue de la photo, forces coupées, splats hors cadre réduits ;
//   2. avancée   : en ligne droite sur l'axe de la photo (à travers le cadre 3D), départ arrêté ; les forces montent, les splats hors cadre reviennent à 100 % ;
//   3. élévation : la caméra continue d'avancer en ralentissant et monte ; elle quitte l'horizontale en douceur
//                  (courbe sans angle), le regard toujours sur la cible (le manoir, au centre de la photo) ;
//   4. pause en haut, puis monde suivant (boucle).
// Toucher le clavier, la souris ou la manette arrête la séquence ; L (ou Start) la relance.
let seq = null;            // séquence en cours : { t, cible, dir, forces }
let horsCadreActuel = 1;   // taille des splats hors cadre envoyée au GPU
let tailleGlobaleActuelle = 1; // taille de tous les splats envoyée au GPU (réduite en fin d'élévation)
let seqWasPressed = 0;
params.seqActive = true;   // une installation démarre toujours en séquence, quel que soit le dernier réglage

const seqPos = new THREE.Vector3();
const seqA = new THREE.Vector3();
const seqC = new THREE.Vector3();
const seqU = new THREE.Vector3();
const seqQ = new THREE.Quaternion();
const seqRegard = new THREE.Vector3(); // point regardé par la caméra pendant la séquence
const AXE_Y = new THREE.Vector3(0, 1, 0);

// Courbe d'Hermite : de p0 à p1, avec les vitesses m0 et m1 (déjà multipliées par la durée) ; t de 0 à 1.
// Sert à raccorder les phases sans à-coup : la vitesse de fin d'une phase est celle du début de la suivante.
// Fondu doux de 0 à 1 entre les instants a et b (0 avant a, 1 après b)
function fenetre(t, a, b) {
  return smooth01(THREE.MathUtils.clamp((t - a) / Math.max(b - a, 0.001), 0, 1));
}

function hermite(p0, p1, m0, m1, t) {
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * p0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * p1 + (t3 - t2) * m1;
}

function cadreVersGPU() {
  if (!cadrageActuel) return false;
  const pdv = pointDeVue(cadrageActuel);
  const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(pdv.pitch, pdv.yaw, 0, "YXZ"));
  u.cadreFwd.value.set(0, 0, -1).applyQuaternion(rot);
  u.cadreRight.value.set(1, 0, 0).applyQuaternion(rot);
  u.cadreUp.value.set(0, 1, 0).applyQuaternion(rot);
  u.cadreTanH.value = Math.tan(THREE.MathUtils.degToRad(cadrageActuel.h_fov_deg) / 2);
  u.cadreTanV.value = Math.tan(THREE.MathUtils.degToRad(cadrageActuel.v_fov_deg) / 2);
  return true;
}

function lancerSequence() {
  if (!splat || !cadrageActuel || transition) return;
  allerAuPointDeVue();
  cadreVersGPU();
  const pdv = pointDeVue(cadrageActuel);
  // Direction de la photo : la caméra avance sur cet axe, et traverse donc le cadre 3D en son centre
  const dirPhoto = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(pdv.pitch, pdv.yaw, 0, "YXZ"));
  const dir = dirPhoto.clone();
  // Cible : premier point du monde touché au centre de la photo, pas plus près que « distance min. »
  let d = cadrageActuel.repere ? 12 : 30; // un splat Postshot est plus petit qu'un monde Marble
  try {
    raycaster.set(new THREE.Vector3(0, 0, 0), dirPhoto);
    const hits = raycaster.intersectObject(splat, false);
    if (hits.length > 0) d = hits[0].distance;
  } catch (e) {
    console.warn("Cible de la séquence : mesure impossible, 30 m par défaut", e);
  }
  // La cible reste toujours devant : au moins 5 m au-delà du point le plus avancé de la séquence
  const avanceeTotale = params.seqAvanceDist + params.seqTourDist; // avancée + avancée pendant le tour
  d = Math.max(d, params.seqCibleMin, avanceeTotale + 5);
  sourisBougee = false;
  seq = {
    t: 0,
    cible: dirPhoto.multiplyScalar(d),
    dir,
    dirH: new THREE.Vector3(-Math.sin(pdv.yaw), 0, -Math.cos(pdv.yaw)), // direction de la photo, à l'horizontale
    forces: 0,
    focale: params.focale, // focale de la photo (allerAuPointDeVue), point de départ du dézoom
    yaw: pdv.yaw,
    pitch: pdv.pitch,
  };
  params.seqActive = true;
  // Rayon de l'orbite prévu : distance horizontale au manoir en fin de tour sur soi, plus le recul
  const rOrbite = (d - avanceeTotale) * Math.cos(pdv.pitch) * (1 + params.seqReculPct / 100);
  showToast(`Séquence — cible à ${d.toFixed(1)} m, orbite à ~${rOrbite.toFixed(1)} m`);
}

function arreterSequence(message) {
  seq = null;
  horsCadreActuel = 1;
  tailleGlobaleActuelle = 1;
  params.seqActive = false;
  if (message) showToast(message);
}

function updateSequence(dt) {
  // L / Start : bascule
  const pressed = input.sequence > 0 ? 1 : 0;
  if (pressed && !seqWasPressed) params.seqActive = !params.seqActive;
  seqWasPressed = pressed;

  // Pendant un chargement ou une transition, la séquence attend ; la taille hors cadre est déjà en place
  if (transition || loadingScene) return;
  if (params.seqActive && !seq) lancerSequence();
  if (!params.seqActive && seq) arreterSequence("Séquence arrêtée — L pour relancer");
  if (!seq) return;

  // Une commande de déplacement ou de regard reprend la main
  const bouge = input.forward || input.right || input.up || input.yaw || input.pitch;
  if (bouge || look.isLocked && sourisBougee) {
    sourisBougee = false;
    arreterSequence("Séquence arrêtée — L pour relancer");
    return;
  }

  seq.t += dt;
  // La séquence est une suite de mouvements qui se chevauchent : chacun est un fondu doux (fenetre)
  // qui commence avant la fin du précédent. Pas d'arrêt entre les mouvements, et la hauteur ne fait que monter.
  //   avancée        à travers le cadre ; forces, tailles et focale changent
  //   tour sur soi   continue d'avancer (à l'horizontale) en tournant vers la droite, et commence à monter
  //   recul          prend de la distance avec le manoir (en % de la distance), en montant toujours
  //   orbite         un grand tour autour du manoir, vers la gauche, en finissant de monter
  //   rapetissement  tous les splats reviennent à la taille de base, puis monde suivant aussitôt
  const t = seq.t;
  const P = params.seqPose, Ta = params.seqAvanceDuree, Tt = params.seqTourDuree;
  const Tr = params.seqReculDuree, To = params.seqOrbiteDuree;
  const tAv1 = P + Ta;                           // fin de l'avancée
  const tTour1 = tAv1 + Tt;                      // fin du tour sur soi
  const tRec0 = tTour1 - 0.15 * Tt;              // le recul commence juste avant la fin du tour
  const tRec1 = tRec0 + Tr;
  const tOrb0 = tRec0 + 0.4 * Tr;                // l'orbite commence pendant le recul
  const tOrb1 = tOrb0 + To;
  const tH2_1 = tRec1 + 0.5 * To;                // la montée se termine pendant l'orbite
  // Rapetissement : même durée et même courbe que le grossissement de l'avancée, pendant la fin de l'orbite
  // (il se termine avec elle) ; l'envol part un peu avant qu'il soit fini (« Envol : anticipation »)
  const tFinTout = Math.max(tOrb1, tH2_1) + params.seqPauseFin;
  const tFin = tFinTout - Ta;
  const tEnvol = tFinTout - params.seqEnvolAnticipation * Ta;

  const k = fenetre(t, P, tAv1);                                      // forces, tailles hors cadre, focale
  const sAxe = params.seqAvanceDist * k;                               // avancée sur l'axe de la photo
  const sHoriz = params.seqTourDist * fenetre(t, P + 0.5 * Ta, tTour1); // continue d'avancer, à l'horizontale
  const tTour0 = tAv1 - 0.25 * Ta;                                     // le tour sur soi commence en fin d'avancée
  const tour = -2 * Math.PI * fenetre(t, tTour0, tTour1);             // tour sur soi, vers la droite
  const kFocale = fenetre(t, P + 0.25 * Ta, tTour0);                  // la focale change pendant l'avancée, avant le tour sur soi
  const kRegard = params.seqRegardCadre * fenetre(t, tOrb0, tOrb0 + 0.5 * To); // pendant l'orbite, le regard glisse vers le cadre 3D
  const h = params.seqTourMontee * fenetre(t, tAv1 + 0.3 * Tt, tTour1)                 // commence à monter pendant le tour
          + (params.seqMonteeHaut * (cadrageActuel?.repere?.echelle_sequence ?? 1) - params.seqTourMontee) * fenetre(t, tRec0, tH2_1); // continue pendant recul et orbite ; montée réduite pour les splats Postshot, plus petits
  const recul = (params.seqReculPct / 100) * fenetre(t, tRec0, tRec1);
  const orbite = -THREE.MathUtils.degToRad(params.seqOrbiteAngle) * fenetre(t, tOrb0, tOrb1); // autour du manoir, vers la gauche
  // Photo d'origine dans le cadre pendant la pose (déjà apparue pendant la fin de la chute du monde ;
  // sinon, apparition en 0,5 s), puis un flash blanc l'efface.
  // À la fin de l'avancée, le cadre, déjà derrière la caméra, disparaît.
  cadreTrace = 1;
  cadreFondu = t < tAv1 ? 1 : 0;
  photoOpacite = t < P ? Math.max(photoOpacite, fenetre(t, 0, 0.5)) : 0;
  flashBlanc = t < P ? fenetre(t, P - 0.12, P) : 1 - fenetre(t, P, P + params.seqFlashDuree);
  const taille = THREE.MathUtils.lerp(1, params.horsCadreTaille, fenetre(t, tFin, tFinTout));
  if (t >= tOrb0 && !precharge) prechargerSuivant(); // le monde suivant se prépare pendant l'orbite

  // Position « de base » (avancées et montée), puis recul et orbite autour de la verticale du manoir (C)
  seqPos.copy(seq.dir).multiplyScalar(sAxe).addScaledVector(seq.dirH, sHoriz);
  const y = seqPos.y + h;
  const C = seqC.set(seq.cible.x, 0, seq.cible.z);
  const v = seqU.set(seqPos.x - C.x, 0, seqPos.z - C.z);
  v.multiplyScalar(1 + recul).applyAxisAngle(AXE_Y, orbite);
  seqPos.copy(C).add(v);
  seqPos.y = y;

  seq.forces = k;
  horsCadreActuel = THREE.MathUtils.lerp(params.horsCadreTaille, 1, k);
  tailleGlobaleActuelle = taille;
  // Focale : celle de la photo au départ, puis, pendant l'avancée (terminé avant le tour sur soi),
  // la focale d'arrivée, commune à tous les mondes (si la photo est déjà plus large, elle ne change pas)
  params.focale = THREE.MathUtils.lerp(seq.focale, Math.min(seq.focale, params.seqFocaleCible), kFocale);

  // Regard : sur le manoir (au départ, c'est la direction de la photo), puis, pendant l'orbite,
  // il glisse vers le centre du cadre 3D, jusqu'à « Orbite : regard vers le cadre » (0,5 = à mi-chemin)
  seqRegard.copy(seq.dir).multiplyScalar(params.cadreDistance).sub(seq.cible).multiplyScalar(kRegard).add(seq.cible);
  camera.position.copy(seqPos);
  camera.lookAt(seqRegard);
  if (tour !== 0) camera.quaternion.premultiply(seqQ.setFromAxisAngle(AXE_Y, tour)); // tour sur soi

  if (t >= tEnvol) {
    seq = null;           // le monde suivant relancera la séquence à son arrivée
    tailleGlobaleActuelle = params.horsCadreTaille; // les derniers % du rapetissement : d'un coup, invisible
    loadScene(sceneIndex + 1); // la disparition (envol) part aussitôt ; le monde suivant se met en place dans le noir
  }
}

// Souris : un mouvement pendant que la souris est capturée reprend la main
let sourisBougee = false;
document.addEventListener("mousemove", (e) => {
  if (look.isLocked && (Math.abs(e.movementX) > 2 || Math.abs(e.movementY) > 2)) sourisBougee = true;
});

function finishTransition() {
  if (params.cameraInclinaison > 0) setCameraOrientation(camTilt.pitch, camTilt.yaw); // fin du mouvement
  const { to } = transition;
  to.userData.grow.value = 1;
  to.userData.fall.value = 0;
  to.updateVersion();
  transition = null;
}

function updateTransition(dt) {
  if (!transition || transition.phase === "noir") return; // le chargement relancera la suite
  // Durée d'image plafonnée : l'à-coup de la première image d'un monde ne doit pas sauter une partie de la chute
  transition.t = Math.min(1, transition.t + Math.min(dt, 0.25) / params.transitionDuree);
  const tilt = THREE.MathUtils.degToRad(params.cameraInclinaison);
  // Sortie : la caméra attend « Retard de la caméra » avant de suivre les particules,
  //          et son mouvement se termine avec la phase.
  // Entrée : pas de retard ; le mouvement se termine quand l'ensemble des particules est arrivé
  //          (inEnd, voir particlesLandedAt).
  const D = params.transitionDuree;
  const isIn = transition.phase === "in";
  const end = isIn ? transition.inEnd : 1;
  const delay = isIn ? 0 : Math.min(params.cameraRetard, D * 0.9);
  const e = smooth01(THREE.MathUtils.clamp((transition.t * D - delay) / Math.max(end * D - delay, 0.001), 0, 1));

  if (transition.phase === "out") {
    transition.from.userData.grow.value = 1 - transition.t; // l'ancienne s'envole
    transition.from.updateVersion();
    // La caméra lève les yeux, en suivant l'envol
    if (tilt > 0) {
      const target = Math.min(camTilt.startPitch + tilt, MAX_PITCH);
      setCameraOrientation(camTilt.startPitch + (target - camTilt.startPitch) * e, camTilt.yaw);
    }
    if (transition.t >= 1) entrerDansLeNoir();
  } else {
    transition.to.userData.grow.value = transition.t;       // la nouvelle tombe du ciel
    transition.to.updateVersion();
    // La caméra redescend du haut vers son orientation de départ, en suivant la chute
    if (tilt > 0) setCameraOrientation(camTilt.pitch + tilt * (1 - e), camTilt.yaw);
    if (transition.t >= 1) finishTransition();
  }
}

async function initScenes() {
  try {
    const res = await fetch("/api/mondes-list");
    if (!res.ok) throw new Error("réponse " + res.status);
    sceneFiles = await res.json();
  } catch (e) {
    console.warn("Liste des scènes indisponible :", e);
    sceneFiles = [];
  }

  if (sceneFiles.length === 0) {
    // Repli : l'ancienne scène unique public/scene.ply
    splat = makeSplat("/scene.ply");
    scene.add(splat);
    params.sceneNom = "scene.ply";
    showToast("Aucun monde Marble trouvé dans 01_PROJETS : chargement de scene.ply");
    return;
  }

  await loadScene(0); // on commence toujours au début du chapitre 1
}

// Déclenchement par la couche de contrôle : un appui = une scène
let sceneWasPressed = 0;
function updateSceneTrigger() {
  const dir = Math.sign(input.scene);
  if (dir !== 0 && sceneWasPressed === 0) changerDeMonde(dir);
  sceneWasPressed = dir;
}

// ---------- Boucle d'animation ----------
const clock = new THREE.Clock();

let derniereImage = 0;
function afficherImage(now) {
  // V2 : limite d'images par seconde (Performance) ; on saute les images en trop
  const fps = Number(params.fpsMax);
  if (fps > 0 && now - derniereImage < 1000 / fps - 2) return; // 2 ms de tolérance sur le rythme de l'écran
  derniereImage = now;
  const dt = clock.getDelta(); // temps écoulé depuis la dernière image rendue

  resetInput();
  readKeyboard();
  readGamepad();
  clampInput();
  applyInput(dt);
  updateSequence(dt); // V2 : après les commandes, pour reprendre la main ou piloter la caméra
  updateEffectLevel(dt);
  updateLens(dt);
  updatePhotoTrigger();
  updateFlash(dt);
  updateEffectCenter(dt);
  updateTrail(clock.elapsedTime);
  updateCadre();
  updatePhoto();
  updateFiche(dt);
  updateBarre();
  updateTransition(dt);
  updateGalleryTrigger();
  updateSceneTrigger();

  updateForces(clock.elapsedTime);

  renderer.render(scene, camera);
  if (photoRequested) {
    photoRequested = false;
    takePhoto();
  }
  stats.update();
}

// Une erreur dans une image arrêterait la boucle pour de bon : on la signale une fois et on continue.
let erreurSignalee = false;
renderer.setAnimationLoop((now) => {
  try {
    afficherImage(now);
  } catch (e) {
    flashDiv.style.opacity = 0;
    if (!erreurSignalee) {
      erreurSignalee = true;
      console.error("Erreur dans la boucle d'affichage :", e);
      showToast("Erreur d'affichage : voir la console");
    }
  }
});

// La carte graphique peut abandonner la page (mémoire saturée, par exemple) : on le dit au lieu d'un écran vide.
renderer.domElement.addEventListener("webglcontextlost", () => {
  console.error("Contexte WebGL perdu à", new Date().toLocaleTimeString());
  showToast("Carte graphique perdue : recharger la page");
});

// ---------- Redimensionnement de la fenêtre ----------
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  cadreMat.resolution.set(window.innerWidth, window.innerHeight); // épaisseur du cadre en pixels
});

// ---------- Démarrage : charger la première scène ----------
initScenes();