import * as THREE from "three";
import type { WeaponId } from "./weapons";
import { surfaceMat, tiledTex } from "./gfx";

export type Team = "red" | "blue";

/** How a match is scored on a given map. */
export type GameMode = "ctf" | "dm" | "tdm" | "ffa";

export const MODE_LABEL: Record<GameMode, string> = {
  ctf: "Capture the Flag",
  dm: "Squishmatch",
  tdm: "Team Squishmatch",
  ffa: "Free For All",
};

export interface ItemSpawn {
  kind: "weapon" | "ammo" | "juice" | "megajuice" | "quad" | "milk";
  weapon?: WeaponId;
  pos: THREE.Vector3;
  respawn: number;
}

export interface MapDef {
  id: string;
  name: string;
  tag: string;
  blurb: string;
  modes: GameMode[];
  /** total players the map is designed for (network players + bots fill this) */
  maxPlayers: number;
  /** 0 = every squishy for themselves; 2 = two teams of maxPlayers/2 */
  teamSize: number;
  build: () => Arena;
}

export interface JumpPad {
  box: THREE.Box3;
  velocity: THREE.Vector3;
}

export interface Waypoint {
  pos: THREE.Vector3;
  links: number[];
}

export interface Arena {
  group: THREE.Group;
  boxes: THREE.Box3[];
  spawns: Record<Team, THREE.Vector3[]>;
  /** every usable spawn, used by squishmatch (1v1 deathmatch) */
  dmSpawns: THREE.Vector3[];
  flagStands: Record<Team, THREE.Vector3>;
  items: ItemSpawn[];
  jumpPads: JumpPad[];
  waypoints: Waypoint[];
  bounds: THREE.Box3;
}

export const TEAM_COLORS: Record<Team, number> = { red: 0xff5f7e, blue: 0x5aa8ff };

function skyTexture() {
  const cv = document.createElement("canvas");
  cv.width = 32;
  cv.height = 256;
  const c = cv.getContext("2d")!;
  const g = c.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, "#7fd4ff");
  g.addColorStop(0.45, "#bfeaff");
  g.addColorStop(0.72, "#ffe6c2");
  g.addColorStop(1, "#ffc2d6");
  c.fillStyle = g;
  c.fillRect(0, 0, 32, 256);
  const t = new THREE.CanvasTexture(cv);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}


function toyMat(color: number) {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.3,
    clearcoat: 0.8,
    clearcoatRoughness: 0.2,
  });
}

/**
 * Safety net: guarantees every pickup is out in the open.
 * Each item needs a clear column (≈1.9m wide, from just above its floor up to head-height)
 * that doesn't touch any collision box. Anything buried inside a block / stair / wall is
 * moved to the nearest open spot on the same level.
 */
function settleItems(items: ItemSpawn[], boxes: THREE.Box3[], maxX: number, maxZ: number) {
  const R = 0.95;
  const supportTop = (x: number, z: number, maxY: number) => {
    let top = -Infinity;
    for (const b of boxes) {
      if (x < b.min.x || x > b.max.x || z < b.min.z || z > b.max.z) continue;
      if (b.max.y <= maxY && b.max.y > top) top = b.max.y;
    }
    return top;
  };
  const isClear = (x: number, z: number, top: number) => {
    const y0 = top + 0.12;
    const y1 = top + 2.2;
    for (const b of boxes) {
      if (
        x + R > b.min.x &&
        x - R < b.max.x &&
        z + R > b.min.z &&
        z - R < b.max.z &&
        y1 > b.min.y &&
        y0 < b.max.y
      )
        return false;
    }
    return true;
  };

  for (const it of items) {
    const p = it.pos;
    const here = supportTop(p.x, p.z, p.y - 0.4);
    if (here !== -Infinity && isClear(p.x, p.z, here)) continue; // already in the open

    const level = p.y - 1.0;
    let moved = false;
    for (let r = 1; r <= 18 && !moved; r++) {
      const n = Math.max(8, r * 6);
      for (let k = 0; k < n; k++) {
        const ang = (k / n) * Math.PI * 2;
        const x = p.x + Math.cos(ang) * r;
        const z = p.z + Math.sin(ang) * r;
        if (Math.abs(x) > maxX || Math.abs(z) > maxZ) continue;
        const top = supportTop(x, z, level + 0.9);
        if (top === -Infinity || Math.abs(top - level) > 0.9) continue;
        if (!isClear(x, z, top)) continue;
        console.warn(`[arena] pickup at (${p.x}, ${p.y}, ${p.z}) was buried — moved to (${x.toFixed(1)}, ${z.toFixed(1)})`);
        p.set(x, top + 1.0, z);
        moved = true;
        break;
      }
    }
  }
}

