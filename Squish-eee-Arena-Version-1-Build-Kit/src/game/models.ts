import * as THREE from "three";

import { furBump } from "./gfx";

export type CharKind = "lion" | "zebra" | "elephant" | "giraffe" | "hippo" | "panda";

export interface CharInfo {
  kind: CharKind;
  name: string;
  blurb: string;
  finish: "shiny plastic" | "fuzzy plush";
  voice: number; // pitch multiplier
  accent: string; // css color for UI
}

export const CHARACTERS: CharInfo[] = [
  {
    kind: "lion",
    name: "Sir Roarsalot",
    blurb: "Shiny plastic baby toy lion. Mane of squishy rubber petals.",
    finish: "shiny plastic",
    voice: 1.0,
    accent: "#ffb43d",
  },
  {
    kind: "zebra",
    name: "Stripey Pants",
    blurb: "Fuzzy plush baby zebra. Stripes knitted by grandma.",
    finish: "fuzzy plush",
    voice: 1.18,
    accent: "#e8e8f2",
  },
  {
    kind: "elephant",
    name: "Toot Toot",
    blurb: "Shiny plastic baby elephant. Trunk doubles as a kazoo.",
    finish: "shiny plastic",
    voice: 0.82,
    accent: "#9fc4ff",
  },
  {
    kind: "giraffe",
    name: "Noodle Neck",
    blurb: "Fuzzy plush baby giraffe. Tallest in the playpen.",
    finish: "fuzzy plush",
    voice: 1.3,
    accent: "#ffd978",
  },
  {
    kind: "hippo",
    name: "Chomps",
    blurb: "Shiny plastic baby hippo. Bath-time champion.",
    finish: "shiny plastic",
    voice: 0.72,
    accent: "#c79bff",
  },
  {
    kind: "panda",
    name: "Bamboozle",
    blurb: "Fuzzy plush baby panda. Rolls instead of walking.",
    finish: "fuzzy plush",
    voice: 1.08,
    accent: "#dfe7ee",
  },
];

// ----------------------------------------------------------------- textures
const texCache = new Map<string, THREE.Texture>();

function canvasTex(key: string, draw: (c: CanvasRenderingContext2D, s: number) => void, size = 256) {
  const hit = texCache.get(key);
  if (hit) return hit;
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const c = cv.getContext("2d")!;
  draw(c, size);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  texCache.set(key, t);
  return t;
}

function fuzzBump(key: string, base: string) {
  return canvasTex(`fuzz-${key}`, (c, s) => {
    c.fillStyle = base;
    c.fillRect(0, 0, s, s);
    for (let i = 0; i < 9000; i++) {
      const x = Math.random() * s;
      const y = Math.random() * s;
      const l = 2 + Math.random() * 4;
      const a = Math.random() * Math.PI * 2;
      c.strokeStyle = `rgba(255,255,255,${Math.random() * 0.35})`;
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      c.stroke();
      c.strokeStyle = `rgba(0,0,0,${Math.random() * 0.22})`;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x - Math.cos(a) * l, y - Math.sin(a) * l);
      c.stroke();
    }
  });
}

function zebraTex() {
  return canvasTex("zebra", (c, s) => {
    c.fillStyle = "#f4f4f8";
    c.fillRect(0, 0, s, s);
    c.fillStyle = "#2b2b38";
    for (let i = 0; i < 16; i++) {
      const x = (i / 16) * s + Math.sin(i) * 5;
      c.save();
      c.translate(x, 0);
      c.rotate((Math.sin(i * 1.7) * 10 * Math.PI) / 180);
      c.beginPath();
      c.moveTo(0, -10);
      c.quadraticCurveTo(6, s / 2, 2, s + 10);
      c.lineTo(10 + Math.sin(i) * 3, s + 10);
      c.quadraticCurveTo(16, s / 2, 9, -10);
      c.closePath();
      c.fill();
      c.restore();
    }
    // fuzz on top
    for (let i = 0; i < 6000; i++) {
      const x = Math.random() * s;
      const y = Math.random() * s;
      c.fillStyle = `rgba(255,255,255,${Math.random() * 0.2})`;
      c.fillRect(x, y, 1.6, 1.6);
    }
  });
}

