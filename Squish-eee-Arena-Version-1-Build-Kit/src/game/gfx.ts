import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { Sky } from "three/examples/jsm/objects/Sky.js";

/**
 * Visual helpers for SQUISH-EEE ARENA: procedural surface textures, a real sky,
 * image-based studio lighting, and soft sprites for puffs and glows.
 * Everything is generated in code — no image assets to download.
 */

export type SurfaceKind =
  | "sand"
  | "grass"
  | "rock"
  | "wood"
  | "wallpaper"
  | "fabric"
  | "plaster"
  | "tile";

/** world units covered by one texture repeat */
const TILE = 5;

function makeCanvas(size: number) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  return { cv, c: cv.getContext("2d")! };
}

/** tiny deterministic random so textures look the same every load */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Surface textures are painted mostly in greys so the material colour can tint them.
const painters: Record<SurfaceKind, (c: CanvasRenderingContext2D, s: number) => void> = {
  sand: (c, s) => {
    const r = rng(7);
    c.fillStyle = "#ececec";
    c.fillRect(0, 0, s, s);
    for (let i = 0; i < 2600; i++) {
      const v = r() < 0.5 ? 0 : 255;
      c.fillStyle = `rgba(${v},${v},${v},${0.05 + r() * 0.12})`;
      c.fillRect(r() * s, r() * s, 1 + r() * 2, 1 + r() * 2);
    }
  },
  grass: (c, s) => {
    const r = rng(11);
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, s, s);
    for (let i = 0; i < 1400; i++) {
      c.strokeStyle = `rgba(80,80,80,${0.12 + r() * 0.2})`;
      c.lineWidth = 1 + r() * 1.2;
      const x = r() * s;
      const y = r() * s;
      const a = -Math.PI / 2 + (r() - 0.5) * 0.9;
      const l = 4 + r() * 9;
      c.beginPath();
      c.moveTo(x, y);
      c.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + 2, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
      c.stroke();
    }
  },
  rock: (c, s) => {
    const r = rng(23);
    c.fillStyle = "#d8d8d8";
    c.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 6 + r() * 10) {
      const v = 150 + Math.floor(r() * 90);
      c.fillStyle = `rgba(${v},${v},${v},0.35)`;
      c.fillRect(0, y, s, 3 + r() * 6);
    }
    for (let i = 0; i < 1800; i++) {
      const v = r() < 0.5 ? 30 : 255;
      c.fillStyle = `rgba(${v},${v},${v},${0.04 + r() * 0.08})`;
      c.fillRect(r() * s, r() * s, 1 + r() * 3, 1 + r() * 3);
    }
  },
  wood: (c, s) => {
    const r = rng(31);
    c.fillStyle = "#e4e4e4";
    c.fillRect(0, 0, s, s);
    const plank = s / 4;
    for (let x = 0; x < s; x += plank) {
      const v = 200 + r() * 45;
      c.fillStyle = `rgb(${v},${v},${v})`;
      c.fillRect(x, 0, plank, s);
      c.strokeStyle = "rgba(90,70,50,0.25)";
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, s);
      c.stroke();
      for (let g = 0; g < 9; g++) {
        c.strokeStyle = `rgba(110,80,50,${0.12 + r() * 0.12})`;
        c.beginPath();
        const gx = x + r() * plank;
        c.moveTo(gx, 0);
        for (let y = 0; y <= s; y += 16) c.lineTo(gx + Math.sin(y * 0.05 + g) * 3, y);
        c.stroke();
      }
    }
  },
  wallpaper: (c, s) => {
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, s, s);
    c.fillStyle = "rgba(0,0,0,0.07)";
    c.fillRect(0, 0, s / 2, s);
    c.fillStyle = "rgba(255,255,255,0.9)";
    for (let y = 0; y < s; y += 64) {
      for (let x = 0; x < s; x += 64) {
        c.beginPath();
        c.arc(x + (y % 128 ? 32 : 0), y, 7, 0, Math.PI * 2);
        c.fill();
      }
    }
  },
  fabric: (c, s) => {
    c.fillStyle = "#f2f2f2";
    c.fillRect(0, 0, s, s);
    for (let i = 0; i < s; i += 4) {
      c.fillStyle = `rgba(0,0,0,${i % 8 ? 0.03 : 0.07})`;
      c.fillRect(i, 0, 2, s);
      c.fillRect(0, i, s, 2);
    }
  },
  plaster: (c, s) => {
    const r = rng(41);
    c.fillStyle = "#f8f8f8";
    c.fillRect(0, 0, s, s);
    for (let i = 0; i < 1200; i++) {
      const v = r() < 0.5 ? 0 : 255;
      c.fillStyle = `rgba(${v},${v},${v},${0.03 + r() * 0.05})`;
      c.fillRect(r() * s, r() * s, 2 + r() * 4, 2 + r() * 4);
    }
  },
  tile: (c, s) => {
    const n = 4;
    const cell = s / n;
    c.fillStyle = "#dfe6ea"; // grout
    c.fillRect(0, 0, s, s);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const alt = (x + y) % 2 === 0;
        const base = alt ? 236 : 214;
        c.fillStyle = `rgb(${base},${base + 8},${base + 14})`;
        c.fillRect(x * cell + 2, y * cell + 2, cell - 4, cell - 4);
        // faint water shimmer streaks
        c.fillStyle = "rgba(255,255,255,0.22)";
        c.fillRect(x * cell + 4, y * cell + 5 + ((x * 7) % 9), cell - 8, 2);
      }
    }
  },
};

const baseTextures = new Map<SurfaceKind, THREE.CanvasTexture>();
function baseTex(kind: SurfaceKind) {
  let t = baseTextures.get(kind);
  if (!t) {
    const { cv, c } = makeCanvas(256);
    painters[kind](c, cv.width);
    t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    baseTextures.set(kind, t);
  }
  return t;
}