export function buildArena(): Arena {
  const group = new THREE.Group();
  const boxes: THREE.Box3[] = [];

  const addBox = (
    cx: number,
    cy: number,
    cz: number,
    w: number,
    h: number,
    d: number,
    mat: THREE.Material,
    solid = true,
    receive = true,
  ) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(cx, cy, cz);
    m.receiveShadow = receive;
    m.castShadow = h < 20;
    group.add(m);
    if (solid) {
      boxes.push(
        new THREE.Box3(
          new THREE.Vector3(cx - w / 2, cy - h / 2, cz - w * 0 - d / 2),
          new THREE.Vector3(cx + w / 2, cy + h / 2, cz + d / 2),
        ),
      );
    }
    return m;
  };

  const X = 72; // canyon half-length
  const CZ = 18; // canyon half-width (floor)
  const LZ = 42; // outer half-width (upper plateau)
  const LY = 12; // plateau height

  const sand = surfaceMat("sand", 0xf6dfae);
  const rock = surfaceMat("rock", 0xf0a98a);
  const rockDark = surfaceMat("rock", 0xd98b72);
  const grass = surfaceMat("grass", 0x9fe08a);
  const wood = surfaceMat("wood", 0xffcf7a, 0.6);

  // ---------------------------------------------------------- canyon floor
  addBox(0, -2, 0, X * 2, 4, CZ * 2, sand);

  // ------------------------------------------------------------- cliffs
  for (const sz of [-1, 1]) {
    // cliff face / plateau mass
    addBox(0, LY / 2, sz * (CZ + (LZ - CZ) / 2), X * 2, LY, LZ - CZ, rock);
    // plateau top grass cap
    addBox(0, LY + 0.15, sz * (CZ + (LZ - CZ) / 2), X * 2, 0.3, LZ - CZ, grass);
    // outer wall
    addBox(0, LY + 9, sz * (LZ + 1.5), X * 2 + 6, 18, 3, rockDark);
    // decorative cliff bumps
    for (let i = -6; i <= 6; i++) {
      const bump = new THREE.Mesh(new THREE.SphereGeometry(4 + (i % 3), 10, 8), rock);
      bump.position.set(i * 11 + 3, LY - 2 + (i % 2) * 1.5, sz * CZ);
      bump.scale.set(1, 0.9, 0.5);
      bump.receiveShadow = true;
      group.add(bump);
    }
  }
  // end walls
  for (const sx of [-1, 1]) {
    addBox(sx * (X + 1.5), LY + 9, 0, 3, 42, LZ * 2 + 6, rockDark);
  }

  // ------------------------------------------------------------- bridge
  const bridgeHalfW = 5;
  addBox(0, LY - 0.4, 0, bridgeHalfW * 2, 0.8, CZ * 2 + 2, wood);
  for (const sz of [-1, 1]) {
    // rails
    for (const sx of [-1, 1]) {
      addBox(sx * bridgeHalfW, LY + 0.6, sz * 9.5, 0.5, 1.2, 19, toyMat(sz > 0 ? 0xff8ab0 : 0x8ad0ff), true, false);
    }
    // support pillars
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.2, LY, 12), toyMat(0xffe07a));
    p.position.set(0, LY / 2, sz * 12);
    p.castShadow = true;
    group.add(p);
    boxes.push(new THREE.Box3(
      new THREE.Vector3(-1.2, 0, sz * 12 - 1.2),
      new THREE.Vector3(1.2, LY, sz * 12 + 1.2),
    ));
  }
  // bridge center medallion
  const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(2.4, 2.4, 0.16, 24),
    new THREE.MeshPhysicalMaterial({ color: 0xc08bff, roughness: 0.2, clearcoat: 1, emissive: 0x5c2a99, emissiveIntensity: 0.4 }),
  );
  pad.position.set(0, LY + 0.1, 0);
  group.add(pad);

  // ------------------------------------------------- staircase ramps (x±30)
  const rampTopZ = CZ;
  const rampBotZ = 4;
  const steps = 24;
  const stepH = LY / steps;
  const stepD = (rampTopZ - rampBotZ) / steps;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      for (let i = 0; i < steps; i++) {
        const zStart = rampBotZ + i * stepD;
        const zEnd = rampTopZ + 0.5;
        const cz = sz * ((zStart + zEnd) / 2);
        const dz = zEnd - zStart;
        // each step is its own height band — no overlapping faces, no z-fighting
        const cy = i * stepH + stepH / 2;
        const col = [0xff9eb5, 0xffd48a, 0xfff39e, 0xa8e6a3, 0x9fd6ff, 0xd3aaff][i % 6];
        addBox(sx * 30, cy, cz, 9, stepH, dz, toyMat(col));
      }
    }
  }

  // --------------------------------------------------------------- bases
  const flagStands: Record<Team, THREE.Vector3> = {
    red: new THREE.Vector3(-62, 1.2, 0),
    blue: new THREE.Vector3(62, 1.2, 0),
  };
  const spawns: Record<Team, THREE.Vector3[]> = { red: [], blue: [] };

  (["red", "blue"] as Team[]).forEach((team) => {
    const sx = team === "red" ? -1 : 1;
    const col = TEAM_COLORS[team];
    const baseX = sx * 62;
    const teamMat = toyMat(col);
    const light = toyMat(team === "red" ? 0xffd3dc : 0xd3e7ff);
    // raised base platform
    addBox(baseX, 0.6, 0, 20, 1.2, 26, light);
    // back wall + side walls (cover)
    addBox(baseX + sx * 7, 3.5, 0, 4, 6, 26, teamMat);
    for (const sz of [-1, 1]) {
      addBox(baseX, 3, sz * 11, 18, 5, 4, teamMat);
    }
    // flag podium
    const podium = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.2, 0.7, 18), teamMat);
    podium.position.set(baseX, 1.55, 0);
    podium.castShadow = true;
    group.add(podium);
    boxes.push(new THREE.Box3(
      new THREE.Vector3(baseX - 2.0, 1.2, -2.0),
      new THREE.Vector3(baseX + 2.0, 1.9, 2.0),
    ));
    flagStands[team].set(baseX, 1.9, 0);

    // cute balloon arch over base
    for (let i = 0; i <= 10; i++) {
      const a = (i / 10) * Math.PI;
      const b = new THREE.Mesh(
        new THREE.SphereGeometry(0.9, 12, 10),
        toyMat(i % 2 ? col : 0xfff3b0),
      );
      b.position.set(baseX - sx * 2, 1.2 + Math.sin(a) * 8, Math.cos(a) * 9);
      b.scale.y = 1.2;
      group.add(b);
    }
    // spawns
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI - Math.PI / 2;
      spawns[team].push(
        new THREE.Vector3(baseX - sx * (4 + (i % 3) * 3), 1.3, Math.sin(ang) * 8),
      );
    }
  });

  // ------------------------------------------------- floor cover: toy blocks
  const coverSpots: [number, number, number, number, number][] = [
    [-44, 9, 4.5, 4, 4],
    [44, -9, 4.5, 4, 4],
    [-44, -9, 5, 3.5, 3.5],
    [44, 9, 5, 3.5, 3.5],
    [-18, -8, 3.5, 3, 3.5],
    [18, 8, 3.5, 3, 3.5],
    [-14, 12, 3.5, 3, 3.5],
    [14, -12, 3.5, 3, 3.5],
    [0, 0, 4, 2.6, 4],
    [-58, 16, 5, 4, 4],
    [58, -16, 5, 4, 4],
    [-50, -3, 3, 2.5, 2.5],
    [50, 3, 3, 2.5, 2.5],
  ];
  const blockCols = [0xff9eb5, 0xffd48a, 0xa8e6a3, 0x9fd6ff, 0xd3aaff, 0xfff39e];
  coverSpots.forEach((s, i) => {
    addBox(s[0], s[3] / 2, s[1], s[2], s[3], s[4], toyMat(blockCols[i % blockCols.length]));
  });
  // plateau cover
  for (const sz of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const x = -48 + i * 24;
      addBox(x, 12 + 2, sz * 30, 6, 4, 6, toyMat(blockCols[(i + 2) % blockCols.length]));
    }
  }

  // ------------------------------------------------------------ jump pads
  const jumpPads: JumpPad[] = [];
  const padPositions: [number, number][] = [
    [-50, 13],
    [-50, -13],
    [50, 13],
    [50, -13],
    [-8, 15],
    [8, -15],
  ];
  for (const [px, pz] of padPositions) {
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 2.6, 0.5, 20),
      new THREE.MeshPhysicalMaterial({
        color: 0xffe14d,
        emissive: 0xff9c2a,
        emissiveIntensity: 0.7,
        roughness: 0.2,
        clearcoat: 1,
      }),
    );
    m.position.set(px, 0.25, pz);
    group.add(m);
    jumpPads.push({
      box: new THREE.Box3(
        new THREE.Vector3(px - 2.4, 0, pz - 2.4),
        new THREE.Vector3(px + 2.4, 1.6, pz + 2.4),
      ),
      velocity: new THREE.Vector3(0, 27.5, pz > 0 ? 8 : -8),
    });
  }

  // ---------------------------------------------------------------- items
  const items: ItemSpawn[] = [];
  const addItem = (
    kind: ItemSpawn["kind"],
    pos: [number, number, number],
    weapon?: WeaponId,
    respawn = 18,
  ) => items.push({ kind, pos: new THREE.Vector3(...pos), weapon, respawn });

  // mirrored weapon placement
  const mirrored: [ItemSpawn["kind"], [number, number, number], WeaponId | undefined, number][] = [
    // NOTE: none of these may sit inside the stair blocks, cover boxes, walls or pillars.
    ["weapon", [-37, 1, -6], "chaingun", 14],
    ["weapon", [-18, 1, 11], "rocket", 16],
    ["weapon", [-42, 1, 2], "balloon", 16],
    ["weapon", [-50, 1, -6], "mines", 16],
    ["weapon", [-8, 1, 8], "punch", 22],
    ["weapon", [-22, 13.2, 22], "sniper", 18],
    ["weapon", [-40, 13.2, -30], "squirt", 16],
    ["ammo", [-36, 1, 12], undefined, 18],
    ["ammo", [-14, 1, -13], undefined, 18],
    ["ammo", [-64, 2.2, 6], undefined, 18],
    ["ammo", [-30, 13.2, 36], undefined, 18],
    ["juice", [-49, 1, 10], undefined, 20],
    ["juice", [-26, 1, 0], undefined, 20],
    ["juice", [-10, 13.2, -28], undefined, 20],
    ["megajuice", [-58, 13.2, 32], undefined, 45],
    ["milk", [-48, 13.2, 20], undefined, 50],
  ];
  for (const [kind, p, w, r] of mirrored) {
    addItem(kind, p, w, r);
    addItem(kind, [-p[0], p[1], -p[2]], w, r);
  }
  // neutral / contested
  addItem("quad", [0, 13.4, 0], undefined, 70);
  addItem("milk", [0, 1.2, 0], undefined, 55); // Under the bridge!
  addItem("weapon", [0, 13.2, 37], "bfg", 35);
  addItem("weapon", [0, 13.2, -37], "bfg", 35);
  addItem("weapon", [0, 1, 15.5], "squirt", 16);
  addItem("weapon", [0, 1, -15.5], "squirt", 16);
  addItem("ammo", [0, 13.2, 9], undefined, 16);
  addItem("ammo", [0, 13.2, -9], undefined, 16);
  addItem("juice", [0, 1, 8], undefined, 20);
  addItem("juice", [0, 1, -8], undefined, 20);

  // every pickup must be out in the open — not buried in a block, stair or wall
  settleItems(items, boxes, X - 4, LZ - 3);

  // ------------------------------------------------------------ waypoints
  const wpPos: THREE.Vector3[] = [];
  const push = (x: number, y: number, z: number) => {
    wpPos.push(new THREE.Vector3(x, y, z));
    return wpPos.length - 1;
  };
  // canyon floor grid
  const floorXs = [-62, -56, -48, -40, -32, -24, -16, -8, 0, 8, 16, 24, 32, 40, 48, 56, 62];
  const floorZs = [-13, 0, 13];
  const floorIdx: number[][] = [];
  floorXs.forEach((x) => {
    const row: number[] = [];
    floorZs.forEach((z) => row.push(push(x, 1.2, z)));
    floorIdx.push(row);
  });
  // ramp chains
  const rampChains: number[][] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const a = push(sx * 30, 1.2, sz * 6.5);
      const b = push(sx * 30, 6.5, sz * 12);
      const c = push(sx * 30, 12.6, sz * 17.5);
      const d = push(sx * 30, 12.6, sz * 22);
      rampChains.push([a, b, c, d]);
    }
  }
  // plateau rows
  const plateauIdx: number[][] = [];
  for (const sz of [-1, 1]) {
    const row: number[] = [];
    [-60, -50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50, 60].forEach((x) =>
      row.push(push(x, 12.6, sz * 27)),
    );
    plateauIdx.push(row);
    const row2: number[] = [];
    [-50, -25, 0, 25, 50].forEach((x) => row2.push(push(x, 12.6, sz * 36)));
    plateauIdx.push(row2);
  }
  // bridge
  const bridgeIdx = [-16, -10, -4, 0, 4, 10, 16].map((z) => push(0, 12.6, z));

  const waypoints: Waypoint[] = wpPos.map((p) => ({ pos: p, links: [] }));
  const link = (a: number, b: number) => {
    if (a === b) return;
    if (!waypoints[a].links.includes(b)) waypoints[a].links.push(b);
    if (!waypoints[b].links.includes(a)) waypoints[b].links.push(a);
  };
  // auto link same-level near nodes
  for (let i = 0; i < waypoints.length; i++) {
    for (let j = i + 1; j < waypoints.length; j++) {
      const a = waypoints[i].pos;
      const b = waypoints[j].pos;
      if (Math.abs(a.y - b.y) > 1.5) continue;
      const d = a.distanceTo(b);
      if (d > 16) continue;
      // don't link across the canyon gap at plateau level
      if (a.y > 6 && Math.sign(a.z) !== Math.sign(b.z) && Math.abs(a.z) > 2 && Math.abs(b.z) > 2)
        continue;
      // never link two plateau nodes straight across the canyon mouth
      if (a.y > 6 && Math.abs(a.z) < 20 && Math.abs(b.z) < 20 && Math.abs(a.x - b.x) > 8) continue;
      link(i, j);
    }
  }
  // ramp chain links
  for (const chain of rampChains) {
    for (let i = 0; i < chain.length - 1; i++) link(chain[i], chain[i + 1]);
    // bottom of ramp to nearest floor nodes
    const bottom = waypoints[chain[0]].pos;
    floorIdx.flat().forEach((fi) => {
      if (waypoints[fi].pos.distanceTo(bottom) < 15) link(fi, chain[0]);
    });
    const top = waypoints[chain[3]].pos;
    plateauIdx.flat().forEach((pi) => {
      if (waypoints[pi].pos.distanceTo(top) < 15 && Math.sign(waypoints[pi].pos.z) === Math.sign(top.z))
        link(pi, chain[3]);
    });
  }
  // bridge to plateau
  const bEnds = [bridgeIdx[0], bridgeIdx[bridgeIdx.length - 1]];
  for (const be of bEnds) {
    plateauIdx.flat().forEach((pi) => {
      const p = waypoints[pi].pos;
      if (Math.sign(p.z) === Math.sign(waypoints[be].pos.z) && Math.abs(p.x) < 14 && Math.abs(p.z) < 30)
        link(be, pi);
    });
  }
  for (let i = 0; i < bridgeIdx.length - 1; i++) link(bridgeIdx[i], bridgeIdx[i + 1]);

  // ------------------------------------------- candy-stick trees on the cliff tops
  // Purely visual (no collision), placed along the plateau's outer edge where
  // nobody walks, so they frame the arena without getting in the way.
  const stickMat = new THREE.MeshStandardMaterial({ color: 0xf5e6d3, roughness: 0.8 });
  const candy = [0xff8ab0, 0xffd34d, 0x6effa8, 0x8ad6ff, 0xc08bff];
  for (const sz of [-1, 1]) {
    for (const [i, x] of [-60, -36, -12, 12, 36, 60].entries()) {
      const h = 6 + (i % 3);
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, h, 10), stickMat);
      stick.position.set(x, LY + h / 2, sz * 38.5);
      stick.castShadow = true;
      group.add(stick);
      const top = new THREE.Mesh(new THREE.SphereGeometry(2.1, 18, 14), toyMat(candy[i % candy.length]));
      top.position.set(x, LY + h + 1.4, sz * 38.5);
      top.castShadow = true;
      group.add(top);
      const band = new THREE.Mesh(new THREE.TorusGeometry(2.12, 0.24, 8, 24), toyMat(0xffffff));
      band.position.copy(top.position);
      band.rotation.x = Math.PI / 2 + 0.35;
      band.castShadow = true;
      group.add(band);
    }
  }

  // ------------------------------------- distant candy mesas beyond the canyon
  const mesaCols = [0xf7b59a, 0xf3c58e, 0xe9a5b8, 0xf2d3a0];
  for (let i = 0; i < 12; i++) {
    const ang = (i / 12) * Math.PI * 2 + 0.2;
    const r = 175 + (i % 3) * 22;
    const h = 40 + ((i * 37) % 45);
    const mesa = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 0.2, r * 0.3, h, 7),
      new THREE.MeshStandardMaterial({ color: mesaCols[i % mesaCols.length], roughness: 1, flatShading: true }),
    );
    mesa.position.set(Math.cos(ang) * r, h / 2 - 4, Math.sin(ang) * r);
    group.add(mesa);
  }

  // ------------------------------------------------------------- clouds
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  for (let i = 0; i < 16; i++) {
    const c = new THREE.Group();
    const n = 3 + Math.floor(Math.random() * 3);
    for (let k = 0; k < n; k++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(3 + Math.random() * 3, 10, 8), cloudMat);
      s.position.set(k * 4 - n * 1.5, Math.random() * 2, Math.random() * 3);
      c.add(s);
    }
    c.position.set((Math.random() - 0.5) * 220, 40 + Math.random() * 26, (Math.random() - 0.5) * 170);
    group.add(c);
  }

  return {
    group,
    boxes,
    spawns,
    dmSpawns: [],
    flagStands,
    items,
    jumpPads,
    waypoints,
    bounds: new THREE.Box3(new THREE.Vector3(-X, -5, -LZ), new THREE.Vector3(X, 60, LZ)),
  };
}

