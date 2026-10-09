import * as THREE from "three";

export type WeaponId =
  | "pistol"
  | "chaingun"
  | "rocket"
  | "balloon"
  | "squirt"
  | "mines"
  | "sniper"
  | "bfg"
  | "punch";

export type FireMode = "hitscan" | "projectile" | "beam" | "mine" | "punch";

export interface WeaponDef {
  id: WeaponId;
  slot: number;
  name: string;
  short: string;
  icon: string;
  mode: FireMode;
  /** seconds between shots */
  rate: number;
  /** giggle points added on direct hit */
  giggle: number;
  splash?: { radius: number; giggle: number; push: number; selfScale: number };
  speed?: number;
  gravity?: number;
  spread: number;
  ammoPerShot: number;
  maxAmmo: number;
  pickupAmmo: number;
  startAmmo: number;
  color: number;
  ammoName: string;
  blurb: string;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  pistol: {
    id: "pistol",
    slot: 1,
    name: "Blinky Light Pistol",
    short: "BLINKY",
    icon: "🔦",
    mode: "hitscan",
    rate: 0.42,
    giggle: 8,
    spread: 0.012,
    ammoPerShot: 0,
    maxAmmo: Infinity,
    pickupAmmo: 0,
    startAmmo: Infinity,
    color: 0xff4fd8,
    ammoName: "∞",
    blurb: "Emits colored light and silly noises. Everyone gets one!",
  },
  chaingun: {
    id: "chaingun",
    slot: 2,
    name: "Squeaky Chaingun",
    short: "SQUEAK-GUN",
    icon: "🌈",
    mode: "hitscan",
    rate: 0.09,
    giggle: 5,
    spread: 0.045,
    ammoPerShot: 1,
    maxAmmo: 250,
    pickupAmmo: 60,
    startAmmo: 0,
    color: 0x5ad7ff,
    ammoName: "balls",
    blurb: "Colorful barrels, squeaky balls, long sustained raspberry.",
  },
  rocket: {
    id: "rocket",
    slot: 3,
    name: "Mega Foam Dart Launcher",
    short: "FOAM ROCKETS",
    icon: "🚀",
    mode: "projectile",
    rate: 0.82,
    giggle: 48,
    splash: { radius: 5.5, giggle: 42, push: 15, selfScale: 0.45 },
    speed: 42,
    spread: 0,
    ammoPerShot: 1,
    maxAmmo: 60,
    pickupAmmo: 10,
    startAmmo: 0,
    color: 0xff7a3d,
    ammoName: "darts",
    blurb: "Soft rockets that whistle merrily in flight.",
  },
  balloon: {
    id: "balloon",
    slot: 4,
    name: "Water Balloon Cannon",
    short: "SPLASH-NADE",
    icon: "💦",
    mode: "projectile",
    rate: 0.75,
    giggle: 20,
    splash: { radius: 6.2, giggle: 40, push: 18, selfScale: 0.35 },
    speed: 26,
    gravity: 15,
    spread: 0,
    ammoPerShot: 1,
    maxAmmo: 60,
    pickupAmmo: 10,
    startAmmo: 0,
    color: 0x3ad1ff,
    ammoName: "balloons",
    blurb: "Bouncy wobbly balloons. Look down & jump to SPLASH-JUMP!",
  },
  squirt: {
    id: "squirt",
    slot: 5,
    name: "Squirty Stream Gun",
    short: "SQUIRTER",
    icon: "🔫",
    mode: "beam",
    rate: 0.055,
    giggle: 4.5,
    spread: 0,
    ammoPerShot: 1,
    maxAmmo: 250,
    pickupAmmo: 70,
    startAmmo: 0,
    color: 0x7ef6ff,
    ammoName: "water",
    blurb: "A constant stream of giggly water. Zap 'em like lightning.",
  },
  mines: {
    id: "mines",
    slot: 6,
    name: "Whoopie Cushion Mines",
    short: "WHOOPIES",
    icon: "💨",
    mode: "mine",
    rate: 0.95,
    giggle: 0,
    splash: { radius: 5.0, giggle: 52, push: 17, selfScale: 0.5 },
    speed: 20,
    gravity: 22,
    spread: 0,
    ammoPerShot: 1,
    maxAmmo: 30,
    pickupAmmo: 6,
    startAmmo: 0,
    color: 0xff5b8a,
    ammoName: "cushions",
    blurb: "Sticky whoopie cushions. BLAAART when someone tiptoes near.",
  },
  sniper: {
    id: "sniper",
    slot: 7,
    name: "PEEEW! Squeak Sniper",
    short: "PEEEW!",
    icon: "🎯",
    mode: "hitscan",
    rate: 1.35,
    giggle: 70,
    spread: 0,
    ammoPerShot: 1,
    maxAmmo: 30,
    pickupAmmo: 6,
    startAmmo: 0,
    color: 0xb6ff5a,
    ammoName: "big balls",
    blurb: "Long-range squeaky ball. Hold right-click to scope. Says PEEEW! in a baby voice.",
  },
  bfg: {
    id: "bfg",
    slot: 8,
    name: "Mega Fart Dart Blaster",
    short: "MEGA FART",
    icon: "☣️",
    mode: "projectile",
    rate: 0.16,
    giggle: 32,
    splash: { radius: 4.4, giggle: 26, push: 9, selfScale: 0.3 },
    speed: 55,
    spread: 0.02,
    ammoPerShot: 1,
    maxAmmo: 100,
    pickupAmmo: 25,
    startAmmo: 0,
    color: 0x9dff3d,
    ammoName: "mega darts",
    blurb: "Rapid-fire stink darts. The big fuzzy gun.",
  },
  punch: {
    id: "punch",
    slot: 9,
    name: "Punch O' Matic",
    short: "PUNCH-O-MATIC",
    icon: "🥊",
    mode: "punch",
    rate: 2.1,
    giggle: 38,
    spread: 0,
    ammoPerShot: 0,
    maxAmmo: Infinity,
    pickupAmmo: 0,
    startAmmo: Infinity,
    color: 0xff526c,
    ammoName: "wind-up",
    blurb: "Double-length spring-mounted boxing glove! Mega 11m punch that winds back in.",
  },
};