const tiled = new Map<string, THREE.Texture>();
/** a surface texture repeated rx × ry times (cached) */
export function tiledTex(kind: SurfaceKind, rx: number, ry: number): THREE.Texture {
  const key = `${kind}|${rx}|${ry}`;
  let t = tiled.get(key);
  if (!t) {
    t = baseTex(kind).clone();
    t.repeat.set(rx, ry);
    t.needsUpdate = true;
    tiled.set(key, t);
  }
  return t;
}

/**
 * A lit, matte-ish surface that will be re-tiled to real-world scale once the
 * geometry exists (see retileSurfaces). Plain BoxGeometry UVs would stretch.
 */
export function surfaceMat(kind: SurfaceKind, color: number, roughness = 0.9) {
  const m = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, map: baseTex(kind) });
  m.userData.surface = kind;
  return m;
}

const resolved = new Map<string, THREE.Material>();
function resolveSurface(mat: THREE.Material, w: number, h: number, d: number): THREE.Material {
  const kind = mat.userData?.surface as SurfaceKind | undefined;
  if (!kind) return mat;
  const std = mat as THREE.MeshStandardMaterial;
  const rx = Math.max(0.25, Math.round((Math.max(w, d) / TILE) * 4) / 4);
  const ry = Math.max(0.25, Math.round((h / TILE) * 4) / 4);
  const key = `${std.uuid}|${rx}|${ry}`;
  let m = resolved.get(key);
  if (!m) {
    const copy = std.clone() as THREE.MeshStandardMaterial;
    copy.map = tiledTex(kind, rx, ry);
    copy.userData.surface = kind;
    m = copy;
    resolved.set(key, m);
  }
  return m;
}

// Map builders create many cubes of exactly the same dimensions. Share the
// immutable GPU geometry instead of uploading one buffer set per arena block.
const boxGeometryCache = new Map<string, THREE.BoxGeometry>();

/** Tiles materials, de-duplicates static box buffers, and freezes map transforms. */
export function retileSurfaces(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      if (m.geometry instanceof THREE.BoxGeometry && !Array.isArray(m.material)) {
        const p = m.geometry.parameters as { width: number; height: number; depth: number };
        m.material = resolveSurface(m.material, p.width, p.height, p.depth);

        const key = `${p.width.toFixed(3)}:${p.height.toFixed(3)}:${p.depth.toFixed(3)}`;
        const shared = boxGeometryCache.get(key);
        if (shared && shared !== m.geometry) {
          m.geometry.dispose();
          m.geometry = shared;
        } else if (!shared) {
          boxGeometryCache.set(key, m.geometry);
        }
      }
    }

    // Everything under an Arena group is static; player/items are constructed
    // separately and remain animated. Freeze local matrices to skip frame work.
    o.updateMatrix();
    o.matrixAutoUpdate = false;
  });
}

// ------------------------------------------------------------ fur (plush bump)
let fur: THREE.CanvasTexture | null = null;
/** grey-scale strand noise used as a bump map on the fuzzy plush toys */
export function furBump(): THREE.CanvasTexture {
  if (!fur) {
    const { cv, c } = makeCanvas(256);
    const r = rng(53);
    c.fillStyle = "#808080";
    c.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 7000; i++) {
      const v = Math.floor(60 + r() * 180);
      c.strokeStyle = `rgba(${v},${v},${v},0.6)`;
      c.lineWidth = 1;
      const x = r() * 256;
      const y = r() * 256;
      const a = r() * Math.PI * 2;
      const l = 2 + r() * 4;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      c.stroke();
    }
    fur = new THREE.CanvasTexture(cv);
    fur.wrapS = fur.wrapT = THREE.RepeatWrapping;
    fur.repeat.set(3, 3);
  }
  return fur;
}

// ------------------------------------------------------------- soft sprites
let soft: THREE.CanvasTexture | null = null;
function softTex() {
  if (!soft) {
    const { cv, c } = makeCanvas(128);
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.35, "rgba(255,255,255,0.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
    soft = new THREE.CanvasTexture(cv);
  }
  return soft;
}

/** A soft, fading puff of colour (used for splashes, bursts and dust). */
export function makePuff(color: number, size: number, opacity = 0.85): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({
    map: softTex(),
    color,
    transparent: true,
    opacity,
    depthWrite: false,
  });
  const s = new THREE.Sprite(mat);
  s.scale.setScalar(size * 2.4);
  // remember the full size so the effect loop can shrink it smoothly
  s.userData.base = size * 2.4;
  return s;
}

/** An additive halo of light (pickup glows, muzzle flashes). */
export function makeGlow(color: number, size: number, opacity = 0.55): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({
    map: softTex(),
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const s = new THREE.Sprite(mat);
  s.scale.setScalar(size);
  return s;
}

// --------------------------------------------------------- sky & lighting
/** A Preetham-model sky dome, pastel-hazed. Follow the camera every frame. */
export function createSky(): Sky {
  const sky = new Sky();
  sky.scale.setScalar(900);
  const u = (sky.material as THREE.ShaderMaterial).uniforms;
  u["turbidity"].value = 3.5;
  u["rayleigh"].value = 1.4;
  u["mieCoefficient"].value = 0.004;
  u["mieDirectionalG"].value = 0.82;
  u["sunPosition"].value.set(0.45, 0.7, 0.35).normalize();
  return sky;
}

/**
 * Image-based lighting: gives glossy toy plastic real reflections of a soft
 * studio room. This is the single biggest step up in material quality.
 */
export function applyStudioEnvironment(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  intensity = 0.75,
): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = texture;
  scene.environmentIntensity = intensity;
  pmrem.dispose();
  return texture;
}