// ==========================================================================
//  MAP 2 — "The Playpen": the tutorial level.
//  Two perfect cube rooms joined by a long sweeping 90° curved hallway.
//  Built for a 1v1 squishmatch against a very easy bot.
// ==========================================================================
export function buildTutorialArena(): Arena {
  const group = new THREE.Group();
  const boxes: THREE.Box3[] = [];

  const addBox = (
    cx: number, cy: number, cz: number, w: number, h: number, d: number,
    mat: THREE.Material, solid = true, receive = true,
  ) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(cx, cy, cz);
    m.receiveShadow = receive;
    m.castShadow = h < 20;
    group.add(m);
    if (solid) {
      boxes.push(new THREE.Box3(
        new THREE.Vector3(cx - w / 2, cy - h / 2, cz - d / 2),
        new THREE.Vector3(cx + w / 2, cy + h / 2, cz + d / 2),
      ));
    }
    return m;
  };

  const T = 2;      // wall thickness
  const RH = 30;    // room height → the rooms are perfect 30×30×30 cubes
  const RS = 30;    // room interior side length
  const CH = 12;    // hallway height
  // Walkable hallway annulus is exactly r ∈ [12, 22]. The wall blocks are built
  // inside 10.8 and outside 23.2, so their axis-aligned corners can never
  // intrude on the corridor even though boxes can't be rotated.
  const ARC_R = 17; // the corridor's centre-line radius
  const WI = 10.8;  // inner wall outer radius
  const WO = 23.2;  // outer wall inner radius
  const WT = 27.5;  // outer wall outer radius

  const pastel = [0xff9eb5, 0xffd48a, 0xfff39e, 0xa8e6a3, 0x9fd6ff, 0xd3aaff];
  const floorMat = surfaceMat("wood", 0xf3e3c3, 0.6);
  const ceilMat = surfaceMat("plaster", 0xffeef7);
  const roomWallA = surfaceMat("wallpaper", 0x9fd6ff, 0.75);
  const roomWallB = surfaceMat("wallpaper", 0xffb4d2, 0.75);
  const trim = toyMat(0xffe07a);

  // ------------------------------------------------------------- ROOM A
  // interior x ∈ [-32,-2], z ∈ [-30,0], y ∈ [0,30]; door on the +z wall
  const ax0 = -32, ax1 = -2, az0 = -30, az1 = 0;
  const acx = (ax0 + ax1) / 2, acz = (az0 + az1) / 2;
  addBox(acx, -1, acz, RS + 2 * T, T, RS + 2 * T, floorMat);
  addBox(acx, RH + 1, acz, RS + 2 * T, T, RS + 2 * T, ceilMat);
  addBox(ax0 - T / 2, RH / 2, acz, T, RH + T, RS + 2 * T, roomWallA);
  addBox(ax1 + T / 2, RH / 2, acz, T, RH + T, RS + 2 * T, roomWallA);
  addBox(acx, RH / 2, az0 - T / 2, RS + 2 * T, RH + T, T, roomWallA);
  // +z wall, door opening at x ∈ [-22,-12], y ∈ [0,CH]
  addBox((ax0 - T - 22) / 2, RH / 2, az1 + T / 2, -22 - (ax0 - T), RH + T, T, roomWallA);
  addBox((-12 + (ax1 + T)) / 2, RH / 2, az1 + T / 2, ax1 + T + 12, RH + T, T, roomWallA);
  addBox(-17, (CH + RH + T) / 2, az1 + T / 2, 10, RH + T - CH, T, trim);
  // skirting + ceiling trim for cuteness
  addBox(acx, 0.35, az0 + 0.35, RS, 0.7, 0.7, trim, false, false);
  addBox(acx, RH - 0.35, az1 - 0.35, RS, 0.7, 0.7, trim, false, false);

  // ------------------------------------------------------------- ROOM B
  // interior x ∈ [0,30], z ∈ [2,32], y ∈ [0,30]; door on the -x wall
  const bx0 = 0, bx1 = 30, bz0 = 2, bz1 = 32;
  const bcx = (bx0 + bx1) / 2, bcz = (bz0 + bz1) / 2;
  addBox(bcx, -1, bcz, RS + 2 * T, T, RS + 2 * T, floorMat);
  addBox(bcx, RH + 1, bcz, RS + 2 * T, T, RS + 2 * T, ceilMat);
  addBox(bx1 + T / 2, RH / 2, bcz, T, RH + T, RS + 2 * T, roomWallB);
  addBox(bcx, RH / 2, bz0 - T / 2, RS + 2 * T, RH + T, T, roomWallB);
  addBox(bcx, RH / 2, bz1 + T / 2, RS + 2 * T, RH + T, T, roomWallB);
  // -x wall, door opening at z ∈ [12,22], y ∈ [0,CH]
  addBox(bx0 - T / 2, RH / 2, (bz0 - T + 12) / 2, T, RH + T, 12 - (bz0 - T), roomWallB);
  addBox(bx0 - T / 2, RH / 2, (22 + (bz1 + T)) / 2, T, RH + T, bz1 + T - 22, roomWallB);
  addBox(bx0 - T / 2, (CH + RH + T) / 2, 17, T, RH + T - CH, 10, trim);
  addBox(bcx, 0.35, bz1 - 0.35, RS, 0.7, 0.7, trim, false, false);
  addBox(bcx, RH - 0.35, bz0 + 0.35, RS, 0.7, 0.7, trim, false, false);

  // ------------------------------------------- CURVED 90° HALLWAY (blocky)
  // Approximated with axis-aligned blocks so visuals and collision match
  // exactly — the chunky toy-block curve suits the playpen look.
  const SLICES = 18;
  const step = Math.PI / 2 / SLICES;
  const segAABB = (ra: number, rb: number, ta: number, tb: number) => {
    // cos decreases and sin decreases across [90°,180°]
    const minX = rb * Math.cos(tb);
    const maxX = ra * Math.cos(ta);
    const minZ = ra * Math.sin(tb);
    const maxZ = rb * Math.sin(ta);
    return { minX, maxX, minZ, maxZ };
  };
  for (let i = 0; i < SLICES; i++) {
    const ta = Math.PI / 2 + i * step;
    const tb = ta + step;
    const col = toyMat(pastel[i % pastel.length]);
    const place = (ra: number, rb: number, y0: number, y1: number, mat: THREE.Material) => {
      const s = segAABB(ra, rb, ta, tb);
      const w = s.maxX - s.minX;
      const d = s.maxZ - s.minZ;
      if (w <= 0.01 || d <= 0.01) return;
      addBox((s.minX + s.maxX) / 2, (y0 + y1) / 2, (s.minZ + s.maxZ) / 2, w, y1 - y0, d, mat);
    };
    place(0, WI, 0, CH, col);          // inner wall
    place(WO, WT, 0, CH, col);         // outer wall
    place(0, WT, -2, 0, floorMat);     // floor
    place(0, WT, CH, CH + 4, ceilMat); // roof slab
  }

  // ------------------------------------------------------------ lighting
  // The rooms are enclosed, so they need their own cheerful lights.
  const lamp = (
    x: number, y: number, z: number, c: number, i: number, dist: number, ceiling = RH,
  ) => {
    const l = new THREE.PointLight(c, i, dist);
    l.position.set(x, y, z);
    group.add(l);
    // a plush glowing "night light" so the source is visible
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.7, 12, 10),
      new THREE.MeshBasicMaterial({ color: c }),
    );
    bulb.position.set(x, y + 0.4, z);
    group.add(bulb);
    if (ceiling - y > 0.5) {
      const cord = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.06, ceiling - y, 6),
        new THREE.MeshStandardMaterial({ color: 0xffffff }),
      );
      cord.position.set(x, y + (ceiling - y) / 2, z);
      group.add(cord);
    }
  };
  lamp(-24, 24, -8, 0xfff2cf, 2.6, 48);
  lamp(-8, 24, -22, 0xffe6f2, 2.6, 48);
  lamp(8, 24, 26, 0xe6f6ff, 2.6, 48);
  lamp(24, 24, 10, 0xfff2cf, 2.6, 48);
  for (const th of [Math.PI * 0.6, Math.PI * 0.75, Math.PI * 0.9]) {
    lamp(Math.cos(th) * ARC_R, CH - 1.6, Math.sin(th) * ARC_R, 0xfff6dd, 2.0, 28, CH);
  }

  // ------------------------------------------------ round rugs (visual only)
  const rugMat = (c: number) =>
    new THREE.MeshStandardMaterial({ color: c, roughness: 1, map: tiledTex("fabric", 3, 3) });
  for (const [cx, cz, c] of [[-17, -15, 0xffb4d2], [15, 17, 0xa8e6a3]] as const) {
    const rug = new THREE.Mesh(new THREE.CylinderGeometry(7.5, 7.5, 0.12, 40), rugMat(c));
    rug.position.set(cx, 0.06, cz);
    rug.receiveShadow = true;
    group.add(rug);
  }

  // -------------------------------------------------------- toy cover
  const cover: [number, number, number, number][] = [
    [-26, -22, 4, 3], [-8, -22, 4, 3], [-17, -12, 5, 2.5],
    [8, 26, 4, 3], [24, 26, 4, 3], [15, 12, 5, 2.5], [26, 17, 4, 2.5],
  ];
  cover.forEach((c, i) => {
    addBox(c[0], c[3] / 2, c[1], c[2], c[3], c[2], toyMat(pastel[(i + 3) % pastel.length]));
  });

  // -------------------------------------------------------------- items
  const items: ItemSpawn[] = [];
  const addItem = (
    kind: ItemSpawn["kind"], pos: [number, number, number],
    weapon?: WeaponId, respawn = 18,
  ) => items.push({ kind, pos: new THREE.Vector3(...pos), weapon, respawn });

  // NOTE: keep these clear of the cover blocks listed above.
  addItem("weapon", [-17, 1.2, -20], "chaingun", 12);
  addItem("weapon", [-27, 1.2, -6], "punch", 20);
  addItem("weapon", [15, 1.2, 17], "rocket", 14);
  addItem("weapon", [20, 1.2, 29], "sniper", 16);
  addItem("weapon", [Math.cos(Math.PI * 0.75) * ARC_R, 1.2, Math.sin(Math.PI * 0.75) * ARC_R], "balloon", 14);
  addItem("ammo", [-27, 1.2, -26], undefined, 16);
  addItem("ammo", [25, 1.2, 8], undefined, 16);
  addItem("ammo", [Math.cos(Math.PI * 0.6) * ARC_R, 1.2, Math.sin(Math.PI * 0.6) * ARC_R], undefined, 16);
  addItem("juice", [-8, 1.2, -26], undefined, 18);
  addItem("juice", [5, 1.2, 30], undefined, 18);
  addItem("megajuice", [Math.cos(Math.PI * 0.9) * ARC_R, 1.2, Math.sin(Math.PI * 0.9) * ARC_R], undefined, 40);

  settleItems(items, boxes, 34, 36);

  // ----------------------------------------------------------- waypoints
  const wpPos: THREE.Vector3[] = [];
  const push = (x: number, y: number, z: number) => {
    wpPos.push(new THREE.Vector3(x, y, z));
    return wpPos.length - 1;
  };
  // Room A
  [-17, -28, -6].forEach((x) => [-24, -15, -6].forEach((z) => push(x, 1.2, z)));
  // Sweeping hallway — waypoints walk the corridor's centre-line
  for (const deg of [180, 165, 150, 135, 120, 105, 92]) {
    const th = (deg * Math.PI) / 180;
    push(Math.cos(th) * ARC_R, 1.2, Math.sin(th) * ARC_R);
  }
  // Room B
  [3, 15, 26].forEach((x) => [8, 17, 27].forEach((z) => push(x, 1.2, z)));

  const waypoints: Waypoint[] = wpPos.map((p) => ({ pos: p, links: [] }));
  const link = (a: number, b: number) => {
    if (a === b) return;
    if (!waypoints[a].links.includes(b)) waypoints[a].links.push(b);
    if (!waypoints[b].links.includes(a)) waypoints[b].links.push(a);
  };
  // Every waypoint sits on the same floor, so plain proximity linking is safe.
  for (let i = 0; i < waypoints.length; i++) {
    for (let j = i + 1; j < waypoints.length; j++) {
      if (waypoints[i].pos.distanceTo(waypoints[j].pos) < 15) link(i, j);
    }
  }

  // ------------------------------------------------------- spawn points
  // Respawn points live in BOTH rooms; the engine picks whichever is farthest
  // from where the giggling-out happened.
  const dmSpawns: THREE.Vector3[] = [
    new THREE.Vector3(-28, 0.2, -26), new THREE.Vector3(-6, 0.2, -26),
    new THREE.Vector3(-28, 0.2, -5), new THREE.Vector3(-6, 0.2, -5),
    new THREE.Vector3(-17, 0.2, -27), new THREE.Vector3(-17, 0.2, -4),
    new THREE.Vector3(28, 0.2, 30), new THREE.Vector3(6, 0.2, 30),
    new THREE.Vector3(28, 0.2, 5), new THREE.Vector3(6, 0.2, 5),
    new THREE.Vector3(15, 0.2, 30), new THREE.Vector3(20, 0.2, 17),
  ];

  return {
    group,
    boxes,
    // squishmatch is free-for-all, so both teams draw from every point
    spawns: { red: [...dmSpawns], blue: [...dmSpawns] },
    dmSpawns,
    flagStands: {
      red: new THREE.Vector3(-17, 1.2, -15),
      blue: new THREE.Vector3(15, 1.2, 17),
    },
    items,
    jumpPads: [],
    waypoints,
    bounds: new THREE.Box3(new THREE.Vector3(-36, -5, -34), new THREE.Vector3(34, 40, 36)),
  };
}