function giraffeTex() {
  return canvasTex("giraffe", (c, s) => {
    c.fillStyle = "#ffdf9e";
    c.fillRect(0, 0, s, s);
    c.fillStyle = "#cf8b3f";
    for (let i = 0; i < 46; i++) {
      const x = Math.random() * s;
      const y = Math.random() * s;
      const r = 12 + Math.random() * 14;
      c.beginPath();
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        const rr = r * (0.7 + Math.random() * 0.4);
        const px = x + Math.cos(a) * rr;
        const py = y + Math.sin(a) * rr;
        k === 0 ? c.moveTo(px, py) : c.lineTo(px, py);
      }
      c.closePath();
      c.fill();
    }
    for (let i = 0; i < 6000; i++) {
      c.fillStyle = `rgba(255,255,255,${Math.random() * 0.18})`;
      c.fillRect(Math.random() * s, Math.random() * s, 1.6, 1.6);
    }
  });
}

// ---------------------------------------------------------------- materials
function plasticMat(color: THREE.ColorRepresentation) {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.18,
    metalness: 0.0,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    sheen: 0.3,
  });
}

/** Fuzzy plush: a velvety sheen rim plus strand bump so it reads as fabric. */
function plushMat(color: THREE.ColorRepresentation, map?: THREE.Texture) {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.92,
    metalness: 0,
    map: map ?? null,
    sheen: 1,
    sheenRoughness: 0.4,
    sheenColor: new THREE.Color(0xffffff),
    bumpMap: furBump(),
    bumpScale: 1.4,
  });
}

export interface CharParts {
  group: THREE.Group;
  body: THREE.Object3D;
  head: THREE.Object3D;
  legs: THREE.Object3D[];
  tail?: THREE.Object3D;
  extras: THREE.Object3D[];
  teamBand: THREE.Mesh[];
}

const SPH = new THREE.SphereGeometry(1, 18, 14);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 14);
const CONE = new THREE.ConeGeometry(1, 1, 14);


function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, pos: number[], scale: number[]) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(pos[0], pos[1], pos[2]);
  m.scale.set(scale[0], scale[1], scale[2]);
  m.castShadow = true;
  return m;
}

function eyes(parent: THREE.Object3D, z: number, y: number, x: number, r: number) {
  const white = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.1, clearcoat: 1 });
  const black = new THREE.MeshPhysicalMaterial({ color: 0x1a1526, roughness: 0.05, clearcoat: 1 });
  for (const sx of [-1, 1]) {
    const e = mesh(SPH, white, [sx * x, y, z], [r, r * 1.15, r]);
    parent.add(e);
    const p = mesh(SPH, black, [sx * x * 0.98, y, z + r * 0.6], [r * 0.5, r * 0.55, r * 0.5]);
    parent.add(p);
    const gl = mesh(SPH, new THREE.MeshBasicMaterial({ color: 0xffffff }), [
      sx * x * 0.98 + r * 0.18,
      y + r * 0.25,
      z + r * 0.85,
    ], [r * 0.16, r * 0.16, r * 0.16]);
    parent.add(gl);
  }

  // rosy cheeks and a little smile, shared by every toy face
  const blush = new THREE.MeshStandardMaterial({ color: 0xff7fa6, roughness: 0.9 });
  const smileMat = new THREE.MeshStandardMaterial({ color: 0x3a2233, roughness: 0.6 });
  for (const sx of [-1, 1]) {
    parent.add(mesh(SPH, blush, [sx * x * 1.7, y - r * 1.9, z - r * 0.15], [r * 0.85, r * 0.55, r * 0.3]));
  }
  const smile = new THREE.Mesh(
    new THREE.TorusGeometry(Math.max(r * 1.1, x * 0.42), r * 0.22, 8, 18, Math.PI),
    smileMat,
  );
  smile.rotation.z = Math.PI;
  smile.position.set(0, y - r * 1.6, z - r * 0.05);
  parent.add(smile);
}