export const WEAPON_ORDER: WeaponId[] = [
  "pistol",
  "chaingun",
  "rocket",
  "balloon",
  "squirt",
  "mines",
  "sniper",
  "bfg",
  "punch",
];

// ------------------------------------------------------------- view models
const toonMat = (c: number, rough = 0.25) =>
  new THREE.MeshPhysicalMaterial({ color: c, roughness: rough, clearcoat: 1, clearcoatRoughness: 0.1 });

function box(w: number, h: number, d: number, c: number, pos: [number, number, number]) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), toonMat(c));
  m.position.set(...pos);
  return m;
}
function cyl(r: number, h: number, c: number, pos: [number, number, number], rotX = Math.PI / 2) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 14), toonMat(c));
  m.position.set(...pos);
  m.rotation.x = rotX;
  return m;
}
function sph(r: number, c: number, pos: [number, number, number]) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), toonMat(c));
  m.position.set(...pos);
  return m;
}

export interface ViewModel {
  group: THREE.Group;
  muzzle: THREE.Object3D;
  spin?: THREE.Object3D;
  light?: THREE.PointLight;
  punchGlove?: THREE.Group;
  punchSpring?: THREE.Group;
}

export function buildViewModel(id: WeaponId): ViewModel {
  const g = new THREE.Group();
  const muzzle = new THREE.Object3D();
  let spin: THREE.Object3D | undefined;
  let punchGlove: THREE.Group | undefined;
  let punchSpring: THREE.Group | undefined;
  const rainbow = [0xff5b6e, 0xffb43d, 0xffe95a, 0x6ee86e, 0x5ad7ff, 0xb46bff];

  switch (id) {
    case "pistol": {
      g.add(box(0.14, 0.12, 0.3, 0xff4fd8, [0, 0, -0.05]));
      g.add(box(0.1, 0.18, 0.1, 0x7a4fff, [0, -0.13, 0.05]));
      const lens = sph(0.07, 0xfff0a0, [0, 0.01, -0.22]);
      g.add(lens);
      g.add(cyl(0.035, 0.1, 0xffe95a, [0, 0.08, -0.02]));
      muzzle.position.set(0, 0.01, -0.28);
      break;
    }
    case "chaingun": {
      const barrels = new THREE.Group();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const b = cyl(0.035, 0.55, rainbow[i], [Math.cos(a) * 0.075, Math.sin(a) * 0.075, -0.28]);
        barrels.add(b);
      }
      barrels.position.set(0, 0, 0);
      g.add(barrels);
      spin = barrels;
      g.add(cyl(0.13, 0.22, 0xffffff, [0, 0, 0.02]));
      g.add(box(0.1, 0.16, 0.16, 0x4a4a6a, [0, -0.14, 0.08]));
      g.add(sph(0.08, 0xff5b6e, [0, 0.12, 0.05]));
      muzzle.position.set(0, 0, -0.56);
      break;
    }
    case "rocket": {
      g.add(cyl(0.11, 0.62, 0xff7a3d, [0, 0, -0.2]));
      g.add(cyl(0.13, 0.08, 0xffe95a, [0, 0, -0.5]));
      g.add(box(0.07, 0.15, 0.12, 0x3a3a55, [0, -0.13, 0.05]));
      g.add(sph(0.06, 0x5ad7ff, [0, 0.12, -0.18]));
      const dart = sph(0.07, 0xffe95a, [0, 0, -0.5]);
      g.add(dart);
      muzzle.position.set(0, 0, -0.56);
      break;
    }
    case "balloon": {
      g.add(cyl(0.16, 0.42, 0x3ad1ff, [0, 0, -0.12]));
      g.add(cyl(0.18, 0.06, 0xffffff, [0, 0, -0.34]));
      g.add(sph(0.13, 0x9be9ff, [0, 0.0, -0.36]));
      g.add(box(0.08, 0.16, 0.12, 0x2a6fa0, [0, -0.15, 0.06]));
      g.add(sph(0.09, 0xff5b6e, [0, 0.14, 0.02]));
      muzzle.position.set(0, 0, -0.44);
      break;
    }
    case "squirt": {
      g.add(box(0.14, 0.16, 0.42, 0x7ef6ff, [0, 0, -0.08]));
      g.add(cyl(0.045, 0.3, 0xffe95a, [0, 0.02, -0.34]));
      const tank = sph(0.14, 0x3a8fff, [0, 0.16, 0.1]);
      g.add(tank);
      g.add(box(0.09, 0.17, 0.12, 0x2a4a8a, [0, -0.15, 0.08]));
      muzzle.position.set(0, 0.02, -0.5);
      break;
    }
    case "mines": {
      g.add(box(0.2, 0.2, 0.36, 0xff5b8a, [0, 0, -0.06]));
      g.add(cyl(0.12, 0.16, 0xd43a6a, [0, 0, -0.28]));
      for (let i = 0; i < 3; i++) g.add(sph(0.07, 0xff9ec4, [0, 0.16, 0.02 - i * 0.12]));
      g.add(box(0.08, 0.16, 0.12, 0x6a2a44, [0, -0.15, 0.06]));
      muzzle.position.set(0, 0, -0.38);
      break;
    }
    case "sniper": {
      g.add(cyl(0.055, 0.95, 0xb6ff5a, [0, 0, -0.35]));
      g.add(box(0.12, 0.14, 0.3, 0x6abf2a, [0, -0.02, 0.0]));
      const scope = cyl(0.05, 0.3, 0x2a2a3a, [0, 0.14, -0.1]);
      g.add(scope);
      g.add(sph(0.04, 0xff4fd8, [0, 0.14, -0.26]));
      g.add(box(0.08, 0.16, 0.12, 0x3a5a2a, [0, -0.16, 0.08]));
      muzzle.position.set(0, 0, -0.85);
      break;
    }
    case "bfg": {
      g.add(sph(0.22, 0x9dff3d, [0, -0.02, 0.0]));
      g.add(cyl(0.14, 0.5, 0x6abf2a, [0, 0, -0.3]));
      g.add(cyl(0.2, 0.09, 0xffe95a, [0, 0, -0.52]));
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.19, 0.04, 8, 20),
        toonMat(0xd0ff8a),
      );
      ring.position.set(0, 0, -0.38);
      g.add(ring);
      spin = ring;
      g.add(box(0.1, 0.18, 0.14, 0x3a5a2a, [0, -0.18, 0.1]));
      muzzle.position.set(0, 0, -0.6);
      break;
    }
    case "punch": {
      // Chunky toy launcher body with a visible spring and a red boxing glove.
      g.add(box(0.22, 0.18, 0.34, 0x56617d, [0, 0, 0.04]));
      g.add(box(0.13, 0.22, 0.14, 0x3b435e, [0, -0.16, 0.12]));
      g.add(box(0.24, 0.08, 0.16, 0xffd34d, [0, 0.11, -0.05]));

      punchSpring = new THREE.Group();
      for (let i = 0; i < 7; i++) {
        const coil = new THREE.Mesh(
          new THREE.TorusGeometry(0.073, 0.018, 7, 12),
          toonMat(i % 2 ? 0xb7c2dc : 0x7f8da9, 0.35),
        );
        coil.position.z = -0.12 - i * 0.09;
        punchSpring.add(coil);
      }
      g.add(punchSpring);

      punchGlove = new THREE.Group();
      punchGlove.position.set(0, 0.02, -0.72);
      punchGlove.add(sph(0.19, 0xff526c, [0, 0, -0.04]));
      punchGlove.add(sph(0.15, 0xf33256, [0, -0.035, -0.18]));
      punchGlove.add(sph(0.075, 0xff7184, [0.14, -0.055, -0.04]));
      punchGlove.add(box(0.23, 0.12, 0.13, 0xffd34d, [0, -0.015, 0.16]));
      punchGlove.add(sph(0.025, 0xfff4d8, [-0.07, 0.095, -0.12]));
      g.add(punchGlove);
      muzzle.position.set(0, 0, -0.98);
      break;
    }
  }
  g.add(muzzle);
  g.traverse((o) => {
    o.renderOrder = 10;
    const m = o as THREE.Mesh;
    if (m.isMesh && m.material) (m.material as THREE.Material).depthTest = true;
  });
  return { group: g, muzzle, spin, punchGlove, punchSpring };
}

/** Small world-space pickup version of a weapon. */
export function buildWeaponPickup(id: WeaponId): THREE.Group {
  const vm = buildViewModel(id);
  const g = new THREE.Group();
  vm.group.scale.setScalar(1.25);
  vm.group.rotation.y = Math.PI / 2;
  g.add(vm.group);
  return g;
}