// ==========================================================================
//  Shared helpers for the smaller symmetrical arenas
// ==========================================================================
interface Builder {
  group: THREE.Group;
  boxes: THREE.Box3[];
  add: (
    cx: number, cy: number, cz: number, w: number, h: number, d: number,
    mat: THREE.Material, solid?: boolean, shadow?: boolean,
  ) => THREE.Mesh;
}

function makeBuilder(): Builder {
  const group = new THREE.Group();
  const boxes: THREE.Box3[] = [];
  const add = (
    cx: number, cy: number, cz: number, w: number, h: number, d: number,
    mat: THREE.Material, solid = true, shadow = true,
  ) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(cx, cy, cz);
    m.receiveShadow = shadow;
    m.castShadow = shadow && h < 22;
    group.add(m);
    if (solid) {
      boxes.push(
        new THREE.Box3(
          new THREE.Vector3(cx - w / 2, cy - h / 2, cz - d / 2),
          new THREE.Vector3(cx + w / 2, cy + h / 2, cz + d / 2),
        ),
      );
    }
    return m;
  };
  return { group, boxes, add };
}

/**
 * Waypoints from a list of positions. Nodes on the same level auto-link, and
 * `chains` (staircases / ramps) are stitched into their neighbouring levels so
 * pathfinding can climb.
 */