/** Builds a chunky baby-toy animal roughly 1.65 units tall, feet at y=0. */
export function buildCharacter(kind: CharKind, teamColor: number): CharParts {
  const group = new THREE.Group();
  // Keep actor-level transforms (death shrink, yaw, position) separate from model size.
  const visual = new THREE.Group();
  group.add(visual);
  const modelScale = 2;
  const legs: THREE.Object3D[] = [];
  const extras: THREE.Object3D[] = [];
  const teamBand: THREE.Mesh[] = [];
  const bodyPivot = new THREE.Group();
  visual.add(bodyPivot);
  const headPivot = new THREE.Group();

  const bandMat = new THREE.MeshPhysicalMaterial({
    color: teamColor,
    roughness: 0.25,
    clearcoat: 1,
    emissive: new THREE.Color(teamColor).multiplyScalar(0.25),
  });

  const addLegs = (mat: THREE.Material, ly: number, lr: number, dx: number, dz: number) => {
    for (const [sx, sz] of [
      [-1, 1],
      [1, 1],
      [-1, -1],
      [1, -1],
    ]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * dx, ly, sz * dz);
      const leg = mesh(CYL, mat, [0, -ly / 2, 0], [lr, ly, lr]);
      pivot.add(leg);
      const foot = mesh(SPH, mat, [0, -ly, 0], [lr * 1.25, lr * 0.95, lr * 1.45]);
      pivot.add(foot);
      bodyPivot.add(pivot);
      legs.push(pivot);
    }
  };

  switch (kind) {
    case "lion": {
      const main = plasticMat(0xffb43d);
      const cream = plasticMat(0xffe6b8);
      bodyPivot.position.y = 0.78;
      const body = mesh(SPH, main, [0, 0, 0], [0.46, 0.4, 0.54]);
      bodyPivot.add(body);
      const belly = mesh(SPH, cream, [0, -0.12, 0.12], [0.36, 0.3, 0.42]);
      bodyPivot.add(belly);
      addLegs(main, -0.18, 0.14, 0.26, 0.3);
      headPivot.position.set(0, 0.34, 0.34);
      bodyPivot.add(headPivot);
      const head = mesh(SPH, main, [0, 0, 0], [0.34, 0.32, 0.32]);
      headPivot.add(head);
      // squishy mane petals
      const maneMat = plasticMat(0xd9622a);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const p = mesh(
          SPH,
          maneMat,
          [Math.cos(a) * 0.36, Math.sin(a) * 0.36, -0.05],
          [0.15, 0.15, 0.12],
        );
        headPivot.add(p);
        extras.push(p);
      }
      const muzzle = mesh(SPH, cream, [0, -0.08, 0.28], [0.19, 0.14, 0.14]);
      headPivot.add(muzzle);
      const nose = mesh(SPH, plasticMat(0x5b3a2e), [0, -0.03, 0.39], [0.06, 0.05, 0.05]);
      headPivot.add(nose);
      for (const sx of [-1, 1]) {
        const ear = mesh(SPH, cream, [sx * 0.22, 0.26, 0.02], [0.1, 0.11, 0.05]);
        headPivot.add(ear);
      }
      eyes(headPivot, 0.26, 0.09, 0.13, 0.08);
      const tail = new THREE.Group();
      tail.position.set(0, 0.1, -0.5);
      const tseg = mesh(CYL, main, [0, 0.08, -0.06], [0.04, 0.3, 0.04]);
      tseg.rotation.x = 0.5;
      tail.add(tseg);
      const tuft = mesh(SPH, maneMat, [0, 0.2, -0.18], [0.1, 0.12, 0.1]);
      tail.add(tuft);
      bodyPivot.add(tail);
      const band = mesh(CYL, bandMat, [0, 0.04, 0], [0.49, 0.12, 0.57]);
      bodyPivot.add(band);
      teamBand.push(band as THREE.Mesh);
      break;
    }
    case "zebra": {
      const tex = zebraTex();
      tex.repeat.set(2, 1);
      const main = plushMat(0xffffff, tex);
      const dark = plushMat(0x2b2b38);
      bodyPivot.position.y = 0.8;
      const body = mesh(SPH, main, [0, 0, 0], [0.42, 0.4, 0.56]);
      bodyPivot.add(body);
      addLegs(main, -0.2, 0.13, 0.25, 0.32);
      headPivot.position.set(0, 0.36, 0.3);
      bodyPivot.add(headPivot);
      const head = mesh(SPH, main, [0, 0, 0], [0.26, 0.28, 0.3]);
      headPivot.add(head);
      const snout = mesh(SPH, main, [0, -0.1, 0.24], [0.16, 0.14, 0.2]);
      headPivot.add(snout);
      const nose = mesh(SPH, dark, [0, -0.12, 0.42], [0.12, 0.09, 0.06]);
      headPivot.add(nose);
      for (const sx of [-1, 1]) {
        const ear = mesh(CONE, main, [sx * 0.16, 0.3, 0], [0.07, 0.17, 0.07]);
        headPivot.add(ear);
      }
      // mohawk mane
      for (let i = 0; i < 7; i++) {
        const m = mesh(SPH, dark, [0, 0.3 - i * 0.02, 0.06 - i * 0.09], [0.05, 0.11, 0.06]);
        headPivot.add(m);
      }
      eyes(headPivot, 0.21, 0.08, 0.16, 0.075);
      const tail = new THREE.Group();
      tail.position.set(0, 0.12, -0.52);
      const t1 = mesh(CYL, main, [0, -0.1, 0], [0.03, 0.26, 0.03]);
      tail.add(t1);
      tail.add(mesh(SPH, dark, [0, -0.26, 0], [0.06, 0.1, 0.06]));
      bodyPivot.add(tail);
      const band = mesh(CYL, bandMat, [0, 0.06, 0], [0.45, 0.11, 0.59]);
      bodyPivot.add(band);
      teamBand.push(band as THREE.Mesh);
      break;
    }
    case "elephant": {
      const main = plasticMat(0x9fc4ff);
      const pink = plasticMat(0xffc2d6);
      bodyPivot.position.y = 0.76;
      const body = mesh(SPH, main, [0, 0, 0], [0.5, 0.44, 0.56]);
      bodyPivot.add(body);
      addLegs(main, -0.2, 0.17, 0.28, 0.28);
      headPivot.position.set(0, 0.34, 0.3);
      bodyPivot.add(headPivot);
      const head = mesh(SPH, main, [0, 0, 0], [0.33, 0.31, 0.29]);
      headPivot.add(head);
      for (const sx of [-1, 1]) {
        const ear = mesh(SPH, main, [sx * 0.33, 0.04, -0.03], [0.07, 0.24, 0.22]);
        ear.rotation.z = sx * 0.25;
        headPivot.add(ear);
        const inner = mesh(SPH, pink, [sx * 0.37, 0.04, -0.01], [0.04, 0.17, 0.16]);
        headPivot.add(inner);
      }
      // trunk (segmented, droops)
      const trunk = new THREE.Group();
      trunk.position.set(0, -0.08, 0.24);
      let ty = 0;
      let tz = 0;
      for (let i = 0; i < 5; i++) {
        const s = 0.11 - i * 0.012;
        const seg = mesh(SPH, main, [0, ty, tz], [s, s * 1.05, s]);
        trunk.add(seg);
        ty -= 0.09;
        tz += i < 2 ? 0.06 : -0.01;
      }
      headPivot.add(trunk);
      extras.push(trunk);
      for (const sx of [-1, 1]) {
        const tusk = mesh(CONE, plasticMat(0xfff8e8), [sx * 0.13, -0.14, 0.2], [0.035, 0.14, 0.035]);
        tusk.rotation.x = Math.PI * 0.85;
        headPivot.add(tusk);
      }
      eyes(headPivot, 0.25, 0.1, 0.17, 0.07);
      const band = mesh(CYL, bandMat, [0, 0.08, 0], [0.53, 0.12, 0.59]);
      bodyPivot.add(band);
      teamBand.push(band as THREE.Mesh);
      const tail = mesh(CYL, main, [0, 0.0, -0.54], [0.03, 0.22, 0.03]);
      bodyPivot.add(tail);
      break;
    }
    case "giraffe": {
      const tex = giraffeTex();
      const main = plushMat(0xffffff, tex);
      const dark = plushMat(0x8a5a2b);
      bodyPivot.position.y = 0.66;
      const body = mesh(SPH, main, [0, 0, 0], [0.34, 0.33, 0.48]);
      bodyPivot.add(body);
      addLegs(main, -0.3, 0.1, 0.2, 0.28);
      // long neck
      const neck = new THREE.Group();
      neck.position.set(0, 0.2, 0.28);
      for (let i = 0; i < 5; i++) {
        const s = 0.14 - i * 0.008;
        neck.add(mesh(SPH, main, [0, i * 0.15, i * 0.035], [s, s * 1.2, s]));
      }
      bodyPivot.add(neck);
      extras.push(neck);
      headPivot.position.set(0, 0.95, 0.46);
      bodyPivot.add(headPivot);
      const head = mesh(SPH, main, [0, 0, 0], [0.16, 0.17, 0.2]);
      headPivot.add(head);
      const snout = mesh(SPH, main, [0, -0.05, 0.16], [0.11, 0.1, 0.13]);
      headPivot.add(snout);
      for (const sx of [-1, 1]) {
        const ear = mesh(SPH, main, [sx * 0.17, 0.09, -0.02], [0.09, 0.04, 0.05]);
        headPivot.add(ear);
        const horn = mesh(CYL, main, [sx * 0.07, 0.2, -0.01], [0.022, 0.13, 0.022]);
        headPivot.add(horn);
        headPivot.add(mesh(SPH, dark, [sx * 0.07, 0.27, -0.01], [0.04, 0.04, 0.04]));
      }
      eyes(headPivot, 0.12, 0.06, 0.12, 0.055);
      const tail = mesh(CYL, main, [0, 0.05, -0.46], [0.022, 0.26, 0.022]);
      tail.rotation.x = 0.4;
      bodyPivot.add(tail);
      const band = mesh(CYL, bandMat, [0, 0.06, 0], [0.37, 0.1, 0.51]);
      bodyPivot.add(band);
      teamBand.push(band as THREE.Mesh);
      break;
    }
    case "hippo": {
      const main = plasticMat(0xc79bff);
      const pink = plasticMat(0xffd1e6);
      bodyPivot.position.y = 0.62;
      bodyPivot.add(mesh(SPH, main, [0, 0, 0], [0.5, 0.38, 0.58]));
      addLegs(main, -0.16, 0.16, 0.3, 0.3);
      headPivot.position.set(0, 0.24, 0.42);
      bodyPivot.add(headPivot);
      headPivot.add(mesh(SPH, main, [0, 0, 0], [0.33, 0.26, 0.3]));
      headPivot.add(mesh(SPH, main, [0, -0.08, 0.2], [0.3, 0.17, 0.22]));
      headPivot.add(mesh(SPH, pink, [0, -0.13, 0.33], [0.2, 0.08, 0.1]));
      for (const sx of [-1, 1]) {
        headPivot.add(mesh(SPH, main, [sx * 0.22, 0.22, -0.06], [0.07, 0.07, 0.06]));
        headPivot.add(mesh(SPH, pink, [sx * 0.1, -0.16, 0.36], [0.04, 0.05, 0.04]));
      }
      eyes(headPivot, 0.18, 0.2, 0.15, 0.08);
      const band = mesh(CYL, bandMat, [0, 0.06, 0], [0.53, 0.12, 0.61]);
      bodyPivot.add(band);
      teamBand.push(band as THREE.Mesh);
      break;
    }
    case "panda": {
      const fz = fuzzBump("panda", "#f2f2f2");
      const main = plushMat(0xffffff, fz);
      const black = plushMat(0x2a2a33, fuzzBump("pandablk", "#333"));
      bodyPivot.position.y = 0.72;
      bodyPivot.add(mesh(SPH, main, [0, 0, 0], [0.44, 0.44, 0.44]));
      addLegs(black, -0.22, 0.15, 0.24, 0.22);
      headPivot.position.set(0, 0.46, 0.08);
      bodyPivot.add(headPivot);
      headPivot.add(mesh(SPH, main, [0, 0, 0], [0.33, 0.31, 0.3]));
      for (const sx of [-1, 1]) {
        headPivot.add(mesh(SPH, black, [sx * 0.24, 0.24, -0.04], [0.1, 0.1, 0.07]));
        headPivot.add(mesh(SPH, black, [sx * 0.14, 0.04, 0.24], [0.1, 0.11, 0.06]));
      }
      headPivot.add(mesh(SPH, main, [0, -0.1, 0.27], [0.14, 0.11, 0.1]));
      headPivot.add(mesh(SPH, black, [0, -0.04, 0.33], [0.055, 0.04, 0.04]));
      eyes(headPivot, 0.28, 0.05, 0.14, 0.06);
      const band = mesh(CYL, bandMat, [0, 0.02, 0], [0.47, 0.12, 0.47]);
      bodyPivot.add(band);
      teamBand.push(band as THREE.Mesh);
      break;
    }
  }

  // squishy shadow blob
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(0.5, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }),
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.02;
  blob.scale.setScalar(modelScale);
  group.add(blob);

  // Scale from the feet so all six toys stay planted on the floor.
  visual.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(visual);
  visual.scale.setScalar(modelScale);
  visual.position.y = -bounds.min.y * modelScale;

  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = false;
    }
  });

  return { group, body: bodyPivot, head: headPivot, legs, extras, teamBand };
}

/** Animate the squishy toy. */
export function animateChar(
  p: CharParts,
  t: number,
  speed: number,
  grounded: boolean,
  giggleOut: boolean,
) {
  const walk = Math.min(1, speed / 6);
  const f = t * (6 + walk * 8);
  p.legs.forEach((leg, i) => {
    const ph = f + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI / 2 : 0);
    leg.rotation.x = Math.sin(ph) * 0.75 * walk;
    if (!grounded) leg.rotation.x = -0.5 + Math.sin(t * 8 + i) * 0.2;
  });
  const squish = 1 + Math.sin(f * 2) * 0.05 * walk;
  p.body.scale.set(1 / squish ** 0.5, squish, 1 / squish ** 0.5);
  p.head.rotation.z = Math.sin(f * 0.5) * 0.08 * walk;
  if (giggleOut) {
    p.body.scale.set(1.15, 0.85 + Math.sin(t * 28) * 0.18, 1.15);
    p.head.rotation.x = Math.sin(t * 24) * 0.3;
    p.legs.forEach((leg, i) => {
      leg.rotation.x = Math.sin(t * 22 + i) * 1.2;
    });
  }
}