function makeWaypoints(nodes: THREE.Vector3[], chains: number[][]) {
  const waypoints: Waypoint[] = nodes.map((pos) => ({ pos, links: [] }));
  const link = (a: number, b: number) => {
    if (a === b || a < 0 || b < 0) return;
    if (!waypoints[a].links.includes(b)) waypoints[a].links.push(b);
    if (!waypoints[b].links.includes(a)) waypoints[b].links.push(a);
  };
  for (let i = 0; i < waypoints.length; i++) {
    for (let j = i + 1; j < waypoints.length; j++) {
      const a = waypoints[i].pos;
      const b = waypoints[j].pos;
      if (Math.abs(a.y - b.y) > 1.6) continue;
      if (a.distanceTo(b) < 16) link(i, j);
    }
  }
  for (const chain of chains) {
    for (let i = 0; i < chain.length - 1; i++) link(chain[i], chain[i + 1]);
    for (const end of [chain[0], chain[chain.length - 1]]) {
      const p = waypoints[end].pos;
      waypoints.forEach((w, wi) => {
        if (wi === end) return;
        if (Math.abs(w.pos.y - p.y) > 1.6 && Math.abs(w.pos.y - p.y) < 9) link(wi, end);
      });
    }
  }
  return waypoints;
}

function scatterLights(group: THREE.Group, spots: [number, number, number, number, number][]) {
  for (const [x, y, z, c, d] of spots) {
    const l = new THREE.PointLight(c, 2.1, d);
    l.position.set(x, y, z);
    group.add(l);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 12, 10),
      new THREE.MeshBasicMaterial({ color: c }),
    );
    bulb.position.set(x, y - 0.7, z);
    group.add(bulb);
  }
}

// ==========================================================================
//  MAP 3 — "Toy Box Rumble": a stacked building-brick pit for team play.
//  Four corners, a raised brick in the middle, and a ledge all the way round.
// ==========================================================================
export function buildToyBoxArena(): Arena {
  const { group, boxes, add } = makeBuilder();
  const H = 20; // wall height
  const R = 42; // half-extent of the play-mat

  const mat = surfaceMat("fabric", 0xfdeecf, 1);
  const brick = (c: number) => toyMat(c);
  const wall = surfaceMat("plaster", 0xfff3e0, 0.9);

  // play mat floor + outer walls
  add(0, -2, 0, R * 2, 4, R * 2, mat);
  add(0, H / 2, -R - 1, R * 2 + 4, H, 2, wall);
  add(0, H / 2, R + 1, R * 2 + 4, H, 2, wall);
  add(-R - 1, H / 2, 0, 2, H, R * 2 + 4, wall);
  add(R + 1, H / 2, 0, 2, H, R * 2 + 4, wall);

  const cols = [0xff9eb5, 0xffd48a, 0xfff39e, 0xa8e6a3, 0x9fd6ff, 0xd3aaff];

  // ------------------------------------------------- central raised brick
  add(0, 3, 0, 22, 6, 22, brick(0x9fd6ff));
  add(0, 6.2, 0, 23, 0.5, 23, brick(0xffd34d), false); // rim trim
  // steps up each side (8 risers of 0.75 so they can be walked up)
  const rampIdx: number[] = [];
  for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const chain: number[] = [];
    for (let i = 0; i < 8; i++) {
      const h = (i + 1) * 0.75;
      const along = 11.5 + (7 - i) * 1.4;
      const cx = sx ? Math.sign(sx) * along : 0;
      const cz = sz ? Math.sign(sz) * along : 0;
      add(cx, h / 2, cz, sx ? 1.4 : 10, h, sz ? 1.4 : 10, brick(cols[i % cols.length]));
      void chain;
    }
    rampIdx.push(chain.length);
  }
  void rampIdx;

  // ------------------------------------------- corner towers + ledge ring
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      add(sx * 32, 4, sz * 32, 12, 8, 12, brick(cols[(sx > 0 ? 2 : 0) + (sz > 0 ? 1 : 0)]));
      add(sx * 32, 8.3, sz * 32, 13.5, 0.6, 13.5, brick(0xfff39e), false);
    }
  }
  // perimeter ledge (walkway) at y = 11, 6 deep along all four walls
  const LEDGE_Y = 11;
  for (const sz of [-1, 1]) add(0, LEDGE_Y / 2 - 0.5, sz * (R - 3), R * 2, LEDGE_Y - 1, 6, brick(0xa8e6a3));
  for (const sx of [-1, 1]) add(sx * (R - 3), LEDGE_Y / 2 - 0.5, 0, 6, LEDGE_Y - 1, R * 2 - 12, brick(0xd3aaff));

  // cover bricks scattered in the mid ring
  const cover: [number, number, number][] = [
    [-18, 3, -8], [18, 3, 8], [-18, 3, 8], [18, 3, -8],
    [-8, 3, -20], [8, 3, 20], [-28, 3, 0], [28, 3, 0],
  ];
  cover.forEach((c, i) => add(c[0], c[1], c[2], 6, 6, 6, brick(cols[i % cols.length])));

  // bounce pads up to the ledge and towers
  const jumpPads: JumpPad[] = [];
  const padAt = (x: number, z: number, vy: number, vxDx: number, vzDz: number) => {
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 2.6, 0.5, 20),
      new THREE.MeshPhysicalMaterial({
        color: 0xffe14d, emissive: 0xff9c2a, emissiveIntensity: 0.75, roughness: 0.2, clearcoat: 1,
      }),
    );
    m.position.set(x, 0.25, z);
    group.add(m);
    jumpPads.push({
      box: new THREE.Box3(new THREE.Vector3(x - 2.4, 0, z - 2.4), new THREE.Vector3(x + 2.4, 1.6, z + 2.4)),
      velocity: new THREE.Vector3(vxDx, vy, vzDz),
    });
  };
  padAt(-R + 8, -R + 8, 24, -3, -3);
  padAt(R - 8, R - 8, 24, 3, 3);
  padAt(R - 8, -R + 8, 24, 3, -3);
  padAt(-R + 8, R - 8, 24, -3, 3);

  // ------------------------------------------------------------ team bases
  const flagStands: Record<Team, THREE.Vector3> = {
    red: new THREE.Vector3(-32, 8.6, -32),
    blue: new THREE.Vector3(32, 8.6, 32),
  };
  const spawns: Record<Team, THREE.Vector3[]> = { red: [], blue: [] };
  (["red", "blue"] as Team[]).forEach((team) => {
    const s = team === "red" ? -1 : 1;
    const cx = s * 32;
    const cz = s * 32;
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.4, 0.6, 22), toyMat(TEAM_COLORS[team]));
    pad.position.set(cx, 8.4, cz);
    pad.receiveShadow = true;
    group.add(pad);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      spawns[team].push(new THREE.Vector3(cx + Math.cos(a) * 1.8, 9.1, cz + Math.sin(a) * 1.8));
    }
    // a soft banner of bunting over each corner
    for (let i = 0; i <= 6; i++) {
      const f = new THREE.Mesh(
        new THREE.ConeGeometry(0.5, 1, 3),
        new THREE.MeshStandardMaterial({
          color: i % 2 ? TEAM_COLORS[team] : 0xfff3b0, roughness: 0.8, side: THREE.DoubleSide,
        }),
      );
      f.position.set(cx - s * 6 + i * 2 * -s, 14 - Math.sin((i / 6) * Math.PI) * 1.2, cz - s * 6);
      f.rotation.z = Math.PI;
      group.add(f);
    }
  });

  // ------------------------------------------------------------------ items
  const items: ItemSpawn[] = [];
  const put = (kind: ItemSpawn["kind"], p: [number, number, number], weapon?: WeaponId, respawn = 16) =>
    items.push({ kind, pos: new THREE.Vector3(...p), weapon, respawn });

  put("quad", [0, 7.4, 0], undefined, 40);
  put("weapon", [0, 12, 30], "punch", 18);
  put("weapon", [0, 12, -30], "punch", 18);
  const mirror: [ItemSpawn["kind"], [number, number, number], WeaponId | undefined, number][] = [
    ["weapon", [-24, 1, -14], "chaingun", 12],
    ["weapon", [24, 1, 14], "chaingun", 12],
    ["weapon", [-14, 1, 24], "rocket", 14],
    ["weapon", [14, 1, -24], "rocket", 14],
    ["weapon", [-32, 9.2, 12], "sniper", 16],
    ["weapon", [32, 9.2, -12], "sniper", 16],
    ["weapon", [12, 1, 12], "balloon", 14],
    ["weapon", [-12, 1, -12], "squirt", 12],
    ["ammo", [-24, 1, 24], undefined, 14],
    ["ammo", [24, 1, -24], undefined, 14],
    ["juice", [-12, 1, 12], undefined, 16],
    ["juice", [12, 1, -12], undefined, 16],
    ["juice", [-30, 9.2, -30], undefined, 18],
    ["juice", [30, 9.2, 30], undefined, 18],
    ["megajuice", [32, 1, 0], undefined, 40],
    ["megajuice", [-32, 1, 0], undefined, 40],
  ];
  for (const [kind, p, w, r] of mirror) put(kind, p, w, r);
  put("milk", [0, 7.4, 9], undefined, 55);

  settleItems(items, boxes, R - 4, R - 4);

  // ------------------------------------------------------------- waypoints
  const nodes: THREE.Vector3[] = [];
  const idx = (x: number, y: number, z: number) => {
    nodes.push(new THREE.Vector3(x, y, z));
    return nodes.length - 1;
  };
  for (const x of [-36, -24, -12, 0, 12, 24, 36])
    for (const z of [-36, -24, -12, 0, 12, 24, 36]) {
      if (Math.abs(x) < 14 && Math.abs(z) < 14) continue; // on the centre brick
      idx(x, 1.2, z);
    }
  idx(0, 6.4, 0);
  for (const x of [-24, 0, 24]) for (const z of [-24, 0, 24]) idx(x, 6.4, z);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) idx(sx * 32, 8.6, sz * 32);
  for (const x of [-38, -20, 0, 20, 38]) {
    idx(x, LEDGE_Y + 0.2, -R + 3);
    idx(x, LEDGE_Y + 0.2, R - 3);
  }
  for (const z of [-20, 0, 20]) {
    idx(-R + 3, LEDGE_Y + 0.2, z);
    idx(R - 3, LEDGE_Y + 0.2, z);
  }
  const waypoints = makeWaypoints(nodes, []);

  scatterLights(group, [
    [0, 16, 0, 0xfff4d8, 70],
    [-30, 15, -30, 0xffd9e6, 50],
    [30, 15, 30, 0xd9ecff, 50],
  ]);

  const dmSpawns = [...spawns.red, ...spawns.blue];
  return {
    group,
    boxes,
    spawns,
    dmSpawns,
    flagStands,
    items,
    jumpPads,
    waypoints,
    bounds: new THREE.Box3(new THREE.Vector3(-R, -3, -R), new THREE.Vector3(R, 44, R)),
  };
}

// ==========================================================================
//  MAP 4 — "Rubber Ducky Pond": a shallow paddling pool of inflatable islands.
//  Built for four: one island each, one float in the middle to fight over.
// ==========================================================================
export function buildPondArena(): Arena {
  const { group, boxes, add } = makeBuilder();
  const R = 34; // pool half-extent
  const cols = [0xff9eb5, 0xffd48a, 0xfff39e, 0xa8e6a3, 0x9fd6ff, 0xd3aaff];

  // pool bottom (you can wade across it) and the tile surround
  // pool bottom is tiled and permanently wet; the surround is warm bath tiles
  const water = surfaceMat("tile", 0x9fdcf5, 0.18);
  water.metalness = 0.1;
  add(0, -0.6, 0, R * 2, 1.2, R * 2, water);
  add(0, 0.14, 0, R * 2, 0.06, R * 2, new THREE.MeshPhysicalMaterial({
    color: 0x7fd0f0, roughness: 0.06, transmission: 0.7, thickness: 1.2, clearcoat: 1, transparent: true, opacity: 0.72,
  }), false, false);
  const surround = surfaceMat("tile", 0xfff0c9, 0.4);
  for (const sx of [-1, 1]) add(sx * (R + 3), 2, 0, 6, 4, R * 2 + 12, surround);
  for (const sz of [-1, 1]) add(0, 2, sz * (R + 3), R * 2 + 12, 4, 6, surround);
  // splash guard rim so nobody is launched out of the world
  for (const sz of [-1, 1]) add(0, 6, sz * (R + 6.4), R * 2 + 20, 6, 1.2, toyMat(0x9fd6ff));
  for (const sx of [-1, 1]) add(sx * (R + 6.4), 6, 0, 1.2, 6, R * 2 + 20, toyMat(0xffb4d2));

  // four inflatable island mats, one per player
  const islands: [number, number][] = [
    [-21, -21], [21, -21], [-21, 21], [21, 21],
  ];
  const spawns: Record<Team, THREE.Vector3[]> = { red: [], blue: [] };
  const dmSpawns: THREE.Vector3[] = [];
  islands.forEach(([x, z], i) => {
    add(x, 1.1, z, 15, 2.2, 15, toyMat(cols[i % cols.length]));
    add(x, 2.3, z, 16.4, 0.4, 16.4, toyMat(0xfff3b0), false);
    // little stair so anybody can climb aboard
    add(x - 9.2, 0.55, z, 3.4, 1.1, 6, toyMat(cols[(i + 2) % cols.length]));
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + i;
      const p = new THREE.Vector3(x + Math.cos(a) * 4, 2.6, z + Math.sin(a) * 4);
      dmSpawns.push(p);
      spawns[k % 2 === 0 ? "red" : "blue"].push(p);
    }
    // a beach ball sitting on each island
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(1.5, 18, 14),
      toyMat(i % 2 ? 0xff8ab0 : 0x8ad6ff),
    );
    ball.position.set(x + 4, 3.8, z - 4);
    ball.castShadow = true;
    group.add(ball);
  });

  // the big central float ring, with Quad Giggle on it
  add(0, 0.9, 0, 16, 1.8, 16, toyMat(0xffe14d));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(9.2, 1.5, 12, 34), toyMat(0xff7a8a));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 2;
  ring.castShadow = true;
  group.add(ring);
  add(0, 2.1, 0, 5, 0.6, 5, toyMat(0xc08bff));

  // lily pads: bouncing pads that fling you onto the float or an island
  const jumpPads: JumpPad[] = [];
  const padAt = (x: number, z: number, vy: number, dx: number, dz: number, r = 2.4) => {
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r + 0.4, 0.4, 20),
      new THREE.MeshPhysicalMaterial({
        color: 0x7be08a, emissive: 0x2a8a44, emissiveIntensity: 0.5, roughness: 0.4, clearcoat: 0.8,
      }),
    );
    pad.position.set(x, 0.3, z);
    pad.receiveShadow = true;
    group.add(pad);
    jumpPads.push({
      box: new THREE.Box3(new THREE.Vector3(x - r, 0, z - r), new THREE.Vector3(x + r, 1.5, z + r)),
      velocity: new THREE.Vector3(dx, vy, dz),
    });
  };
  padAt(0, -13, 19, 0, -5);
  padAt(0, 13, 19, 0, 5);
  padAt(-13, 0, 19, -5, 0);
  padAt(13, 0, 19, 5, 0);
  padAt(0, 0, 22, 0, 0, 2.9);

  // ------------------------------------------------------------------ items
  const items: ItemSpawn[] = [];
  const put = (kind: ItemSpawn["kind"], p: [number, number, number], weapon?: WeaponId, respawn = 14) =>
    items.push({ kind, pos: new THREE.Vector3(...p), weapon, respawn });
  put("quad", [0, 3.1, 0], undefined, 45);
  put("milk", [-30, 3, 30], undefined, 50);
  const list: [ItemSpawn["kind"], [number, number, number], WeaponId | undefined, number][] = [
    ["weapon", [-21, 3, -21], "chaingun", 12],
    ["weapon", [21, 3, 21], "chaingun", 12],
    ["weapon", [-21, 3, 21], "rocket", 14],
    ["weapon", [21, 3, -21], "rocket", 14],
    ["weapon", [0, 3.4, -30], "balloon", 14],
    ["weapon", [0, 3.4, 30], "balloon", 14],
    ["weapon", [-30, 3.4, 0], "sniper", 16],
    ["weapon", [30, 3.4, 0], "punch", 16],
    ["ammo", [-28, 3, -28], undefined, 14],
    ["ammo", [28, 3, 28], undefined, 14],
    ["ammo", [28, 3, -28], undefined, 14],
    ["ammo", [-28, 3, 28], undefined, 14],
    ["juice", [-21, 3, -17], undefined, 16],
    ["juice", [21, 3, 17], undefined, 16],
    ["juice", [21, 3, -17], undefined, 16],
    ["juice", [-21, 3, 17], undefined, 16],
    ["megajuice", [-30, 3.4, 12], undefined, 40],
    ["megajuice", [30, 3.4, -12], undefined, 40],
  ];
  for (const [kind, p, w, r] of list) put(kind, p, w, r);
  settleItems(items, boxes, R + 2, R + 2);

  // ------------------------------------------------------------- decorations
  // rubber duckies paddling around the middle, plus a shower-spray arch
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const d = new THREE.Group();
    const bodyD = new THREE.Mesh(new THREE.SphereGeometry(0.8, 14, 10), toyMat(0xffe14d));
    bodyD.scale.set(1, 0.8, 1.25);
    d.add(bodyD);
    d.add(new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 10), toyMat(0xffe97a)).translateY(0.7));
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.36, 8), toyMat(0xff9b3d));
    beak.position.set(0, 0.72, 0.5);
    beak.rotation.x = Math.PI / 2;
    d.add(beak);
    d.position.set(Math.cos(a) * 14, 0.55, Math.sin(a) * 14);
    d.rotation.y = -a + Math.PI / 2;
    group.add(d);
  }
  scatterLights(group, [
    [0, 16, 0, 0xfff6e0, 70],
    [-22, 12, -22, 0xd9f3ff, 44],
    [22, 12, 22, 0xffe6f2, 44],
  ]);

  // ------------------------------------------------------------- waypoints
  const nodes: THREE.Vector3[] = [];
  const idx = (x: number, y: number, z: number) => {
    nodes.push(new THREE.Vector3(x, y, z));
    return nodes.length - 1;
  };
  for (const x of [-30, -21, -12, 0, 12, 21, 30])
    for (const z of [-30, -21, -12, 0, 12, 21, 30]) {
      const onIsland = islands.some(([ix, iz]) => Math.abs(x - ix) < 8 && Math.abs(z - iz) < 8);
      const onFloat = Math.abs(x) < 8 && Math.abs(z) < 8;
      if (onIsland || onFloat) continue;
      idx(x, 0.9, z);
    }
  for (const [ix, iz] of islands) for (const [dx, dz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]] as const) idx(ix + dx, 2.6, iz + dz);
  for (const [dx, dz] of [[-5, 0], [5, 0], [0, -5], [0, 5], [0, 0]] as const) idx(dx, 2.1, dz);
  const waypoints = makeWaypoints(nodes, []);

  const flagStands: Record<Team, THREE.Vector3> = {
    red: new THREE.Vector3(-21, 2.6, -21),
    blue: new THREE.Vector3(21, 2.6, 21),
  };

  return {
    group,
    boxes,
    spawns,
    dmSpawns,
    flagStands,
    items,
    jumpPads,
    waypoints,
    bounds: new THREE.Box3(new THREE.Vector3(-R - 4, -3, -R - 4), new THREE.Vector3(R + 4, 40, R + 4)),
  };
}

export const MAPS: MapDef[] = [
  {
    id: "canyon",
    name: "Canyon Playpen",
    tag: "4v4 Capture the Flag",
    blurb:
      "Bases at opposite ends of a sunlit canyon. Climb the block stairs to the cliff tops, cross the toy bridge, and fight over Quad Giggle.",
    modes: ["ctf"],
    maxPlayers: 8,
    teamSize: 4,
    build: buildArena,
  },
  {
    id: "playpen",
    name: "The Playpen",
    tag: "1v1 Squishmatch · Tutorial",
    blurb:
      "Two perfect cube rooms joined by a long sweeping 90° bend. A gentle place to learn your toys — you'll respawn in whichever room is farthest from trouble.",
    modes: ["dm"],
    maxPlayers: 2,
    teamSize: 0,
    build: buildTutorialArena,
  },
  {
    id: "toybox",
    name: "Toy Box Rumble",
    tag: "2v2 Team Squishmatch",
    blurb:
      "A giant open toy chest: a raised brick in the middle, four corner towers, and a ledge all the way round. Team frags only — the ledge belongs to whoever owns the bounce pads.",
    modes: ["tdm", "ffa"],
    maxPlayers: 4,
    teamSize: 2,
    build: buildToyBoxArena,
  },
  {
    id: "pond",
    name: "Rubber Ducky Pond",
    tag: "4 Player Free For All",
    blurb:
      "A shallow paddling pool of inflatable islands around one big float ring. Lily pads fling you anywhere; every squishy for themselves.",
    modes: ["ffa", "tdm"],
    maxPlayers: 4,
    teamSize: 0,
    build: buildPondArena,
  },
];

export function makeSky(scene: THREE.Scene) {
  scene.background = skyTexture();
  scene.fog = new THREE.Fog(0xcfeaff, 90, 230);
}
