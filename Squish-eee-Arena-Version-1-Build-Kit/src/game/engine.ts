import * as THREE from "three";
import { getSFX } from "./audio";
import { CHARACTERS, buildCharacter, animateChar, type CharKind, type CharParts } from "./models";
import { WEAPONS, WEAPON_ORDER, buildViewModel, buildWeaponPickup, type WeaponId } from "./weapons";
import {
  MAPS,
  makeSky,
  TEAM_COLORS,
  type Arena,
  type GameMode,
  type MapDef,
  type Team,
  type ItemSpawn,
} from "./arena";
import {
  Net,
  type ActorSnap,
  type LobbySlot,
  type NetEvent,
  type NetMsg,
  type PeerId,
  type Snapshot,
} from "./net";
import { applyStudioEnvironment, createSky, makeGlow, makePuff, retileSurfaces } from "./gfx";

const GRAVITY = 22;
const MOVE_SPEED = 10.5;
const AIR_ACCEL = 28;
const GROUND_ACCEL = 95;
const FRICTION = 10;
const JUMP_VEL = 10.6;
const EYE = 2.65;
const RAD = 0.82;
const HEIGHT = 3.35;
const RESPAWN_DELAY = 3;
const CAPTURE_LIMIT = 5;
const MATCH_TIME = 8 * 60;
const FRAG_LIMIT = 10;
const DM_TIME = 5 * 60;

const round = (n: number) => Math.round(n * 1000) / 1000;
const v = (a: [number, number, number]) => new THREE.Vector3(a[0], a[1], a[2]);
/** deterministic RNG so every machine builds the exact same bots from one seed */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** grab the un-patched speak so we can still call it after wrapping it for the wire */
function s2Speak(sfx: { speak: (t: string) => void }) {
  const fn = sfx.speak.bind(sfx);
  return fn as (t: string) => void;
}

export interface NetConfig {
  session: Net;
  role: "host" | "client";
  localPeer: PeerId;
  slots: LobbySlot[];
  botCount: number;
  seed: number;
  mode: GameMode;
}

export interface ScoreRow {
  name: string;
  team: Team;
  kind: CharKind;
  giggles: number;
  caps: number;
  giggledOut: number;
  isPlayer: boolean;
}

export interface HUDState {
  giggle: number;
  weapon: WeaponId;
  ammo: Record<string, number>;
  owned: Record<string, boolean>;
  scores: { red: number; blue: number };
  flagState: { red: FlagState; blue: FlagState };
  carrying: Team | null;
  quad: number;
  respawnIn: number;
  timeLeft: number;
  messages: { id: number; text: string; color: string }[];
  pickup: string | null;
  hit: number;
  hurt: number;
  /** 0..1 how far the player is scoped in (right mouse button) */
  scope: number;
  giggledOut: boolean;
  scoreboard: ScoreRow[];
  winner: Team | null | "tie";
  speed: number;
  teamOfPlayer: Team;
  banner: { text: string; color: string; id: number } | null;
  milkGlow: number;
  mode: GameMode;
  mapName: string;
  limit: number;
  over: boolean;
  mvp: string | null;
  net: boolean;
  isHost: boolean;
  playerScore: number;
  rivalScore: number;
}

type FlagState = "home" | "carried" | "dropped";

interface Actor {
  id: number;
  name: string;
  team: Team;
  kind: CharKind;
  isPlayer: boolean;
  /** which network peer drives this squishy (undefined = bot / solo) */
  peer?: PeerId;
  /** host: the last input packet received for this peer */
  netIn?: { yaw: number; pitch: number; mx: number; mz: number; jump: boolean; fire: boolean; weapon: string };
  /** client: where the host says this squishy should be */
  netPos?: THREE.Vector3;
  netYaw?: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  pitch: number;
  giggle: number;
  alive: boolean;
  respawnAt: number;
  grounded: boolean;
  weapon: WeaponId;
  ammo: Record<string, number>;
  owned: Record<string, boolean>;
  nextFire: number;
  quadUntil: number;
  parts: CharParts;
  gigglesScored: number;
  caps: number;
  outs: number;
  outAt: number;
  /** where this squishy giggled out, so we can respawn far away from it */
  deathPos?: THREE.Vector3;
  carrying: Team | null;
  // bot
  bot?: BotBrain;
  firing: boolean;
  wantJump: boolean;
  moveX: number;
  moveZ: number;
  lastSound: number;
  skill: number;
  light?: THREE.PointLight;
}

interface BotBrain {
  path: number[];
  pathIdx: number;
  repath: number;
  role: "attack" | "defend" | "roam";
  target: Actor | null;
  nextThink: number;
  strafe: number;
  nextStrafe: number;
  reactUntil: number;
  burstUntil: number;
  pauseUntil: number;
  goalPos: THREE.Vector3;
}

interface Projectile {
  mesh: THREE.Object3D;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  gravity: number;
  owner: Actor;
  weapon: WeaponId;
  die: number;
  radius: number;
  quad: boolean;
  age?: number;
  whistle?: { update: (d: number, p: number) => void; stop: () => void };
  bounce?: number;
}

interface Mine {
  mesh: THREE.Object3D;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  owner: Actor;
  /** surface normal the cushion is stuck to */
  normal: THREE.Vector3;
  age: number;
  armAt: number;
  stuck: boolean;
  quad: boolean;
  die: number;
}

interface Effect {
  obj: THREE.Object3D;
  life: number;
  max: number;
  kind: "puff" | "ball" | "ring" | "spark" | "text";
  vel?: THREE.Vector3;
  grav?: number;
  endPos?: THREE.Vector3;
  startPos?: THREE.Vector3;
  onEnd?: () => void;
  spin?: number;
}

interface WorldItem {
  spawn: ItemSpawn;
  obj: THREE.Group;
  active: boolean;
  respawnAt: number;
  bobPhase: number;
}

interface FlagEnt {
  team: Team;
  state: FlagState;
  obj: THREE.Group;
  pos: THREE.Vector3;
  carrier: Actor | null;
  dropAt: number;
}

const BOT_NAMES = [
  "Mr. Wigglebottom",
  "Captain Drool",
  "Sir Bonkers",
  "Lady Nibbles",
  "Professor Boop",
  "Tiny Tornado",
  "Admiral Snuggles",
  "Doctor Wobble",
  "Jellybean",
  "Pickles",
];

// ----------------------------------------------------------------- helpers
function rayBox(o: THREE.Vector3, d: THREE.Vector3, b: THREE.Box3): number | null {
  let tmin = -Infinity;
  let tmax = Infinity;
  const oa = [o.x, o.y, o.z];
  const da = [d.x, d.y, d.z];
  const mn = [b.min.x, b.min.y, b.min.z];
  const mx = [b.max.x, b.max.y, b.max.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(da[i]) < 1e-8) {
      if (oa[i] < mn[i] || oa[i] > mx[i]) return null;
    } else {
      let t1 = (mn[i] - oa[i]) / da[i];
      let t2 = (mx[i] - oa[i]) / da[i];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  if (tmax < 0) return null;
  return tmin >= 0 ? tmin : tmax;
}

function rayActor(o: THREE.Vector3, d: THREE.Vector3, a: Actor): number | null {
  const r = RAD;
  const dx = o.x - a.pos.x;
  const dz = o.z - a.pos.z;
  const A = d.x * d.x + d.z * d.z;
  const B = 2 * (dx * d.x + dz * d.z);
  const C = dx * dx + dz * dz - r * r;
  // already inside the squishy's cylinder (point blank) → immediate hit
  if (C <= 0 && o.y >= a.pos.y - 0.1 && o.y <= a.pos.y + HEIGHT + 0.15) return 0;
  if (A < 1e-8) return null;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  for (const t of [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]) {
    if (t < 0) continue;
    const y = o.y + d.y * t;
    if (y >= a.pos.y - 0.1 && y <= a.pos.y + HEIGHT + 0.15) return t;
  }
  return null;
}

interface Sweep {
  /** distance travelled along the ray before touching */
  t: number;
  /** surface normal at the contact */
  nx: number;
  ny: number;
  nz: number;
}

/**
 * Sweeps a sphere of radius `r` along a ray against every solid box.
 * Returns the FIRST contact within maxDist, or null when the path is clear.
 * (Unlike a plain ray test there is no "no-hit looks like a hit" sentinel value.)
 * If the sphere already overlaps a box it counts as an immediate contact (t = 0).
 */
function sweepBoxes(
  boxes: THREE.Box3[],
  o: THREE.Vector3,
  d: THREE.Vector3,
  maxDist: number,
  r: number,
): Sweep | null {
  let best: Sweep | null = null;
  const oa = [o.x, o.y, o.z];
  const da = [d.x, d.y, d.z];
  for (const b of boxes) {
    const mn = [b.min.x - r, b.min.y - r, b.min.z - r];
    const mx = [b.max.x + r, b.max.y + r, b.max.z + r];
    // cheap reject
    if (
      (oa[0] < mn[0] && da[0] <= 0) || (oa[0] > mx[0] && da[0] >= 0) ||
      (oa[1] < mn[1] && da[1] <= 0) || (oa[1] > mx[1] && da[1] >= 0) ||
      (oa[2] < mn[2] && da[2] <= 0) || (oa[2] > mx[2] && da[2] >= 0)
    )
      continue;
    // already inside the (inflated) box?
    if (
      oa[0] > mn[0] && oa[0] < mx[0] &&
      oa[1] > mn[1] && oa[1] < mx[1] &&
      oa[2] > mn[2] && oa[2] < mx[2]
    ) {
      // push out along the nearest face
      const pen = [
        oa[0] - mn[0], mx[0] - oa[0],
        oa[1] - mn[1], mx[1] - oa[1],
        oa[2] - mn[2], mx[2] - oa[2],
      ];
      let k = 0;
      for (let i = 1; i < 6; i++) if (pen[i] < pen[k]) k = i;
      const n = [0, 0, 0];
      n[k >> 1] = k % 2 === 0 ? -1 : 1;
      return { t: 0, nx: n[0], ny: n[1], nz: n[2] };
    }
    let tNear = -Infinity;
    let tFar = Infinity;
    let axis = -1;
    let sign = 0;
    let miss = false;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(da[i]) < 1e-9) {
        if (oa[i] < mn[i] || oa[i] > mx[i]) {
          miss = true;
          break;
        }
        continue;
      }
      let t1 = (mn[i] - oa[i]) / da[i];
      let t2 = (mx[i] - oa[i]) / da[i];
      let s = -1; // entering through the min face → normal points toward -axis
      if (t1 > t2) {
        [t1, t2] = [t2, t1];
        s = 1;
      }
      if (t1 > tNear) {
        tNear = t1;
        axis = i;
        sign = s;
      }
      if (t2 < tFar) tFar = t2;
      if (tNear > tFar) {
        miss = true;
        break;
      }
    }
    if (miss || axis < 0 || tNear < 0 || tNear > maxDist) continue;
    if (!best || tNear < best.t) {
      const n = [0, 0, 0];
      n[axis] = sign;
      best = { t: tNear, nx: n[0], ny: n[1], nz: n[2] };
    }
  }
  return best;
}

export class Game {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  arena!: Arena;
  actors: Actor[] = [];
  player!: Actor;
  projectiles: Projectile[] = [];
  mines: Mine[] = [];
  effects: Effect[] = [];
  items: WorldItem[] = [];
  flags: Record<Team, FlagEnt> = {} as any;
  scores: Record<Team, number> = { red: 0, blue: 0 };
  sfx = getSFX();
  clock = new THREE.Clock();
  time = 0;
  matchEnd = MATCH_TIME;
  winner: Team | null | "tie" = null;
  over = false;
  mvp: string | null = null;
  keys: Record<string, boolean> = {};
  mouseDown = false;
  vm?: {
    group: THREE.Group;
    muzzle: THREE.Object3D;
    spin?: THREE.Object3D;
    punchGlove?: THREE.Group;
    punchSpring?: THREE.Group;
  };
  vmHolder = new THREE.Group();
  vmKick = 0;
  bobT = 0;
  hud: (s: HUDState) => void;
  messages: { id: number; text: string; color: string; t: number }[] = [];
  msgId = 1;
  pickupText: { text: string; t: number } | null = null;
  hitMarker = -9;
  playerHurt = -9;
  /** right mouse button held */
  scopeHeld = false;
  /** 0 = hip-fire … 1 = fully scoped (eased) */
  scopeAmt = 0;
  readonly baseFov = 85;
  punchStartedAt = -10;
  /** muzzle flash halo shown in first person when firing */
  flashSprite = makeGlow(0xffffff, 1, 0);
  flashUntil = -9;
  environmentTexture?: THREE.Texture;
  playerKind!: CharKind;
  actorSeq = 0;
  /** Horizontal broadphase for arena collision boxes. */
  readonly collisionCellSize = 12;
  collisionGrid = new Map<string, THREE.Box3[]>();
  private collisionBoxIndices = new WeakMap<THREE.Box3, number>();
  private collisionStamps = new Uint32Array(0);
  private collisionQuerySerial = 0;
  private collisionScratch: THREE.Box3[] = [];
  // ---- networking ----
  net?: Net;
  netCfg?: NetConfig;
  isClient = false;
  peerToActor = new Map<PeerId, number>();
  pendingEvents: NetEvent[] = [];
  lastSnapSend = 0;
  lastInputSend = 0;
  bannerUntil = 0;
  netTimeLeft?: number;
  netWeapon?: WeaponId;
  sky!: THREE.Object3D;
  /** Adaptive internal resolution keeps the game smooth on integrated GPUs. */
  maxPixelRatio = 1;
  resolutionScale = 1;
  averageFrameMs = 16.7;
  lastResolutionCheck = 0;
  viewWidth = 1;
  viewHeight = 1;
  playerSpree = 0;
  banner: { text: string; color: string; id: number; until: number } | null = null;
  bannerId = 1;
  milkGlowUntil = 0;
  running = true;

  triggerBanner(text: string, color = "#ffd34d", duration = 2.4) {
    this.banner = { text, color, id: this.bannerId++, until: this.time + duration };
    this.emit({ k: "banner", text, color });
  }
  chainLoop = this.sfx.fartLoop();
  waterLoop = this.sfx.waterStream();
  beamMesh!: THREE.Mesh;
  muzzleLight!: THREE.PointLight;
  lastHudEmit = 0;
  disposed = false;
  paused = false;
  killFeedId = 1;
  sunLight!: THREE.DirectionalLight;
  quadTint!: THREE.Mesh;

  mode: GameMode;
  mapName: string;
  mapDef!: MapDef;
  limit: number;

  constructor(
    canvas: HTMLCanvasElement,
    playerKind: CharKind,
    mapId: string,
    hud: (s: HUDState) => void,
    net?: NetConfig,
  ) {
    this.hud = hud;
    this.playerKind = playerKind;
    const map = MAPS.find((m) => m.id === mapId) ?? MAPS[0];
    this.mapDef = map;
    this.mode = net?.mode ?? map.modes[0];
    if (net) {
      this.net = net.session;
      this.netCfg = net;
      this.isClient = net.role === "client";
    }
    this.mapName = map.name;
    this.limit = this.mode === "ctf" ? CAPTURE_LIMIT : FRAG_LIMIT;
    this.matchEnd = this.mode === "ctf" ? MATCH_TIME : DM_TIME;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    this.viewWidth = canvas.clientWidth;
    this.viewHeight = canvas.clientHeight;
    this.renderer.setPixelRatio(this.maxPixelRatio);
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.93;

    this.scene = new THREE.Scene();
    makeSky(this.scene);
    this.camera = new THREE.PerspectiveCamera(85, canvas.clientWidth / canvas.clientHeight, 0.05, 2000);

    this.setupLights();
    this.arena = map.build();
    this.buildCollisionGrid();
    retileSurfaces(this.arena.group); // real-world-scale textures on every block
    this.scene.add(this.arena.group);
    this.buildItems();
    if (this.mode === "ctf") this.buildFlags();
    if (net) this.spawnFromRoster(net);
    else this.spawnTeams(playerKind);
    if (net) this.bindNet(net);
    this.setupViewModel();

    const beamGeo = new THREE.CylinderGeometry(0.075, 0.13, 1, 8, 1, true);
    beamGeo.translate(0, 0.5, 0);
    beamGeo.rotateX(Math.PI / 2);
    this.beamMesh = new THREE.Mesh(
      beamGeo,
      new THREE.MeshBasicMaterial({ color: 0x9df3ff, transparent: true, opacity: 0.75, depthWrite: false }),
    );
    this.beamMesh.visible = false;
    this.scene.add(this.beamMesh);

    this.muzzleLight = new THREE.PointLight(0xffffff, 0, 14);
    this.scene.add(this.muzzleLight);

    // Studio reflections retain plastic specular quality without post-process targets.
    this.environmentTexture = applyStudioEnvironment(this.renderer, this.scene, 0.6);
    this.sky = createSky();
    this.scene.add(this.sky);
  }

  // --------------------------------------------------------------- setup
  setupLights() {
    const hemi = new THREE.HemisphereLight(0xcfefff, 0xffd9a0, 0.6);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff0d2, 1.95);
    sun.position.set(45, 70, 35);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const c = sun.shadow.camera as THREE.OrthographicCamera;
    c.left = -90;
    c.right = 90;
    c.top = 70;
    c.bottom = -70;
    c.near = 1;
    c.far = 260;
    sun.shadow.bias = -0.0012;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sunLight = sun;
  }

  setupViewModel() {
    this.camera.add(this.vmHolder);
    this.scene.add(this.camera);
    this.equipViewModel("pistol");
  }

  private disposeViewModel() {
    const old = this.vm?.group;
    if (!old) return;
    old.traverse((o) => {
      // The flash sprite is reused and reparented to the next weapon's muzzle.
      if (o === this.flashSprite) return;
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry?.dispose();
      if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose());
      else mesh.material?.dispose();
    });
  }

  equipViewModel(id: WeaponId) {
    this.disposeViewModel();
    this.vmHolder.clear();
    const vm = buildViewModel(id);
    vm.group.position.set(0.28, -0.26, -0.45);
    vm.group.scale.setScalar(0.85);
    vm.muzzle.add(this.flashSprite);
    this.vmHolder.add(vm.group);
    this.vm = vm;
  }

  buildItems() {
    for (const sp of this.arena.items) {
      const obj = this.makeItemMesh(sp);
      obj.position.copy(sp.pos);
      this.scene.add(obj);
      this.items.push({ spawn: sp, obj, active: true, respawnAt: 0, bobPhase: Math.random() * 6.28 });
    }
  }

  makeItemMesh(sp: ItemSpawn): THREE.Group {
    const g = new THREE.Group();
    if (sp.kind === "weapon" && sp.weapon) {
      const w = buildWeaponPickup(sp.weapon);
      g.add(w);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.1, 0.07, 8, 24),
        new THREE.MeshBasicMaterial({ color: WEAPONS[sp.weapon].color, transparent: true, opacity: 0.7 }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -0.5;
      g.add(ring);
    } else if (sp.kind === "ammo") {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(0.75, 0.6, 0.75),
        new THREE.MeshPhysicalMaterial({ color: 0xffd34d, roughness: 0.3, clearcoat: 1 }),
      );
      g.add(box);
      for (const s of [-1, 1]) {
        const ball = new THREE.Mesh(
          new THREE.SphereGeometry(0.17, 10, 8),
          new THREE.MeshPhysicalMaterial({ color: s > 0 ? 0xff5b8a : 0x5ad7ff, roughness: 0.2, clearcoat: 1 }),
        );
        ball.position.set(s * 0.2, 0.4, 0);
        g.add(ball);
      }
    } else if (sp.kind === "juice" || sp.kind === "megajuice") {
      const big = sp.kind === "megajuice";
      const s = big ? 1.5 : 1;
      const bottle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3 * s, 0.34 * s, 0.8 * s, 14),
        new THREE.MeshPhysicalMaterial({
          color: big ? 0x6effa8 : 0x8ad6ff,
          roughness: 0.1,
          transmission: 0.5,
          thickness: 0.4,
          clearcoat: 1,
        }),
      );
      g.add(bottle);
      const cap = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16 * s, 0.16 * s, 0.22 * s, 10),
        new THREE.MeshPhysicalMaterial({ color: 0xff5b8a, roughness: 0.3, clearcoat: 1 }),
      );
      cap.position.y = 0.5 * s;
      g.add(cap);
      const straw = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05 * s, 0.05 * s, 0.7 * s, 8),
        new THREE.MeshBasicMaterial({ color: 0xffffff }),
      );
      straw.position.set(0.12 * s, 0.75 * s, 0);
      straw.rotation.z = 0.3;
      g.add(straw);
    } else if (sp.kind === "quad") {
      const core = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.85, 1),
        new THREE.MeshPhysicalMaterial({
          color: 0xb469ff,
          emissive: 0x7a2aff,
          emissiveIntensity: 1.1,
          roughness: 0.15,
          clearcoat: 1,
        }),
      );
      g.add(core);
      const halo = new THREE.Mesh(
        new THREE.TorusGeometry(1.3, 0.1, 8, 28),
        new THREE.MeshBasicMaterial({ color: 0xe0b3ff, transparent: true, opacity: 0.8 }),
      );
      halo.rotation.x = Math.PI / 2.4;
      g.add(halo);
      const l = new THREE.PointLight(0xa44dff, 3.5, 22);
      g.add(l);
    } else if (sp.kind === "milk") {
      // Warm Baby Milk Bottle (full-team mega health!)
      // Translucent baby bottle with measurement notches, warm glowing white milk inside,
      // cute ring collar, soft rubber teat nipple, and rotating golden ring
      const bottle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.42, 0.48, 1.25, 16),
        new THREE.MeshPhysicalMaterial({
          color: 0xffffff,
          roughness: 0.12,
          transmission: 0.65,
          thickness: 0.4,
          clearcoat: 1,
        }),
      );
      g.add(bottle);

      // Warm glowing milk liquid inside
      const milkCore = new THREE.Mesh(
        new THREE.CylinderGeometry(0.38, 0.44, 1.05, 14),
        new THREE.MeshStandardMaterial({
          color: 0xfffbee,
          emissive: 0xffeed4,
          emissiveIntensity: 0.85,
          roughness: 0.3,
        }),
      );
      milkCore.position.y = -0.06;
      g.add(milkCore);

      // Measurement graduation lines (oz/ml notches)
      for (let i = 0; i < 4; i++) {
        const notch = new THREE.Mesh(
          new THREE.BoxGeometry(0.14, 0.03, 0.05),
          new THREE.MeshBasicMaterial({ color: 0x3d7099 }),
        );
        notch.position.set(0.44, -0.34 + i * 0.24, 0);
        g.add(notch);
      }

      // Bottle collar ring (pastel pink or yellow)
      const collar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.4, 0.42, 0.22, 14),
        new THREE.MeshPhysicalMaterial({ color: 0xff8ab0, roughness: 0.25, clearcoat: 1 }),
      );
      collar.position.y = 0.7;
      g.add(collar);

      // Soft rubber silicone teat / nipple
      const teatBase = new THREE.Mesh(
        new THREE.CylinderGeometry(0.2, 0.32, 0.32, 12),
        new THREE.MeshPhysicalMaterial({
          color: 0xffd9a0,
          roughness: 0.5,
          transmission: 0.25,
          clearcoat: 0.8,
        }),
      );
      teatBase.position.y = 0.94;
      g.add(teatBase);
      const teatTip = new THREE.Mesh(
        new THREE.SphereGeometry(0.14, 10, 8),
        new THREE.MeshPhysicalMaterial({ color: 0xffd9a0, roughness: 0.4 }),
      );
      teatTip.position.y = 1.12;
      g.add(teatTip);

      // Rotating sparkle ring
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.2, 0.07, 8, 24),
        new THREE.MeshBasicMaterial({ color: 0xfff0aa, transparent: true, opacity: 0.85 }),
      );
      ring.rotation.x = Math.PI / 2.3;
      ring.position.y = 0.15;
      g.add(ring);

      const light = new THREE.PointLight(0xfff4aa, 3.2, 18);
      light.position.y = 0.4;
      g.add(light);
    }
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    return g;
  }

  makeFlagMesh(team: Team): THREE.Group {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, 2.2, 10),
      new THREE.MeshPhysicalMaterial({ color: 0xfff1cf, roughness: 0.3, clearcoat: 1 }),
    );
    pole.position.y = 1.1;
    g.add(pole);
    const cloth = new THREE.Mesh(
      new THREE.PlaneGeometry(1.25, 0.85, 8, 4),
      new THREE.MeshStandardMaterial({
        color: TEAM_COLORS[team],
        roughness: 0.85,
        side: THREE.DoubleSide,
        emissive: new THREE.Color(TEAM_COLORS[team]).multiplyScalar(0.25),
      }),
    );
    cloth.position.set(0.65, 1.7, 0);
    g.add(cloth);
    // plush star on top
    const star = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.22, 0),
      new THREE.MeshPhysicalMaterial({ color: 0xfff06a, roughness: 0.25, clearcoat: 1 }),
    );
    star.position.y = 2.3;
    g.add(star);
    const glow = new THREE.PointLight(TEAM_COLORS[team], 2.2, 14);
    glow.position.y = 1.6;
    g.add(glow);
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    return g;
  }

  buildFlags() {
    (["red", "blue"] as Team[]).forEach((t) => {
      const obj = this.makeFlagMesh(t);
      obj.position.copy(this.arena.flagStands[t]);
      this.scene.add(obj);
      this.flags[t] = {
        team: t,
        state: "home",
        obj,
        pos: this.arena.flagStands[t].clone(),
        carrier: null,
        dropAt: 0,
      };
    });
  }

  makeNameTag(name: string, team: Team): THREE.Sprite {
    const cv = document.createElement("canvas");
    cv.width = 256;
    cv.height = 64;
    const c = cv.getContext("2d")!;
    c.font = "bold 30px system-ui, sans-serif";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.lineWidth = 7;
    c.strokeStyle = "rgba(0,0,0,0.65)";
    c.strokeText(name, 128, 32);
    c.fillStyle = team === "red" ? "#ff9fb4" : "#9fd0ff";
    c.fillText(name, 128, 32);
    const tex = new THREE.CanvasTexture(cv);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true }));
    sp.scale.set(2.6, 0.65, 1);
    return sp;
  }

  /** Builds one squishy. Shared by the solo spawner and the network roster spawner. */
  createActor(
    team: Team,
    isPlayer: boolean,
    kind: CharKind,
    name: string,
    skill: number,
    peer?: string,
    withTag = true,
  ): Actor {
    {
      const parts = buildCharacter(kind, TEAM_COLORS[team]);
      this.scene.add(parts.group);
      if (!isPlayer && withTag) {
        const tag = this.makeNameTag(name, team);
        tag.position.y = 4.1;
        parts.group.add(tag);
      }
      const a: Actor = {
        id: this.actorSeq++,
        peer,
        name,
        team,
        kind,
        isPlayer,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        yaw: team === "red" ? 0 : Math.PI,
        pitch: 0,
        giggle: 0,
        alive: true,
        respawnAt: 0,
        grounded: false,
        weapon: "pistol",
        ammo: {},
        owned: {},
        nextFire: 0,
        quadUntil: 0,
        parts,
        gigglesScored: 0,
        caps: 0,
        outs: 0,
        outAt: 0,
        carrying: null,
        firing: false,
        wantJump: false,
        moveX: 0,
        moveZ: 0,
        lastSound: 0,
        skill,
      };
      for (const w of WEAPON_ORDER) {
        a.owned[w] = w === "pistol";
        a.ammo[w] = WEAPONS[w].startAmmo === Infinity ? 999 : WEAPONS[w].startAmmo;
      }
      if (!isPlayer && !peer) {
        a.bot = {
          path: [],
          pathIdx: 0,
          repath: 0,
          role: "attack",
          target: null,
          nextThink: 0,
          strafe: 0,
          nextStrafe: 0,
          reactUntil: 0,
          burstUntil: 0,
          pauseUntil: 0,
          goalPos: new THREE.Vector3(),
        };
      }
      this.actors.push(a);
      // clients get everyone else from the host; each machine places its OWN
      // player so it doesn't start at the world origin before the first snapshot
      if (!this.isClient || isPlayer) this.respawn(a, true);
      return a;
    }
  }

  spawnTeams(playerKind: CharKind) {
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    const kinds = CHARACTERS.map((c) => c.kind);
    const make = (team: Team, isPlayer: boolean, kind: CharKind, name: string, skill: number) =>
      this.createActor(team, isPlayer, kind, name, skill, undefined, !isPlayer);

    // every solo match fills the map's designed roster: you, plus bots
    const perTeam = this.mapDef.teamSize;
    const total = this.mapDef.maxPlayers;
    const duel = total <= 2;
    this.player = make("red", true, playerKind, duel ? "You" : "You", 1);

    const roles: BotBrain["role"][] = ["attack", "attack", "defend", "roam"];
    let made = 1;
    let reds = 1;
    for (let i = 0; made < total; i++) {
      // team play fills red first then blue; free-for-all just alternates colours
      const team: Team = perTeam > 0 ? (reds < perTeam ? "red" : "blue") : made % 2 === 0 ? "red" : "blue";
      if (team === "red") reds++;
      const b = make(
        team,
        false,
        kinds[(made + 1) % kinds.length],
        duel ? "Wobbles" : names[made % names.length],
        duel ? 0.09 : 0.16 + Math.random() * 0.13,
      );
      b.bot!.role = this.mode === "ctf" ? roles[i % 3] : "roam";
      made++;
    }
  }

  /**
   * Network play: everyone in the lobby becomes a squishy, and bots top the match
   * up to the map's designed player count.
   */
  /**
   * Network play: the host builds the FULL roster (humans + the bots that top the
   * match up to the map's size) and ships it in the start packet. Every machine
   * runs this same roster, so all machines create identical squishies — bots
   * included — from the shared seed.
   */
  spawnFromRoster(net: NetConfig) {
    const kinds = CHARACTERS.map((c) => c.kind);
    const rnd = mulberry32(net.seed);
    for (const s of net.slots) {
      const me = s.peer === net.localPeer;
      const isBot = s.bot === true;
      // the local player is always whatever squishy they're currently set to
      const kindFor = me ? this.playerKind : (s.kind as CharKind) ?? kinds[0];
      const a = this.createActor(
        s.team,
        me,
        kindFor,
        me ? "You" : s.name,
        isBot ? (this.mode === "dm" ? 0.09 : 0.18 + rnd() * 0.12) : 1,
        isBot ? undefined : s.peer,
        !me,
      );
      if (me) this.player = a;
      if (a.bot) a.bot!.role = this.mode === "ctf" ? (a.id % 3 === 2 ? "defend" : "attack") : "roam";
    }
    if (!this.player) {
      // never expected, but a missing local squishy would break the camera
      this.player = this.actors.find((x) => x.peer === net.localPeer) ?? this.actors[0];
      if (this.player) this.player.isPlayer = true;
    }
  }

  // ------------------------------------------------------------- spawning
  /**
   * Picks a spawn point. If we know where the giggle-out happened, respawn at
   * whichever point is FARTHEST from it — so a squishy always comes back in the
   * other room, never right on top of whoever just tickled them.
   */
  respawn(a: Actor, initial = false, deathPos?: THREE.Vector3) {
    const list = this.arena.spawns[a.team];
    let best = list[0];
    if (deathPos) {
      let bd = -Infinity;
      for (const s of list) {
        const d = s.distanceToSquared(deathPos);
        // a whisker of randomness so ties between the far room's points vary
        const score = d + Math.random() * 4;
        if (score > bd) {
          bd = score;
          best = s;
        }
      }
    } else {
      best = list[Math.floor(Math.random() * list.length)];
      let bestScore = -Infinity;
      for (const s of list) {
        let score = Math.random() * 4;
        for (const o of this.actors) {
          if (o === a || !o.alive) continue;
          const d = o.pos.distanceTo(s);
          score += o.team === a.team ? Math.min(d, 12) * 0.2 : Math.min(d, 40) * 0.5;
        }
        if (score > bestScore) {
          bestScore = score;
          best = s;
        }
      }
    }
    a.pos.copy(best);
    a.pos.y += 0.2;
    a.vel.set(0, 0, 0);
    a.giggle = 0;
    a.alive = true;
    a.yaw = a.team === "red" ? Math.PI / 2 : -Math.PI / 2;
    a.pitch = 0;
    a.quadUntil = 0;
    a.carrying = null;
    for (const w of WEAPON_ORDER) {
      a.owned[w] = w === "pistol";
      a.ammo[w] = w === "pistol" ? 999 : 0;
    }
    a.weapon = "pistol";
    a.parts.group.visible = true;
    a.parts.group.rotation.set(0, 0, 0);
    this.emit({ k: "respawn", a: a.id });
    if (a.isPlayer) {
      this.equipViewModel("pistol");
      if (!initial) this.sfx.boing(1.4, 0.7);
    }
  }

  // ------------------------------------------------------------ collision
  private cellKey(x: number, z: number) {
    return `${x},${z}`;
  }

  private nextCollisionStamp() {
    this.collisionQuerySerial = (this.collisionQuerySerial + 1) >>> 0;
    if (this.collisionQuerySerial === 0) {
      this.collisionStamps.fill(0);
      this.collisionQuerySerial = 1;
    }
    return this.collisionQuerySerial;
  }

  /** Build a 2D static broadphase once; only world boxes touching nearby cells
   * will be tested during player collision or a hitscan ray. */
  buildCollisionGrid() {
    const size = this.collisionCellSize;
    this.collisionGrid.clear();
    this.collisionBoxIndices = new WeakMap<THREE.Box3, number>();
    this.collisionStamps = new Uint32Array(this.arena.boxes.length);
    this.arena.boxes.forEach((box, index) => {
      this.collisionBoxIndices.set(box, index);
      const x0 = Math.floor(box.min.x / size);
      const x1 = Math.floor(box.max.x / size);
      const z0 = Math.floor(box.min.z / size);
      const z1 = Math.floor(box.max.z / size);
      for (let x = x0; x <= x1; x++) {
        for (let z = z0; z <= z1; z++) {
          const key = this.cellKey(x, z);
          const list = this.collisionGrid.get(key);
          if (list) list.push(box);
          else this.collisionGrid.set(key, [box]);
        }
      }
    });
  }

  /** Collect unique boxes intersecting a small horizontal region. */
  collisionCandidates(pos: THREE.Vector3, pad: number): THREE.Box3[] {
    const size = this.collisionCellSize;
    const x0 = Math.floor((pos.x - pad) / size);
    const x1 = Math.floor((pos.x + pad) / size);
    const z0 = Math.floor((pos.z - pad) / size);
    const z1 = Math.floor((pos.z + pad) / size);
    const out = this.collisionScratch;
    out.length = 0;
    const stamp = this.nextCollisionStamp();
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const list = this.collisionGrid.get(this.cellKey(x, z));
        if (!list) continue;
        for (const box of list) {
          const id = this.collisionBoxIndices.get(box);
          if (id === undefined || this.collisionStamps[id] === stamp) continue;
          this.collisionStamps[id] = stamp;
          out.push(box);
        }
      }
    }
    return out;
  }

  collide(pos: THREE.Vector3, vel: THREE.Vector3, dt: number): boolean {
    // One query includes the current point plus this frame's maximum movement
    // and step-up distance, avoiding repeated scans across every map box.
    const pad = RAD + Math.hypot(vel.x, vel.z) * dt + 0.95;
    const boxes = this.collisionGrid.size
      ? this.collisionCandidates(pos, pad)
      : this.arena.boxes;
    let grounded = false;
    const overlaps = (p: THREE.Vector3, b: THREE.Box3) =>
      p.x + RAD > b.min.x &&
      p.x - RAD < b.max.x &&
      p.z + RAD > b.min.z &&
      p.z - RAD < b.max.z &&
      p.y + HEIGHT > b.min.y &&
      p.y < b.max.y;

    // Y
    pos.y += vel.y * dt;
    for (const b of boxes) {
      if (!overlaps(pos, b)) continue;
      if (vel.y <= 0 && pos.y > b.max.y - 0.8) {
        pos.y = b.max.y;
        vel.y = 0;
        grounded = true;
      } else if (vel.y > 0) {
        pos.y = b.min.y - HEIGHT - 0.001;
        vel.y = -1;
      } else {
        pos.y = b.max.y;
        vel.y = 0;
        grounded = true;
      }
    }
    // horizontal with step-up
    const axes: ("x" | "z")[] = ["x", "z"];
    for (const ax of axes) {
      const before = pos[ax];
      pos[ax] += vel[ax] * dt;
      for (const b of boxes) {
        if (!overlaps(pos, b)) continue;
        const stepH = b.max.y - pos.y;
        if (stepH > 0 && stepH <= 0.85) {
          const test = pos.clone();
          test.y = b.max.y + 0.02;
          let ok = true;
          for (const b2 of boxes) {
            if (b2 === b) continue;
            if (overlaps(test, b2)) {
              ok = false;
              break;
            }
          }
          if (ok) {
            pos.y = b.max.y + 0.02;
            grounded = true;
            continue;
          }
        }
        pos[ax] = before;
        vel[ax] *= 0.2;
        break;
      }
    }
    // world bounds
    const bd = this.arena.bounds;
    pos.x = THREE.MathUtils.clamp(pos.x, bd.min.x + 1, bd.max.x - 1);
    pos.z = THREE.MathUtils.clamp(pos.z, bd.min.z + 1, bd.max.z - 1);
    if (pos.y < -4) {
      pos.y = -4;
      vel.y = 0;
      grounded = true;
    }
    return grounded;
  }

  traceWorld(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): number {
    let t = maxDist;
    if (!this.collisionGrid.size || maxDist <= 0) {
      for (const b of this.arena.boxes) {
        const h = rayBox(origin, dir, b);
        if (h !== null && h < t) t = h;
      }
      return t;
    }

    // Sample at half a cell so a diagonal ray cannot skip a voxel; each box is
    // ray-tested at most once, even when it spans many cells (e.g. the floor).
    const stride = this.collisionCellSize * 0.45;
    const stamp = this.nextCollisionStamp();
    for (let d = 0; d <= t; d += stride) {
      const x = Math.floor((origin.x + dir.x * d) / this.collisionCellSize);
      const z = Math.floor((origin.z + dir.z * d) / this.collisionCellSize);
      const list = this.collisionGrid.get(this.cellKey(x, z));
      if (!list) continue;
      for (const b of list) {
        const id = this.collisionBoxIndices.get(b);
        if (id === undefined || this.collisionStamps[id] === stamp) continue;
        this.collisionStamps[id] = stamp;
        const h = rayBox(origin, dir, b);
        if (h !== null && h < t) t = h;
      }
    }
    return t;
  }

  canSee(a: Actor, b: Actor): boolean {
    const o = new THREE.Vector3(a.pos.x, a.pos.y + EYE, a.pos.z);
    const target = new THREE.Vector3(b.pos.x, b.pos.y + 1.8, b.pos.z);
    const dir = target.clone().sub(o);
    const dist = dir.length();
    dir.normalize();
    return this.traceWorld(o, dir, dist) >= dist - 0.3;
  }

  /** In free-for-all, every other squishy is a valid target regardless of colour. */
  areOpponents(a: Actor, b: Actor) {
    return this.mode === "ffa" ? a !== b : a.team !== b.team;
  }

  // ---------------------------------------------------------------- input
  bindInput(el: HTMLElement) {
    const kd = (e: KeyboardEvent) => {
      this.keys[e.code] = true;
      if (e.code.startsWith("Digit")) {
        const n = parseInt(e.code.slice(5), 10);
        const w = WEAPON_ORDER.find((x) => WEAPONS[x].slot === n);
        if (w) this.trySwitch(w);
      }
      if (e.code === "KeyQ") this.cycleWeapon(-1);
      if (e.code === "KeyE") this.cycleWeapon(1);
      if (["Space", "Tab", "KeyW", "KeyA", "KeyS", "KeyD"].includes(e.code)) e.preventDefault();
    };
    const ku = (e: KeyboardEvent) => {
      this.keys[e.code] = false;
    };
    const mm = (e: MouseEvent) => {
      if (document.pointerLockElement !== el) return;
      // turn speed scales with zoom so a 4x scope doesn't feel twitchy
      const zoom =
        Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) /
        Math.tan(THREE.MathUtils.degToRad(this.baseFov / 2));
      const s = 0.0022 * zoom;
      this.player.yaw -= e.movementX * s;
      this.player.pitch -= e.movementY * s;
      this.player.pitch = THREE.MathUtils.clamp(this.player.pitch, -1.45, 1.45);
    };
    const md = (e: MouseEvent) => {
      if (e.button === 0) this.mouseDown = true;
      if (e.button === 2 && !this.scopeHeld) {
        this.scopeHeld = true;
        if (this.player.alive && !this.paused) this.sfx.squeak(1.9, 0.22);
      }
    };
    const mu = (e: MouseEvent) => {
      if (e.button === 0) this.mouseDown = false;
      if (e.button === 2 && this.scopeHeld) {
        this.scopeHeld = false;
        if (this.player.alive && !this.paused) this.sfx.squeak(1.2, 0.15);
      }
    };
    const wheel = (e: WheelEvent) => {
      this.cycleWeapon(e.deltaY > 0 ? 1 : -1);
    };
    const ctx = (e: Event) => e.preventDefault();
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    window.addEventListener("mousemove", mm);
    window.addEventListener("mousedown", md);
    window.addEventListener("mouseup", mu);
    window.addEventListener("wheel", wheel, { passive: true });
    el.addEventListener("contextmenu", ctx);
    return () => {
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("mousemove", mm);
      window.removeEventListener("mousedown", md);
      window.removeEventListener("mouseup", mu);
      window.removeEventListener("wheel", wheel);
      el.removeEventListener("contextmenu", ctx);
    };
  }

  /** Called when the pointer is released/paused so nothing stays "held". */
  releaseInputs() {
    this.mouseDown = false;
    this.scopeHeld = false;
    this.keys = {};
  }

  trySwitch(w: WeaponId) {
    const p = this.player;
    if (!p.owned[w] || p.weapon === w) return;
    p.weapon = w;
    this.equipViewModel(w);
    this.sfx.blip(1.2, 0.35);
    this.vmKick = 0.35;
  }

  cycleWeapon(dir: number) {
    const p = this.player;
    const owned = WEAPON_ORDER.filter((w) => p.owned[w]);
    const i = owned.indexOf(p.weapon);
    const next = owned[(i + dir + owned.length) % owned.length];
    this.trySwitch(next);
  }

  // --------------------------------------------------------------- combat
  weaponOrigin(a: Actor, dir: THREE.Vector3) {
    const o = new THREE.Vector3(a.pos.x, a.pos.y + EYE - (a.isPlayer ? 0.08 : 0), a.pos.z);
    return o.add(dir.clone().multiplyScalar(0.55));
  }

  /**
   * Where a projectile of the given radius begins its life: at the muzzle — unless
   * a wall sits between the shooter's eye and the muzzle, in which case it starts at
   * the wall (so it can never be born on the far side of a thin wall).
   * Projectiles never hit their owner or teammates directly, so no spawn nudging is needed.
   */
  projectileStart(a: Actor, origin: THREE.Vector3, radius: number): THREE.Vector3 {
    const eye = new THREE.Vector3(a.pos.x, a.pos.y + EYE, a.pos.z);
    const to = origin.clone().sub(eye);
    const len = to.length();
    if (len < 1e-4) return origin.clone();
    to.divideScalar(len);
    const hit = sweepBoxes(this.arena.boxes, eye, to, len, radius);
    if (hit) return eye.addScaledVector(to, Math.max(0, hit.t));
    return origin.clone();
  }

  aimDir(a: Actor): THREE.Vector3 {
    return new THREE.Vector3(
      -Math.sin(a.yaw) * Math.cos(a.pitch),
      Math.sin(a.pitch),
      -Math.cos(a.yaw) * Math.cos(a.pitch),
    ).normalize();
  }

  distToPlayer(p: THREE.Vector3) {
    return p.distanceTo(this.player.pos);
  }

  tryFire(a: Actor) {
    const def = WEAPONS[a.weapon];
    if (this.time < a.nextFire || this.over) return;
    if (def.ammoPerShot > 0 && (a.ammo[a.weapon] ?? 0) < def.ammoPerShot) {
      if (a.isPlayer) {
        this.sfx.blip(0.4, 0.3);
        a.nextFire = this.time + 0.4;
        const fallback = WEAPON_ORDER.filter(
          (w) => a.owned[w] && (WEAPONS[w].ammoPerShot === 0 || a.ammo[w] >= WEAPONS[w].ammoPerShot),
        ).pop();
        if (fallback) this.trySwitch(fallback);
      } else {
        a.weapon = this.botPickWeapon(a, 10);
      }
      return;
    }
    a.nextFire = this.time + def.rate * (a.bot ? 1.25 : 1);
    a.ammo[a.weapon] -= def.ammoPerShot;
    const quad = a.quadUntil > this.time;
    const dir = this.aimDir(a);
    // aiming down the sights tightens everything; the sniper is a little loose from the hip
    let spread = def.spread;
    if (a.isPlayer) {
      if (this.scopeAmt > 0.5) spread *= 0.35;
      else if (a.weapon === "sniper") spread = 0.02;
    }
    if (spread > 0) {
      dir.x += (Math.random() - 0.5) * spread;
      dir.y += (Math.random() - 0.5) * spread;
      dir.z += (Math.random() - 0.5) * spread;
      dir.normalize();
    }
    const origin = this.weaponOrigin(a, dir);
    const dist = a.isPlayer ? 0 : this.distToPlayer(a.pos);
    const dmgMul = quad ? 4 : 1;
    // let every client replay this shot's muzzle flash, tracer and noise
    this.emit({
      k: "fire",
      a: a.id,
      w: a.weapon,
      p: [round(origin.x), round(origin.y), round(origin.z)],
      d: [round(dir.x), round(dir.y), round(dir.z)],
    });

    if (a.isPlayer) {
      this.vmKick = Math.min(1, 0.25 + def.giggle / 90);
      this.muzzleLight.position.copy(origin);
      this.muzzleLight.color.setHex(def.color);
      this.muzzleLight.intensity = 9;
      // a quick coloured halo flash out of the muzzle
      this.flashUntil = this.time + 0.06;
      const fm = this.flashSprite.material as THREE.SpriteMaterial;
      fm.color.setHex(def.color);
      fm.rotation = Math.random() * Math.PI;
      this.flashSprite.scale.setScalar(0.35 + Math.random() * 0.25 + def.giggle / 120);
    }
    if (quad) this.sfx.quadFire(dist);

    switch (a.weapon) {
      case "pistol": {
        this.sfx.blip(1 + Math.random() * 0.6, 0.8, dist);
        this.hitscan(a, origin, dir, def.giggle * dmgMul, 0xff4fd8, 0.17, 160);
        this.spawnLightBlink(origin, def.color);
        break;
      }
      case "chaingun": {
        if (!a.isPlayer && this.time - a.lastSound > 0.28) {
          a.lastSound = this.time;
          this.sfx.fart(0.3, 1.1, 0.5, dist);
        }
        this.hitscan(a, origin, dir, def.giggle * dmgMul, 0x5ad7ff, 0.15, 150);
        break;
      }
      case "sniper": {
        this.sfx.babyPew(1, dist);
        this.hitscan(a, origin, dir, def.giggle * dmgMul, 0xb6ff5a, 0.3, 240);
        break;
      }
      case "squirt": {
        this.sfx.squeak(1.6, 0.18, dist);
        const hit = this.hitscan(a, origin, dir, def.giggle * dmgMul, 0x7ef6ff, 0, 60, true);
        this.showBeam(origin, hit.point, a.isPlayer);
        break;
      }
      case "rocket": {
        this.spawnRocket(a, origin, dir, quad);
        this.sfx.pop(0.7, 0.6, dist);
        break;
      }
      case "balloon": {
        this.spawnBalloon(a, origin, dir, quad);
        this.sfx.pop(1.3, 0.5, dist);
        break;
      }
      case "mines": {
        this.spawnMine(a, origin, dir, quad);
        this.sfx.boing(1.6, 0.45, dist);
        break;
      }
      case "bfg": {
        this.spawnFartDart(a, origin, dir, quad);
        this.sfx.fart(0.22, 1.5 + Math.random() * 0.4, 0.55, dist);
        break;
      }
      case "punch": {
        if (a.isPlayer) this.punchStartedAt = this.time;
        this.sfx.punchWham(dist);
        // Double reach: 11.5 meters! Hits like a runaway spring-loaded cartoon glove!
        const hit = this.hitscan(a, origin, dir, def.giggle * dmgMul, def.color, 0, 11.5);
        if (hit.hitActor) {
          hit.hitActor.vel.addScaledVector(dir, 17).add(new THREE.Vector3(0, 6.2, 0));
          this.sfx.punchWham(dist);
          this.sfx.boing(1.85, 1.0, dist);
        }
        break;
      }
    }
  }

  hitscan(
    a: Actor,
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    dmg: number,
    color: number,
    ballSize: number,
    range: number,
    instantTracer = false,
  ) {
    // trace from the true eye (so shots land exactly under the crosshair);
    // `origin` (the muzzle) is only used to draw the tracer ball
    const eye = new THREE.Vector3(a.pos.x, a.pos.y + EYE, a.pos.z);
    let t = this.traceWorld(eye, dir, range);
    let hitActor: Actor | null = null;
    for (const o of this.actors) {
      if (o === a || !o.alive || !this.areOpponents(a, o)) continue;
      const ht = rayActor(eye, dir, o);
      if (ht !== null && ht < t) {
        t = ht;
        hitActor = o;
      }
    }
    const point = eye.clone().addScaledVector(dir, t);
    if (hitActor) {
      this.addGiggle(hitActor, dmg, a);
      if (a.isPlayer) this.hitMarker = this.time;
    }
    if (ballSize > 0) {
      this.spawnSqueakyBall(origin, point, color, ballSize, !!hitActor);
    } else if (instantTracer) {
      this.spawnDroplets(point, color);
    }
    return { point, hitActor };
  }

  showBeam(origin: THREE.Vector3, end: THREE.Vector3, isPlayer: boolean) {
    if (!isPlayer) return;
    this.beamMesh.visible = true;
    this.beamMesh.position.copy(origin);
    this.beamMesh.lookAt(end);
    const len = origin.distanceTo(end);
    this.beamMesh.scale.set(1, 1, len);
    (this.beamMesh.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.random() * 0.3;
  }

  spawnSqueakyBall(from: THREE.Vector3, to: THREE.Vector3, color: number, size: number, hitPlayer: boolean) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(size, 10, 8),
      new THREE.MeshPhysicalMaterial({ color, roughness: 0.2, clearcoat: 1, emissive: color, emissiveIntensity: 0.25 }),
    );
    m.position.copy(from);
    this.scene.add(m);
    const dist = from.distanceTo(to);
    const dur = Math.min(0.35, dist / 150);
    const dPlayer = this.distToPlayer(to);
    this.effects.push({
      obj: m,
      life: 0,
      max: dur,
      kind: "ball",
      startPos: from.clone(),
      endPos: to.clone(),
      onEnd: () => {
        this.sfx.squeak(hitPlayer ? 1.3 : 0.9, hitPlayer ? 0.9 : 0.5, dPlayer);
        this.spawnPuff(to, color, hitPlayer ? 0.9 : 0.5);
      },
    });
  }

  spawnLightBlink(p: THREE.Vector3, color: number) {
    const l = new THREE.PointLight(color, 6, 12);
    l.position.copy(p);
    this.scene.add(l);
    this.effects.push({ obj: l, life: 0, max: 0.18, kind: "spark" });
  }

  spawnDroplets(p: THREE.Vector3, color: number) {
    if (Math.random() > 0.45) return;
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 8, 6),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }),
    );
    m.position.copy(p);
    this.scene.add(m);
    this.effects.push({
      obj: m,
      life: 0,
      max: 0.35,
      kind: "puff",
      vel: new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 3, (Math.random() - 0.5) * 3),
      grav: 12,
    });
  }

  spawnPuff(p: THREE.Vector3, color: number, scale = 1) {
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.16 * scale * (0.6 + Math.random()), 8, 6),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 }),
      );
      m.position.copy(p);
      this.scene.add(m);
      this.effects.push({
        obj: m,
        life: 0,
        max: 0.3 + Math.random() * 0.25,
        kind: "puff",
        vel: new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 3.5, (Math.random() - 0.5) * 4),
        grav: 9,
      });
    }
  }

  // ------------------------------------------------------------ projectiles
  addProjectileMesh(mesh: THREE.Object3D, pos: THREE.Vector3) {
    mesh.position.copy(pos);
    this.scene.add(mesh);
  }

  spawnRocket(a: Actor, origin: THREE.Vector3, dir: THREE.Vector3, quad: boolean) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.19, 0.4, 6, 10),
      new THREE.MeshPhysicalMaterial({ color: 0xff7a3d, roughness: 0.55, clearcoat: 0.4 }),
    );
    body.rotation.x = Math.PI / 2;
    g.add(body);
    const tip = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 10, 8),
      new THREE.MeshPhysicalMaterial({ color: 0xffe95a, roughness: 0.9 }),
    );
    tip.position.z = -0.3;
    g.add(tip);
    for (let i = 0; i < 3; i++) {
      const fin = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.3, 0.22),
        new THREE.MeshStandardMaterial({ color: quad ? 0xc08bff : 0x5ad7ff }),
      );
      fin.position.z = 0.26;
      fin.rotation.z = (i / 3) * Math.PI * 2;
      fin.position.x = Math.cos((i / 3) * Math.PI * 2) * 0.13;
      fin.position.y = Math.sin((i / 3) * Math.PI * 2) * 0.13;
      g.add(fin);
    }
    const light = new THREE.PointLight(0xffa04d, 2.5, 10);
    g.add(light);
    const start = this.projectileStart(a, origin, 0.3);
    this.addProjectileMesh(g, start);
    const whistle = this.sfx.whistle(this.distToPlayer(start));
    this.projectiles.push({
      mesh: g,
      pos: start.clone(),
      vel: dir.clone().multiplyScalar(WEAPONS.rocket.speed!),
      gravity: 0,
      owner: a,
      weapon: "rocket",
      die: this.time + 6,
      radius: 0.3,
      quad,
      whistle,
    });
  }

  spawnBalloon(a: Actor, origin: THREE.Vector3, dir: THREE.Vector3, quad: boolean) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.33, 12, 10),
      new THREE.MeshPhysicalMaterial({
        color: quad ? 0xc08bff : 0x3ad1ff,
        roughness: 0.08,
        transmission: 0.55,
        thickness: 0.6,
        clearcoat: 1,
      }),
    );
    m.scale.set(1, 1.15, 1);
    const start = this.projectileStart(a, origin, 0.33);
    this.addProjectileMesh(m, start);
    this.projectiles.push({
      mesh: m,
      pos: start.clone(),
      vel: dir.clone().multiplyScalar(WEAPONS.balloon.speed!).add(new THREE.Vector3(0, 2.2, 0)),
      gravity: WEAPONS.balloon.gravity!,
      owner: a,
      weapon: "balloon",
      die: this.time + 7,
      radius: 0.33,
      quad,
    });
  }

  spawnFartDart(a: Actor, origin: THREE.Vector3, dir: THREE.Vector3, quad: boolean) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.13, 0.3, 5, 8),
      new THREE.MeshPhysicalMaterial({
        color: quad ? 0xc08bff : 0x9dff3d,
        emissive: 0x4a7a1a,
        emissiveIntensity: 0.6,
        roughness: 0.5,
      }),
    );
    body.rotation.x = Math.PI / 2;
    g.add(body);
    const l = new THREE.PointLight(0x9dff3d, 1.8, 7);
    g.add(l);
    const start = this.projectileStart(a, origin, 0.22);
    this.addProjectileMesh(g, start);
    this.projectiles.push({
      mesh: g,
      pos: start.clone(),
      vel: dir.clone().multiplyScalar(WEAPONS.bfg.speed!),
      gravity: 0,
      owner: a,
      weapon: "bfg",
      die: this.time + 4,
      radius: 0.22,
      quad,
    });
  }

  spawnMine(a: Actor, origin: THREE.Vector3, dir: THREE.Vector3, quad: boolean) {
    const g = new THREE.Group();
    const cushion = new THREE.Mesh(
      new THREE.SphereGeometry(0.38, 14, 8),
      new THREE.MeshPhysicalMaterial({ color: 0xff5b8a, roughness: 0.35, clearcoat: 1 }),
    );
    cushion.scale.set(1, 0.45, 1);
    g.add(cushion);
    const nozzle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.09, 0.3, 8),
      new THREE.MeshPhysicalMaterial({ color: 0xffd34d, roughness: 0.3 }),
    );
    nozzle.rotation.z = Math.PI / 2;
    nozzle.position.x = 0.38;
    g.add(nozzle);
    const blinker = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 8, 6),
      new THREE.MeshBasicMaterial({ color: a.team === "red" ? 0xff2a4a : 0x2a7aff }),
    );
    blinker.position.y = 0.2;
    g.add(blinker);
    const start = this.projectileStart(a, origin, 0.2);
    this.addProjectileMesh(g, start);
    this.mines.push({
      mesh: g,
      pos: start.clone(),
      vel: dir.clone().multiplyScalar(WEAPONS.mines.speed!).add(new THREE.Vector3(0, 3, 0)),
      owner: a,
      normal: new THREE.Vector3(0, 1, 0),
      age: 0,
      armAt: this.time + 1.1,
      stuck: false,
      quad,
      die: this.time + 45,
    });
  }

  explode(
    center: THREE.Vector3,
    weapon: WeaponId,
    owner: Actor,
    quad: boolean,
    directHit?: Actor | null,
  ) {
    const def = WEAPONS[weapon];
    const sp = def.splash;
    const dPlayer = this.distToPlayer(center);
    const mul = quad ? 4 : 1;
    this.emit({
      k: "boom",
      p: [round(center.x), round(center.y), round(center.z)],
      w: weapon,
      q: quad ? 1 : 0,
    });
    if (directHit && def.giggle > 0) this.addGiggle(directHit, def.giggle * mul, owner);
    if (owner.isPlayer && directHit) this.hitMarker = this.time;
    if (sp && !this.isClient) {
      const body = new THREE.Vector3();
      for (const o of this.actors) {
        if (!o.alive) continue;
        body.set(o.pos.x, o.pos.y + 1.65, o.pos.z);
        const d = body.distanceTo(center);
        const direct = o === directHit;
        if (d > sp.radius && !direct) continue;
        // no splash through solid walls
        if (!direct && d > 1.2) {
          const to = body.clone().sub(center).divideScalar(d);
          if (this.traceWorld(center, to, d) < d - 0.25) continue;
        }
        const f = direct ? Math.max(0.55, 1 - d / sp.radius) : 1 - d / sp.radius;
        const self = o === owner;
        const friendly = this.mode !== "ffa" && o.team === owner.team && !self;
        // a direct hit already paid its giggles above; it still gets bounced around
        let dmg = direct ? 0 : sp.giggle * f * mul;
        if (self) dmg *= sp.selfScale;
        if (friendly) dmg *= 0.35;
        // knock-back points from the blast to the body's centre, with a little upward lift
        const push = body.clone().sub(center);
        push.y += 0.5;
        if (push.lengthSq() < 0.01) push.set(0, 1, 0);
        push.normalize().multiplyScalar(sp.push * f * (self ? 1.15 : 1));
        o.vel.add(push);
        o.grounded = false;
        if (dmg > 0 && (!friendly || self)) this.addGiggle(o, dmg, owner);
        if (owner.isPlayer && !self && !friendly && dmg > 0) this.hitMarker = this.time;
      }
    }
    // visuals
    const colors: Record<string, number> = {
      rocket: 0xffb43d,
      balloon: 0x5ad7ff,
      mines: 0xc6ff6a,
      bfg: 0x9dff3d,
    };
    const col = colors[weapon] ?? 0xffffff;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.6, 0.18, 8, 22),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9 }),
    );
    ring.position.copy(center);
    ring.rotation.x = Math.PI / 2;
    this.scene.add(ring);
    this.effects.push({ obj: ring, life: 0, max: 0.45, kind: "ring" });
    const flash = new THREE.PointLight(col, 14, (sp?.radius ?? 4) * 3);
    flash.position.copy(center);
    this.scene.add(flash);
    this.effects.push({ obj: flash, life: 0, max: 0.3, kind: "spark" });
    const n = weapon === "bfg" ? 5 : 11;
    for (let i = 0; i < n; i++) {
      const m = makePuff(
        weapon === "balloon" ? 0x9be9ff : [0xffd34d, 0xff8ab0, 0xb6ff5a, col][i % 4],
        0.3 + Math.random() * 0.4,
        0.9,
      );
      m.position.copy(center);
      this.scene.add(m);
      this.effects.push({
        obj: m,
        life: 0,
        max: 0.45 + Math.random() * 0.4,
        kind: "puff",
        vel: new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5)
          .normalize()
          .multiplyScalar(5 + Math.random() * 7),
        grav: 7,
      });
    }
    // sounds
    switch (weapon) {
      case "rocket":
        this.sfx.pop(0.6, 1, dPlayer);
        this.sfx.squeak(0.7, 0.8, dPlayer);
        break;
      case "balloon":
        this.sfx.splash(1, dPlayer);
        break;
      case "mines":
        this.sfx.fart(0.65, 0.85, 1.1, dPlayer);
        break;
      case "bfg":
        this.sfx.fart(0.3, 1.8, 0.7, dPlayer);
        break;
    }
  }

  // ---------------------------------------------------------------- damage
  addGiggle(target: Actor, amount: number, attacker: Actor) {
    if (!target.alive || this.over) return;
    if (this.isClient) return; // the host alone decides damage
    if (this.mode !== "ffa" && target.team === attacker.team && target !== attacker) amount *= 0.35;
    // mercy rule: bots tickle the human a little more gently
    if (target.isPlayer && attacker.bot) amount *= 0.48;
    target.giggle = Math.min(100, target.giggle + amount);
    if (target.isPlayer && amount > 0.5) this.playerHurt = this.time;
    if (Math.random() < 0.22) {
      this.sfx.giggle(
        (CHARACTERS.find((c) => c.kind === target.kind)?.voice ?? 1) * 1.1,
        0.35,
        target.isPlayer ? 0 : this.distToPlayer(target.pos),
      );
    }
    if (target.giggle >= 100) this.giggleOut(target, attacker);
  }

  giggleOut(a: Actor, by: Actor) {
    this.emit({ k: "out", a: a.id, by: by.id });
    a.alive = false;
    a.outAt = this.time;
    a.respawnAt = this.time + RESPAWN_DELAY;
    a.outs++;
    // remember where it happened so we respawn in the room farthest away
    a.deathPos = a.pos.clone();
    a.vel.set((Math.random() - 0.5) * 2, 22, (Math.random() - 0.5) * 2);
    a.firing = false;
    const voice = CHARACTERS.find((c) => c.kind === a.kind)?.voice ?? 1;
    this.sfx.giggle(voice, 1, a.isPlayer ? 0 : this.distToPlayer(a.pos) * 0.5);
    this.spawnPuff(a.pos.clone().add(new THREE.Vector3(0, 1, 0)), 0xfff06a, 2);
    if (a.isPlayer) {
      this.playerSpree = 0;
    }
    if (by !== a) {
      by.gigglesScored++;
      if (by.isPlayer) {
        this.sfx.jingle(true, 0.5);
        this.playerSpree++;
        if (this.playerSpree === 2) {
          this.sfx.speak("Double giggle!");
          this.triggerBanner("DOUBLE GIGGLE! 🤣", "#ff8ab0");
        } else if (this.playerSpree === 3) {
          this.sfx.speak("Giggling spree!");
          this.triggerBanner("GIGGLING SPREE! 😆", "#ffd34d");
        } else if (this.playerSpree === 4) {
          this.sfx.speak("Giggle fit!");
          this.triggerBanner("GIGGLE FIT! 😂", "#6effa8");
        } else if (this.playerSpree >= 5) {
          this.sfx.speak("Unstoppable giggles!");
          this.triggerBanner(`UNSTOPPABLE GIGGLES (${this.playerSpree}x)! 👑`, "#c08bff");
        }
      }
    }
    if (a.carrying) this.dropFlag(a);
    const label =
      by === a
        ? `${a.name} tickled themselves silly!`
        : `${by.name} 😂 giggled out ${a.name}!`;
    this.pushMessage(label, by.team === "red" ? "#ff9fb4" : "#9fd0ff");

    // squishmatch scoring: whoever caused it takes the point
    if (this.mode !== "ctf" && by !== a) {
      if (this.mapDef.teamSize > 0) {
        this.scores[by.team]++;
        if (this.scores[by.team] >= this.limit) this.endMatch();
      } else if (by.gigglesScored >= this.limit) {
        this.endMatch();
      }
    }
  }

  pushMessage(text: string, color: string) {
    this.messages.push({ id: this.msgId++, text, color, t: this.time });
    if (this.messages.length > 5) this.messages.shift();
    this.emit({ k: "say", text, color });
  }

  // ----------------------------------------------------------------- flags
  dropFlag(a: Actor) {
    const t = a.carrying;
    if (!t) return;
    const f = this.flags[t];
    f.state = "dropped";
    f.carrier = null;
    f.pos.copy(a.pos);
    f.pos.y = Math.max(0.2, a.pos.y);
    f.dropAt = this.time;
    f.obj.position.copy(f.pos);
    a.carrying = null;
    this.pushMessage(`${t.toUpperCase()} flag dropped!`, t === "red" ? "#ff9fb4" : "#9fd0ff");
    this.sfx.boing(0.8, 0.6, this.distToPlayer(f.pos));
  }

  updateFlags(dt: number) {
    if (this.mode !== "ctf") return; // no flags in a squishmatch
    for (const t of ["red", "blue"] as Team[]) {
      const f = this.flags[t];
      // ---- visual only: place the flag mesh (host AND client both draw it) ----
      if (f.state === "carried" && f.carrier) {
        const c = f.carrier;
        // ride on the carrier's back so it never blocks their view
        f.obj.position.set(
          c.pos.x + Math.sin(c.yaw) * 0.75,
          c.pos.y + 1.45 + Math.sin(this.time * 9) * 0.05,
          c.pos.z + Math.cos(c.yaw) * 0.75,
        );
        f.obj.scale.setScalar(0.8);
        f.obj.rotation.y = c.yaw + Math.PI;
        f.pos.copy(c.pos);
      } else {
        f.obj.scale.setScalar(1);
        f.obj.rotation.y += 0.9 * dt;
        const spot = f.state === "home" ? this.arena.flagStands[t] : f.pos;
        f.obj.position.set(spot.x, spot.y + Math.sin(this.time * 2) * 0.12, spot.z);
      }
      if (this.isClient) continue; // clients never decide flag rules — the host does
      // ---- host-only flag logic below ----
      if (f.state === "dropped" && this.time - f.dropAt > 28) {
        this.returnFlag(t, null);
        continue;
      }
      // touches
      for (const a of this.actors) {
        if (!a.alive) continue;
        const d = Math.hypot(a.pos.x - f.pos.x, a.pos.z - f.pos.z);
        if (d > 2.8 || Math.abs(a.pos.y - f.pos.y) > 3) continue;
        if (a.team === t) {
          if (f.state === "dropped") {
            this.returnFlag(t, a);
          } else if (f.state === "home" && a.carrying) {
            this.capture(a);
          }
        } else if (!a.carrying) {
          f.state = "carried";
          f.carrier = a;
          a.carrying = t;
          this.pushMessage(
            `${a.name} grabbed the ${t.toUpperCase()} flag!`,
            t === "red" ? "#ff9fb4" : "#9fd0ff",
          );
          this.sfx.announce("taken");
          if (t === this.player.team) {
            this.sfx.speak("They have your flag!");
            this.triggerBanner("THEY HAVE YOUR FLAG! 🚩", "#ff526c", 2.2);
          } else {
            this.sfx.speak("You have their flag!");
            this.triggerBanner("YOU HAVE THEIR FLAG! 🚩", "#5ad7ff", 2.2);
          }
        }
      }
    }
  }

  returnFlag(t: Team, by: Actor | null) {
    const f = this.flags[t];
    f.state = "home";
    f.carrier = null;
    f.pos.copy(this.arena.flagStands[t]);
    f.obj.position.copy(f.pos);
    this.pushMessage(
      by ? `${by.name} returned the ${t.toUpperCase()} flag.` : `${t.toUpperCase()} flag returned.`,
      t === "red" ? "#ff9fb4" : "#9fd0ff",
    );
    this.sfx.announce("returned");
    this.sfx.speak("Flag returned!");
    this.triggerBanner("FLAG RETURNED", "#ffd34d", 1.8);
  }

  capture(a: Actor) {
    const enemy = a.carrying!;
    this.flags[enemy].state = "home";
    this.flags[enemy].carrier = null;
    this.flags[enemy].pos.copy(this.arena.flagStands[enemy]);
    this.flags[enemy].obj.position.copy(this.flags[enemy].pos);
    a.carrying = null;
    a.caps++;
    this.scores[a.team]++;
    this.emit({ k: "cap", team: enemy });
    this.pushMessage(`🎉 ${a.name} CAPTURED the ${enemy.toUpperCase()} flag!`, "#ffe36a");
    this.sfx.announce("capture");
    const capsLeft = CAPTURE_LIMIT - this.scores[a.team];
    if (capsLeft > 0) {
      setTimeout(() => {
        if (capsLeft === 3) {
          this.sfx.speak("Three captures left!");
          this.triggerBanner("THREE CAPTURES LEFT!", "#ffd34d", 2.4);
        } else if (capsLeft === 2) {
          this.sfx.speak("Two captures left!");
          this.triggerBanner("TWO CAPTURES LEFT!", "#ff9fb4", 2.4);
        } else if (capsLeft === 1) {
          this.sfx.speak("One capture left! Match point!");
          this.triggerBanner("ONE CAPTURE LEFT! MATCH POINT!", "#ff526c", 2.8);
        }
      }, 750);
    }
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, 0.2, 0.2),
        new THREE.MeshBasicMaterial({ color: [0xff5b8a, 0xffd34d, 0x6effa8, 0x8ad6ff][i % 4] }),
      );
      m.position.copy(a.pos).add(new THREE.Vector3(0, 1.5, 0));
      this.scene.add(m);
      this.effects.push({
        obj: m,
        life: 0,
        max: 1.4,
        kind: "puff",
        vel: new THREE.Vector3(Math.random() - 0.5, Math.random() * 1.4, Math.random() - 0.5)
          .normalize()
          .multiplyScalar(7 + Math.random() * 5),
        grav: 11,
        spin: 8,
      });
    }
    if (this.scores[a.team] >= CAPTURE_LIMIT) this.endMatch();
  }

  endMatch() {
    if (this.over) return;
    this.over = true;
    if (this.mapDef.teamSize > 0 || this.mode === "ctf") {
      this.winner = this.scores.red === this.scores.blue ? "tie" : this.scores.red > this.scores.blue ? "red" : "blue";
    } else {
      const ranked = [...this.actors].sort((x, y) => y.gigglesScored - x.gigglesScored);
      const top = ranked[0];
      const tie = ranked[1] && top && ranked[1].gigglesScored === top.gigglesScored;
      this.winner = tie ? "tie" : null;
      this.mvp = tie ? null : (top?.name ?? null);
    }
    const iWon =
      this.winner === this.player.team || (this.winner === null && this.mvp === this.player.name);
    this.sfx.announce(iWon ? "win" : "lose");
    if (iWon) {
      this.sfx.speak("You win!");
      this.triggerBanner("🏆 YOU WIN! YAY!", "#6effa8", 4);
    } else {
      this.sfx.speak("You lose!");
      this.triggerBanner(this.mvp ? `😭 ${this.mvp} WINS!` : "😭 YOU LOSE!", "#ff8ab0", 4);
    }
    this.pushMessage(
      this.winner === "tie"
        ? "It's a giggly tie!"
        : this.mvp
          ? `${this.mvp} wins the squishmatch!`
          : `${this.winner?.toUpperCase() ?? ""} TEAM WINS!`,
      "#ffe36a",
    );
  }

  // ----------------------------------------------------------------- items
  giveAmmoBundle(a: Actor) {
    const give: [WeaponId, number][] = [
      ["chaingun", 45],
      ["rocket", 6],
      ["balloon", 6],
      ["squirt", 55],
      ["mines", 4],
      ["sniper", 4],
      ["bfg", 15],
    ];
    let any = false;
    for (const [w, n] of give) {
      if (!a.owned[w]) continue;
      const before = a.ammo[w];
      a.ammo[w] = Math.min(WEAPONS[w].maxAmmo, a.ammo[w] + n);
      if (a.ammo[w] !== before) any = true;
    }
    if (!any) {
      // give chaingun ammo anyway as a consolation
      a.owned.chaingun = true;
      a.ammo.chaingun = Math.min(WEAPONS.chaingun.maxAmmo, (a.ammo.chaingun ?? 0) + 45);
    }
  }

  updateItems(dt: number) {
    for (const it of this.items) {
      if (!it.active) {
        // only the host respawns items; clients follow the host's snapshot state
        if (!this.isClient && this.time >= it.respawnAt) {
          it.active = true;
          it.obj.visible = true;
          this.sfx.blip(1.8, 0.18, this.distToPlayer(it.spawn.pos));
        }
        continue;
      }
      it.obj.rotation.y += dt * (it.spawn.kind === "quad" ? 1.6 : 1.1);
      it.obj.position.y = it.spawn.pos.y + Math.sin(this.time * 2 + it.bobPhase) * 0.18;
      // pickups are authoritative on the host: it tests every actor (including
      // networked players at their true positions) and broadcasts the result
      if (this.isClient) continue;
      for (const a of this.actors) {
        if (!a.alive) continue;
        const dx = a.pos.x - it.spawn.pos.x;
        const dz = a.pos.z - it.spawn.pos.z;
        const dy = a.pos.y + 0.8 - it.spawn.pos.y;
        if (dx * dx + dz * dz > 2.6 || Math.abs(dy) > 2.2) continue;
        if (this.pickup(a, it)) break;
      }
    }
  }

  pickup(a: Actor, it: WorldItem): boolean {
    const sp = it.spawn;
    const d = a.isPlayer ? 0 : this.distToPlayer(a.pos);
    let text: string | null = null;
    switch (sp.kind) {
      case "weapon": {
        const w = sp.weapon!;
        const full =
          a.owned[w] &&
          (WEAPONS[w].ammoPerShot === 0 || a.ammo[w] >= WEAPONS[w].maxAmmo);
        if (full) return false;
        const isNew = !a.owned[w];
        a.owned[w] = true;
        a.ammo[w] = Math.min(WEAPONS[w].maxAmmo, (a.ammo[w] ?? 0) + WEAPONS[w].pickupAmmo);
        text = `${WEAPONS[w].icon} ${WEAPONS[w].name}`;
        if (a.isPlayer && (isNew || WEAPONS[w].giggle > WEAPONS[a.weapon].giggle)) this.trySwitch(w);
        if (!a.isPlayer && isNew) a.weapon = w;
        this.sfx.blip(1.5, 0.6, d);
        break;
      }
      case "ammo":
        this.giveAmmoBundle(a);
        text = "📦 Ammo bundle";
        this.sfx.blip(1.1, 0.5, d);
        break;
      case "juice":
      case "megajuice": {
        const amt = sp.kind === "megajuice" ? 55 : 25;
        if (a.giggle <= 0) return false;
        a.giggle = Math.max(0, a.giggle - amt);
        text = sp.kind === "megajuice" ? "🧃 MEGA Serious Juice" : "🧃 Serious Juice";
        this.sfx.pop(1.5, 0.5, d);
        this.sfx.blip(0.7, 0.4, d);
        break;
      }
      case "quad":
        a.quadUntil = this.time + 25;
        text = "💜 QUAD GIGGLE!";
        this.sfx.announce("quad");
        this.sfx.speak("Quad giggle!");
        this.triggerBanner("💜 QUAD GIGGLE 4X!", "#c08bff", 2.6);
        this.pushMessage(`${a.name} has QUAD GIGGLE!`, "#d8a6ff");
        break;
      case "milk": {
        // FULL-TEAM MEGA HEALTH! Clears all giggles to 0 for every living teammate!
        for (const tm of this.actors) {
          if (tm.team === a.team && tm.alive) {
            tm.giggle = 0;
            this.spawnPuff(tm.pos.clone().add(new THREE.Vector3(0, 1.8, 0)), 0xfffbee, 2.5);
          }
        }
        text = "🍼 Warm Milk Bottle! Whole team healed!";
        this.sfx.milkGlug();
        const teamName = a.team.toUpperCase();
        this.pushMessage(`🍼 ${a.name} drank Warm Milk! Team ${teamName} giggles wiped to 0!`, "#fff1a8");
        this.triggerBanner(`🍼 WARM MILK! TEAM ${teamName} HEALED!`, a.team === "red" ? "#ff9fb4" : "#9fd0ff", 3.0);
        this.sfx.speak(`Warm milk! Team ${a.team} healed!`);
        if (a.team === this.player.team) {
          this.milkGlowUntil = this.time + 1.2;
        }
        break;
      }
    }
    this.emit({
      k: "pickup",
      a: a.id,
      kind: sp.kind,
      p: [round(it.spawn.pos.x), round(it.spawn.pos.y), round(it.spawn.pos.z)],
    });
    it.active = false;
    it.obj.visible = false;
    it.respawnAt = this.time + sp.respawn;
    if (a.isPlayer && text) this.pickupText = { text, t: this.time };
    return true;
  }

  // ------------------------------------------------------------------ bots
  nearestWaypoint(p: THREE.Vector3): number {
    let best = 0;
    let bd = Infinity;
    const wps = this.arena.waypoints;
    for (let i = 0; i < wps.length; i++) {
      const w = wps[i].pos;
      const dy = Math.abs(w.y - p.y);
      const d = p.distanceToSquared(w) + dy * dy * 8;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  findPath(from: number, to: number): number[] {
    const wps = this.arena.waypoints;
    const prev = new Int32Array(wps.length).fill(-1);
    const seen = new Uint8Array(wps.length);
    const q = [from];
    seen[from] = 1;
    while (q.length) {
      const cur = q.shift()!;
      if (cur === to) break;
      for (const n of wps[cur].links) {
        if (seen[n]) continue;
        seen[n] = 1;
        prev[n] = cur;
        q.push(n);
      }
    }
    if (!seen[to]) return [];
    const path: number[] = [];
    let c = to;
    while (c !== -1 && c !== from) {
      path.push(c);
      c = prev[c];
    }
    path.reverse();
    return path;
  }

  botGoal(a: Actor): THREE.Vector3 {
    const b = a.bot!;

    // ---- squishmatch / team squishmatch / free-for-all: hunt opponents,
    // otherwise wander to toys. Only CTF needs flag goals below.
    if (this.mode !== "ctf") {
      const foe = this.actors.find((o) => o.alive && this.areOpponents(a, o));
      if (foe && a.pos.distanceTo(foe.pos) < 46) return foe.pos;
      let best: THREE.Vector3 | null = null;
      let bd = Infinity;
      for (const it of this.items) {
        if (!it.active) continue;
        const d = a.pos.distanceTo(it.spawn.pos);
        if (d < bd) {
          bd = d;
          best = it.spawn.pos;
        }
      }
      if (best) return best;
      const list = this.arena.dmSpawns.length ? this.arena.dmSpawns : this.arena.spawns[a.team];
      return list[Math.floor(Math.random() * list.length)];
    }

    const enemyTeam: Team = a.team === "red" ? "blue" : "red";
    const myFlag = this.flags[a.team];
    const enemyFlag = this.flags[enemyTeam];
    if (a.carrying) {
      if (myFlag.state === "dropped") return myFlag.pos;
      return this.arena.flagStands[a.team];
    }
    if (myFlag.state === "dropped") return myFlag.pos;
    if (myFlag.state === "carried" && myFlag.carrier) {
      // chase the thief if defending or nearby
      if (b.role === "defend" || a.pos.distanceTo(myFlag.carrier.pos) < 45) return myFlag.carrier.pos;
    }
    if (b.role === "defend") {
      const stand = this.arena.flagStands[a.team].clone();
      stand.x += Math.sin(this.time * 0.3 + a.id) * 10;
      stand.z += Math.cos(this.time * 0.25 + a.id) * 9;
      return stand;
    }
    if (b.role === "roam") {
      // go for the quad / bridge
      const quadItem = this.items.find((i) => i.spawn.kind === "quad");
      if (quadItem?.active) return quadItem.spawn.pos;
    }
    // poorly armed? detour to the nearest decent toy
    const armed = WEAPON_ORDER.some(
      (w) => w !== "pistol" && a.owned[w] && a.ammo[w] >= WEAPONS[w].ammoPerShot,
    );
    if (!armed || a.giggle > 50) {
      let best: THREE.Vector3 | null = null;
      let bd = armed ? 32 : 48;
      for (const it of this.items) {
        if (!it.active) continue;
        const want =
          (!armed && it.spawn.kind === "weapon") ||
          (a.giggle > 50 &&
            (it.spawn.kind === "milk" || it.spawn.kind === "juice" || it.spawn.kind === "megajuice"));
        if (!want) continue;
        const d = a.pos.distanceTo(it.spawn.pos);
        if (d < bd) {
          bd = d;
          best = it.spawn.pos;
        }
      }
      if (best) return best;
    }
    if (enemyFlag.state === "carried" && enemyFlag.carrier?.team === a.team) {
      return enemyFlag.carrier.pos; // escort
    }
    if (enemyFlag.state === "dropped") return enemyFlag.pos;
    return this.arena.flagStands[enemyTeam];
  }

  botPickWeapon(a: Actor, dist: number): WeaponId {
    const prefs: WeaponId[] =
      dist < 6
        ? ["punch", "chaingun", "squirt", "bfg", "rocket", "balloon", "pistol"]
        : dist > 48
        ? ["sniper", "rocket", "chaingun", "bfg", "pistol"]
        : dist > 18
          ? ["rocket", "bfg", "chaingun", "sniper", "balloon", "squirt", "pistol"]
          : ["chaingun", "squirt", "bfg", "rocket", "balloon", "pistol"];
    for (const w of prefs) {
      if (a.owned[w] && (WEAPONS[w].ammoPerShot === 0 || a.ammo[w] >= WEAPONS[w].ammoPerShot)) return w;
    }
    return "pistol";
  }

  updateBot(a: Actor, dt: number) {
    const b = a.bot!;
    const goal = this.botGoal(a);
    b.goalPos.copy(goal);

    // ---- target selection
    if (this.time > b.nextThink) {
      b.nextThink = this.time + 0.3 + Math.random() * 0.25;
      let best: Actor | null = null;
      let bestScore = -Infinity;
      for (const o of this.actors) {
        if (!o.alive || !this.areOpponents(a, o)) continue;
        const d = a.pos.distanceTo(o.pos);
        if (d > 72) continue;
        if (!this.canSee(a, o)) continue;
        const score = 100 - d + (o.carrying ? 60 : 0);
        if (score > bestScore) {
          bestScore = score;
          best = o;
        }
      }
      // squishmatch sparring partner takes it very easy on you
      if (best && best !== b.target && this.mode === "dm") {
        const react = 1.5 + Math.random() * 0.9;
        b.reactUntil = this.time + react;
        b.burstUntil = this.time + react + 0.4;
        b.pauseUntil = 0;
      }
      // new target spotted? take a moment to go "oh! a squishy!" before firing
      if (best && best !== b.target) {
        const react = 0.45 + (1 - a.skill) * 0.75 + Math.random() * 0.35;
        b.reactUntil = this.time + react;
        b.burstUntil = this.time + react + 0.5 + Math.random() * 0.5;
        b.pauseUntil = 0;
      }
      b.target = best;
      if (best) a.weapon = this.botPickWeapon(a, a.pos.distanceTo(best.pos));
      else if (!a.owned[a.weapon]) a.weapon = "pistol";
    }

    // ---- pathing
    if (this.time > b.repath || b.path.length === 0) {
      b.repath = this.time + 1.1 + Math.random() * 0.6;
      const from = this.nearestWaypoint(a.pos);
      const to = this.nearestWaypoint(goal);
      b.path = this.findPath(from, to);
      b.pathIdx = 0;
    }
    let moveTarget = goal.clone();
    if (b.path.length) {
      const node = this.arena.waypoints[b.path[Math.min(b.pathIdx, b.path.length - 1)]].pos;
      if (a.pos.distanceTo(node) < 3.2) b.pathIdx++;
      if (b.pathIdx >= b.path.length) {
        moveTarget = goal.clone();
      } else {
        moveTarget = this.arena.waypoints[b.path[b.pathIdx]].pos.clone();
      }
    }
    // if the goal is close just walk straight at it
    if (a.pos.distanceTo(goal) < 9) moveTarget = goal.clone();

    const toTarget = moveTarget.clone().sub(a.pos);
    toTarget.y = 0;
    const dist2d = toTarget.length();
    toTarget.normalize();

    // facing: look at enemy if any, else movement direction
    let desiredYaw = Math.atan2(-toTarget.x, -toTarget.z);
    let desiredPitch = 0;
    if (b.target) {
      const tgt = b.target;
      const dist = a.pos.distanceTo(tgt.pos);
      const def = WEAPONS[a.weapon];
      const aim = tgt.pos.clone().add(new THREE.Vector3(0, 1.8, 0));
      if (def.mode === "projectile" && def.speed) {
        const tof = dist / def.speed;
        aim.add(tgt.vel.clone().multiplyScalar(tof * 0.85));
        if (def.gravity) aim.y += 0.5 * def.gravity * tof * tof;
      }
      const err = (1 - a.skill) * 1.35;
      aim.x += (Math.random() - 0.5) * err * dist * 0.1;
      aim.y += (Math.random() - 0.5) * err * dist * 0.08;
      aim.z += (Math.random() - 0.5) * err * dist * 0.1;
      const dir = aim.sub(new THREE.Vector3(a.pos.x, a.pos.y + EYE, a.pos.z));
      desiredYaw = Math.atan2(-dir.x, -dir.z);
      desiredPitch = Math.atan2(dir.y, Math.hypot(dir.x, dir.z));
      // fire in bursts with little giggly pauses, and never before reacting
      if (dist < 72 && this.time > b.reactUntil && this.time > b.pauseUntil) {
        if (this.time > b.burstUntil) {
          b.pauseUntil = this.time + 0.7 + Math.random() * 0.65;
          b.burstUntil = b.pauseUntil + 0.45 + Math.random() * 0.8;
          a.firing = false;
        } else {
          a.firing = Math.random() < 0.68;
        }
      } else {
        a.firing = false;
      }
      // strafe in combat
      if (this.time > b.nextStrafe) {
        b.nextStrafe = this.time + 0.6 + Math.random() * 1.1;
        b.strafe = Math.random() < 0.5 ? -1 : 1;
      }
    } else {
      a.firing = false;
      b.strafe = 0;
    }

    // smooth turn
    const dy = ((desiredYaw - a.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    const turnRate = 3.4 + a.skill * 2;
    a.yaw += THREE.MathUtils.clamp(dy, -turnRate * dt, turnRate * dt);
    a.pitch += THREE.MathUtils.clamp(desiredPitch - a.pitch, -turnRate * 0.75 * dt, turnRate * 0.75 * dt);

    // movement in actor local space
    const fwd = new THREE.Vector3(-Math.sin(a.yaw), 0, -Math.cos(a.yaw));
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
    let mx = 0;
    let mz = 0;
    const towardDot = fwd.dot(toTarget);
    const rightDot = right.dot(toTarget);
    if (dist2d > 2) {
      mz = towardDot;
      mx = rightDot;
    }
    if (b.target && b.strafe !== 0) {
      mx += b.strafe * 0.85;
      const d = a.pos.distanceTo(b.target.pos);
      if (d < 9) mz -= 0.6;
    }
    const len = Math.hypot(mx, mz) || 1;
    a.moveX = mx / len;
    a.moveZ = mz / len;

    // jumping: obstacle in front, or random hops in combat
    a.wantJump = false;
    if (a.grounded) {
      const eye = new THREE.Vector3(a.pos.x, a.pos.y + 0.45, a.pos.z);
      const f = new THREE.Vector3(fwd.x, 0, fwd.z).normalize();
      if (this.traceWorld(eye, f, 2.2) < 1.6 && Math.random() < 0.6) a.wantJump = true;
      if (b.target && Math.random() < 0.012) a.wantJump = true;
      if (moveTarget.y - a.pos.y > 1.2 && dist2d < 4) a.wantJump = true;
    }
  }

  // ------------------------------------------------------------- actor sim
  updateActor(a: Actor, dt: number) {
    if (!a.alive) {
      // giggling out: float up, spin, and vanish
      a.vel.y = Math.max(6, a.vel.y - 5 * dt);
      a.pos.addScaledVector(a.vel, dt);
      a.parts.group.position.copy(a.pos);
      a.parts.group.rotation.y += dt * 7;
      a.parts.group.rotation.z = Math.sin(this.time * 9) * 0.4;
      animateChar(a.parts, this.time, 0, false, true);
      if (this.time - a.outAt > 1.4) {
        const k = 1 - Math.min(1, (this.time - a.outAt - 1.4) / 1.3);
        a.parts.group.scale.setScalar(Math.max(0.01, k));
      }
      if (this.time >= a.respawnAt) {
        a.parts.group.scale.setScalar(1);
        this.respawn(a, false, a.deathPos);
      }
      return;
    }
    a.parts.group.scale.setScalar(1);

    // clients don't simulate anybody but themselves — the host owns the rest
    if (this.isClient && a !== this.player) {
      this.followSnapshot(a, dt);
      return;
    }
    // on the host, a networked player drives their own squishy (no bot brain)
    if (a.bot && !a.peer) this.updateBot(a, dt);

    // movement
    const fwd = new THREE.Vector3(-Math.sin(a.yaw), 0, -Math.cos(a.yaw));
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
    const wish = new THREE.Vector3()
      .addScaledVector(fwd, a.moveZ)
      .addScaledVector(right, a.moveX);
    if (wish.lengthSq() > 1) wish.normalize();

    const accel = a.grounded ? GROUND_ACCEL : AIR_ACCEL;
    const horiz = new THREE.Vector3(a.vel.x, 0, a.vel.z);
    if (a.grounded) {
      const sp = horiz.length();
      if (sp > 0) {
        const drop = Math.max(sp - Math.max(sp, 6) * FRICTION * dt, 0);
        horiz.multiplyScalar(drop / sp);
      }
    }
    const wishSpeed = MOVE_SPEED * (a.carrying ? 0.93 : 1);
    const curSpeed = horiz.dot(wish);
    const addSpeed = wishSpeed - curSpeed;
    if (addSpeed > 0) {
      const accelSpeed = Math.min(accel * dt * wishSpeed * 0.12, addSpeed);
      horiz.addScaledVector(wish, accelSpeed);
    }
    a.vel.x = horiz.x;
    a.vel.z = horiz.z;

    if (a.wantJump && a.grounded) {
      a.vel.y = JUMP_VEL;
      a.grounded = false;
      if (Math.random() < 0.35)
        this.sfx.boing(1.2 + Math.random() * 0.4, 0.25, a.isPlayer ? 0 : this.distToPlayer(a.pos));
    }
    a.vel.y -= GRAVITY * dt;
    a.vel.y = Math.max(a.vel.y, -60);

    // jump pads
    for (const jp of this.arena.jumpPads) {
      if (
        a.pos.x > jp.box.min.x &&
        a.pos.x < jp.box.max.x &&
        a.pos.z > jp.box.min.z &&
        a.pos.z < jp.box.max.z &&
        a.pos.y < jp.box.max.y &&
        a.pos.y > jp.box.min.y - 0.5
      ) {
        a.vel.copy(jp.velocity).add(new THREE.Vector3(a.vel.x * 0.4, 0, a.vel.z * 0.4));
        a.grounded = false;
        this.sfx.boing(1.5, 0.6, a.isPlayer ? 0 : this.distToPlayer(a.pos));
      }
    }

    a.grounded = this.collide(a.pos, a.vel, dt);

    // firing
    if (a.firing) this.tryFire(a);

    // model transform
    a.parts.group.position.copy(a.pos);
    a.parts.group.rotation.y = a.yaw + Math.PI;
    a.parts.group.rotation.z = 0;
    const speed = Math.hypot(a.vel.x, a.vel.z);
    animateChar(a.parts, this.time, speed, a.grounded, false);
    a.parts.head.rotation.x = THREE.MathUtils.clamp(-a.pitch * 0.5, -0.5, 0.5);
    // quad glow
    const quad = a.quadUntil > this.time;
    for (const band of a.parts.teamBand) {
      const m = band.material as THREE.MeshPhysicalMaterial;
      if (quad) {
        m.emissive.setHex(0x8a2aff);
        m.emissiveIntensity = 0.8 + Math.sin(this.time * 9) * 0.3;
      } else {
        m.emissive.setHex(TEAM_COLORS[a.team]);
        m.emissiveIntensity = 0.25;
      }
    }
    a.parts.group.visible = !(a.isPlayer && a.alive);
    if (this.net && !this.isClient && a.peer) {
      // nothing further: networked players already told us their move
    }
  }

  // ------------------------------------------------------- projectile sim
  updateProjectiles(dt: number) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.age = (p.age ?? 0) + dt;
      p.vel.y -= p.gravity * dt;
      const step = p.vel.clone().multiplyScalar(dt);
      const dist = step.length();
      const dir = dist > 1e-6 ? step.clone().divideScalar(dist) : new THREE.Vector3(0, -1, 0);

      // What's in the way this frame? Either world geometry (swept sphere) or an
      // enemy squishy. The owner and their teammates are never hit directly —
      // they can only feel the splash, exactly like Quake.
      const world = sweepBoxes(this.arena.boxes, p.pos, dir, dist, p.radius);
      let hitT = world ? world.t : Infinity;
      let hitActor: Actor | null = null;
      for (const o of this.actors) {
        if (!o.alive || !this.areOpponents(p.owner, o)) continue;
        const t = rayActor(p.pos, dir, o);
        if (t !== null && t <= dist && t < hitT) {
          hitT = t;
          hitActor = o;
        }
      }
      if (hitT !== Infinity) {
        const center = p.pos.clone().addScaledVector(dir, hitT);
        this.explode(center, p.weapon, p.owner, p.quad, hitActor);
        p.whistle?.stop();
        this.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
        continue;
      }
      // flew out of the world entirely? quietly retire it
      if (Math.abs(p.pos.x) > 110 || Math.abs(p.pos.z) > 80 || p.pos.y < -10 || p.pos.y > 140) {
        p.whistle?.stop();
        this.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
        continue;
      }
      p.pos.add(step);
      p.mesh.position.copy(p.pos);
      p.mesh.lookAt(p.pos.clone().add(p.vel));
      if (p.weapon === "balloon") {
        // wobbly water balloon
        const w = Math.sin(this.time * 20) * 0.09;
        p.mesh.scale.set(1 + w, 1.15 - w, 1 + w);
      }
      if (p.whistle) {
        const d = this.distToPlayer(p.pos);
        p.whistle.update(d, 0.85 + Math.min(0.5, p.vel.length() / 90));
      }
      if (this.time > p.die) {
        this.explode(p.pos.clone(), p.weapon, p.owner, p.quad, null);
        p.whistle?.stop();
        this.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
      }
    }

    // mines
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i];
      if (!m.stuck) {
        m.age += dt;
        m.vel.y -= 19 * dt;
        const step = m.vel.clone().multiplyScalar(dt);
        const d = step.length();
        const dir = d > 1e-6 ? step.clone().divideScalar(d) : new THREE.Vector3(0, -1, 0);
        // swept sphere vs the world: sticks to floors AND walls, never tunnels through
        const hit = sweepBoxes(this.arena.boxes, m.pos, dir, d, 0.2);
        if (hit) {
          m.pos.addScaledVector(dir, hit.t);
          m.stuck = true;
          m.vel.set(0, 0, 0);
          m.normal.set(hit.nx, hit.ny, hit.nz);
          // sit flush on whatever it hit: the cushion's up-axis follows the surface normal
          m.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), m.normal);
          m.mesh.rotateY(Math.random() * Math.PI * 2);
          this.sfx.squeak(0.5, 0.4, this.distToPlayer(m.pos));
        } else {
          m.pos.add(step);
          m.mesh.rotation.x += dt * 4;
          m.mesh.rotation.z += dt * 3;
        }
        m.mesh.position.copy(m.pos);
      } else {
        // gentle breathing pulse along the surface normal
        const pulse = Math.abs(Math.sin(this.time * 3)) * 0.05;
        m.mesh.position.copy(m.pos).addScaledVector(m.normal, pulse);
        const blink = m.mesh.children[2] as THREE.Mesh;
        if (blink) blink.visible = Math.sin(this.time * 10) > 0;
      }
      let boom = this.time > m.die;
      if (!boom && m.stuck && this.time > m.armAt) {
        for (const a of this.actors) {
          if (!a.alive || !this.areOpponents(m.owner, a)) continue;
          const dx = a.pos.x - m.pos.x;
          const dy = a.pos.y + 0.85 - m.pos.y;
          const dz = a.pos.z - m.pos.z;
          if (dx * dx + dy * dy + dz * dz < 3.4 * 3.4) {
            boom = true;
            break;
          }
        }
      }
      if (boom) {
        this.explode(m.pos.clone().add(new THREE.Vector3(0, 0.3, 0)), "mines", m.owner, m.quad, null);
        this.scene.remove(m.mesh);
        this.mines.splice(i, 1);
      }
    }
  }

  updateEffects(dt: number) {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.life += dt;
      const k = e.life / e.max;
      if (e.kind === "ball" && e.startPos && e.endPos) {
        e.obj.position.lerpVectors(e.startPos, e.endPos, Math.min(1, k));
      } else if (e.kind === "puff") {
        if (e.vel) {
          e.obj.position.addScaledVector(e.vel, dt);
          e.vel.y -= (e.grav ?? 8) * dt;
        }
        if (e.spin) e.obj.rotation.x += e.spin * dt;
        const mat = (e.obj as THREE.Mesh).material as THREE.MeshBasicMaterial;
        if (mat) mat.opacity = Math.max(0, 1 - k);
        e.obj.scale.setScalar(Math.max(0.01, 1 - k * 0.6));
      } else if (e.kind === "ring") {
        e.obj.scale.setScalar(1 + k * 5);
        const mat = (e.obj as THREE.Mesh).material as THREE.MeshBasicMaterial;
        mat.opacity = Math.max(0, 0.9 - k);
      } else if (e.kind === "spark") {
        (e.obj as THREE.PointLight).intensity = Math.max(0, (1 - k) * 10);
      }
      if (e.life >= e.max) {
        e.onEnd?.();
        this.scene.remove(e.obj);
        const mesh = e.obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | undefined;
        if (mat && typeof (mat as THREE.Material).dispose === "function") mat.dispose();
        this.effects.splice(i, 1);
      }
    }
  }

  // ------------------------------------------------------------ main loop
  readPlayerInput() {
    const p = this.player;
    if (!p.alive || this.over) {
      p.moveX = 0;
      p.moveZ = 0;
      p.wantJump = false;
      p.firing = false;
      return;
    }
    const k = this.keys;
    p.moveZ = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0);
    p.moveX = (k.KeyA ? 1 : 0) - (k.KeyD ? 1 : 0);
    p.wantJump = !!k.Space;
    if (this.isClient) {
      // the host pulls the trigger for us; we just keep the view model lively
      p.firing = false;
      const want = this.mouseDown;
      if (want && !this.clientFiring) this.vmKick = Math.max(this.vmKick, 0.3);
      this.clientFiring = want;
      return;
    }
    p.firing = this.mouseDown;
  }
  clientFiring = false;

  updateCamera(dt: number) {
    const p = this.player;

    // ---- scope / aim zoom (right mouse button)
    const wantScope = p.alive && this.scopeHeld && !this.over;
    const scopeTarget = wantScope ? 1 : 0;
    this.scopeAmt += (scopeTarget - this.scopeAmt) * Math.min(1, dt * 16);
    if (Math.abs(this.scopeAmt - scopeTarget) < 0.003) this.scopeAmt = scopeTarget;
    const zoomFov = p.weapon === "sniper" ? 24 : 62;
    const fov = this.baseFov + (zoomFov - this.baseFov) * this.scopeAmt;
    if (Math.abs(fov - this.camera.fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    const zoomRatio =
      Math.tan(THREE.MathUtils.degToRad(fov / 2)) / Math.tan(THREE.MathUtils.degToRad(this.baseFov / 2));

    if (p.alive) {
      const bobSpeed = Math.hypot(p.vel.x, p.vel.z);
      this.bobT += dt * (4 + bobSpeed * 0.9);
      const bob = p.grounded ? Math.sin(this.bobT * 2) * 0.035 * Math.min(1, bobSpeed / 8) : 0;
      const sway = p.grounded ? Math.cos(this.bobT) * 0.03 * Math.min(1, bobSpeed / 8) : 0;
      this.camera.position.set(p.pos.x, p.pos.y + EYE + bob, p.pos.z);
      this.camera.rotation.set(0, 0, 0);
      this.camera.rotation.order = "YXZ";
      this.camera.rotation.y = p.yaw;
      this.camera.rotation.x = p.pitch;
      this.camera.rotation.z = sway * 0.3;
      // Sniper: the scope overlay replaces the gun. Other toys rise toward the
      // crosshair so their front sights line up when aim is held.
      const sniperScoped = p.weapon === "sniper" && this.scopeAmt > 0.3;
      this.vmHolder.visible = !sniperScoped;
      this.vmHolder.scale.setScalar(zoomRatio);
      const ironSightAim = p.weapon === "sniper" ? 0 : this.scopeAmt;
      // Sighting: bring the toy in line with the crosshair but keep it LOW, so you
      // look over the top of the barrel and its front sight rather than past the side.
      const adsX = -0.28 * zoomRatio * ironSightAim;
      // Keep the gun in the lower third while aiming: sights sit below the
      // crosshair so the player looks over them instead of staring at the gun.
      const adsY = -0.09 * zoomRatio * ironSightAim;
      const adsZ = 0.055 * ironSightAim;
      this.vmHolder.position.set(
        sway * 0.4 + adsX,
        bob * 0.8 - this.vmKick * 0.08 + adsY,
        this.vmKick * 0.14 + adsZ,
      );
      this.vmHolder.rotation.x = this.vmKick * 0.35 - ironSightAim * 0.06;
      const flashFade = Math.max(0, (this.flashUntil - this.time) / 0.06);
      (this.flashSprite.material as THREE.SpriteMaterial).opacity = flashFade * 0.92;
      if (this.vm?.punchGlove && this.vm.punchSpring) {
        const age = this.time - this.punchStartedAt;
        let extension = 0;
        if (age >= 0 && age < 0.16) {
          const t = age / 0.16;
          extension = 1 - (1 - t) * (1 - t);
        } else if (age >= 0.16 && age < 0.3) {
          extension = 1;
        } else if (age >= 0.3 && age < 1.65) {
          const t = (age - 0.3) / 1.35;
          extension = 1 - t * t * (3 - 2 * t);
        }
        // Double-reach punch: stretches out 1.55 units into the viewport, spring scales 2.3x!
        this.vm.punchGlove.position.z = -0.72 - extension * 1.55;
        this.vm.punchGlove.rotation.x = -extension * 0.16;
        this.vm.punchSpring.scale.z = 1 + extension * 2.3;
      }
      if (this.vm?.spin) {
        const spinning = this.player.firing && this.player.weapon === "chaingun";
        this.vm.spin.rotation.z += dt * (spinning ? 26 : 2);
      }
      this.vmKick = Math.max(0, this.vmKick - dt * 5.5);
    } else {
      // follow the giggling flyaway
      this.vmHolder.visible = false;
      const t = this.time - p.outAt;
      const back = new THREE.Vector3(Math.sin(p.yaw) * 5, 1 + t * 1.2, Math.cos(p.yaw) * 5);
      this.camera.position.copy(p.pos).add(back);
      this.camera.lookAt(p.pos.x, p.pos.y + 1, p.pos.z);
    }
    this.camera.updateMatrixWorld();
  }

  // ============================================================ networking
  // The host's browser is the server: it simulates the match, everyone else
  // sends inputs and renders snapshots. Clients still predict their own
  // movement, so local play feels instant on a LAN.
  bindNet(net: NetConfig) {
    for (const a of this.actors) if (a.peer) this.peerToActor.set(a.peer, a.id);
    const s = net.session;

    // route the announcer through the wire too, so everyone hears the same baby
    const rawSpeak = s2Speak(this.sfx);
    this.rawSpeakRef = rawSpeak;
    this.sfx.speak = (text: string) => {
      rawSpeak(text);
      if (!this.isClient) this.emit({ k: "voice", text });
    };

    s.onMsg = (_from: PeerId | "host", m: NetMsg) => {
      if (this.isClient) {
        if (m.t === "snap") this.applySnapshot(m.s);
        else if (m.t === "ev") this.applyEvents(m.e);
        return;
      }
      if (m.t === "inputs") {
        const a = this.actors.find((x) => x.peer === _from);
        if (!a) return;
        a.yaw = m.yaw;
        a.pitch = m.pitch;
        a.moveX = m.mx;
        a.moveZ = m.mz;
        a.wantJump = m.jump;
        a.firing = m.fire;
        const w = m.weapon as WeaponId;
        if (WEAPONS[w] && a.owned[w]) a.weapon = w;
      }
    };
  }

  /** Host: queue a cosmetic/animation event for every client. */
  emit(e: NetEvent) {
    if (this.isClient || !this.net) return;
    this.pendingEvents.push(e);
    if (this.pendingEvents.length > 48) this.pendingEvents.shift();
  }

  sendSnapshot() {
    if (!this.net || this.isClient) return;
    const a: ActorSnap[] = this.actors.map((ac) => ({
      i: ac.id,
      p: [round(ac.pos.x), round(ac.pos.y), round(ac.pos.z)],
      v: [round(ac.vel.x), round(ac.vel.y), round(ac.vel.z)],
      y: round(ac.yaw),
      pi: round(ac.pitch),
      g: Math.round(ac.giggle * 10) / 10,
      al: ac.alive ? 1 : 0,
      oa: round(ac.outAt),
      w: ac.weapon,
      am: WEAPON_ORDER.map((wd) => (ac.ammo[wd] === Infinity ? -1 : Math.floor(ac.ammo[wd] ?? 0))),
      ow: WEAPON_ORDER.reduce((mask, wd, bi) => mask | (ac.owned[wd] ? 1 << bi : 0), 0),
      q: round(ac.quadUntil),
      fr: ac.gigglesScored,
      cp: ac.caps,
      ou: ac.outs,
      nm: ac.name,
      tm: ac.team,
      kd: ac.kind,
      car: ac.carrying,
    }));
    const snap: Snapshot = {
      t: round(this.time),
      sc: [this.scores.red, this.scores.blue],
      tl: round(Math.max(0, this.matchEnd - this.time)),
      wn: this.winner ?? null,
      flags: (["red", "blue"] as Team[]).map((tf) => [
        tf,
        this.mode === "ctf"
          ? ["home", "carried", "dropped"].indexOf(this.flags[tf].state)
          : 0,
      ]),
      items: this.items.map((it) => (it.active ? 1 : 0)),
      a,
    };
    this.net.send({ t: "snap", s: snap });
    if (this.pendingEvents.length) {
      this.net.send({ t: "ev", e: this.pendingEvents }, undefined, true);
      this.pendingEvents = [];
    }
  }

  applySnapshot(sp: Snapshot) {
    this.scores.red = sp.sc[0];
    this.scores.blue = sp.sc[1];
    this.netTimeLeft = sp.tl; // clients show the host's clock
    this.winner = (sp.wn as Team | "tie" | null) ?? null;
    for (const [tf, st] of sp.flags) {
      const f = this.flags[tf as Team];
      if (f) f.state = (["home", "carried", "dropped"] as const)[st] ?? "home";
    }
    this.items.forEach((it, i) => {
      const on = sp.items[i] === 1;
      if (on !== it.active) {
        it.active = on;
        it.obj.visible = on;
      }
    });
    for (const r of sp.a) {
      const a = this.actors.find((x) => x.id === r.i);
      if (!a) continue;
      if (!a.netPos) a.netPos = new THREE.Vector3();
      a.netPos.set(r.p[0], r.p[1], r.p[2]);
      a.netYaw = r.y;
      a.pitch = r.pi;
      a.giggle = r.g;
      a.alive = r.al === 1;
      a.outAt = r.oa;
      a.weapon = r.w as WeaponId;
      a.quadUntil = r.q;
      a.gigglesScored = r.fr;
      a.caps = r.cp;
      a.outs = r.ou;
      a.carrying = r.car as Team | null;
      a.vel.set(r.v[0], r.v[1], r.v[2]);
      WEAPON_ORDER.forEach((wd, bi) => {
        a.owned[wd] = (r.ow & (1 << bi)) !== 0;
        const amt = r.am[bi];
        a.ammo[wd] = amt === -1 ? Infinity : amt;
      });
      if (a === this.player) {
        // only rebuild the view model when the weapon really changed
        if (this.netWeapon !== a.weapon) {
          this.netWeapon = a.weapon;
          this.equipViewModel(a.weapon);
        }
        // correct a badly-predicted position without a jarring snap
        if (a.pos.distanceToSquared(a.netPos) > 6.5) a.pos.lerp(a.netPos, 0.4);
      }
    }
    // let the flag meshes know who's carrying them (the client never sets this itself)
    if (this.mode === "ctf") {
      for (const t of ["red", "blue"] as Team[]) {
        const f = this.flags[t];
        if (f) f.carrier = this.actors.find((a) => a.carrying === t && a.alive) ?? null;
      }
    }
  }

  applyEvents(events: NetEvent[]) {
    for (const e of events) {
      const at = (id: number) => this.actors.find((x) => x.id === id);
      switch (e.k) {
        case "fire": {
          const a = at(e.a);
          // our own shot is already rendered locally (prediction) — skip the echo
          if (a && a !== this.player) this.remoteFire(a, e.w as WeaponId, v(e.p), v(e.d));
          break;
        }
        case "boom": {
          const p = v(e.p);
          this.sfxFor(p, e.w);
          this.spawnPuff(p, 0xfff3b0, 1.5);
          break;
        }
        case "puff":
          this.spawnPuff(v(e.p), e.c, e.s);
          break;
        case "out": {
          const a = at(e.a);
          if (a) {
            a.alive = false;
            this.sfx.giggle(CHARACTERS.find((c) => c.kind === a.kind)?.voice ?? 1, 1, this.distToPlayer(a.pos));
          }
          break;
        }
        case "respawn": {
          const a = at(e.a);
          if (a) this.sfx.boing(1.4, 0.5, this.distToPlayer(a.pos));
          break;
        }
        case "pickup": {
          const p = v(e.p);
          this.sfx.blip(1.4, 0.4, this.distToPlayer(p));
          break;
        }
        case "say":
          this.pushMessageLocal(e.text, e.color);
          break;
        case "banner":
          this.triggerBannerLocal(e.text, e.color);
          break;
        case "voice":
          this.rawSpeakRef?.(e.text);
          break;
        case "cap":
          this.sfx.announce("capture");
          break;
      }
    }
  }

  /** Clients ease every other squishy toward where the host says it should be. */
  followSnapshot(a: Actor, dt: number) {
    if (!a.netPos) return;
    const k = Math.min(1, dt * 22);
    a.pos.lerp(a.netPos, a.alive ? k : Math.min(1, dt * 8));
    if (a.netYaw !== undefined) {
      const dy = ((a.netYaw - a.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      a.yaw += dy * Math.min(1, dt * 16);
    }
    a.parts.group.position.copy(a.pos);
    a.parts.group.rotation.y = a.yaw + Math.PI;
    if (!a.alive) {
      a.parts.group.rotation.z = Math.sin(this.time * 9) * 0.4;
      a.parts.group.rotation.y += dt * 5;
    }
    animateChar(a.parts, this.time, Math.hypot(a.vel.x, a.vel.z), a.grounded, !a.alive);
    const quad = a.quadUntil > this.time;
    for (const band of a.parts.teamBand) {
      const m = band.material as THREE.MeshPhysicalMaterial;
      if (quad) {
        m.emissive.setHex(0x8a2aff);
        m.emissiveIntensity = 0.8 + Math.sin(this.time * 9) * 0.3;
      } else {
        m.emissive.setHex(TEAM_COLORS[a.team]);
        m.emissiveIntensity = 0.25;
      }
    }
  }

  rawSpeakRef?: (t: string) => void;

  private sfxFor(p: THREE.Vector3, w: string) {
    const d = this.distToPlayer(p);
    if (w === "balloon") this.sfx.splash(1, d);
    else if (w === "mines") this.sfx.fart(0.65, 0.85, 1.1, d);
    else if (w === "bfg") this.sfx.fart(0.3, 1.8, 0.7, d);
    else {
      this.sfx.pop(0.6, 1, d);
      this.sfx.squeak(0.7, 0.8, d);
    }
  }

  /** Clients replay someone else's shot as pure visuals; damage stays on the host. */
  remoteFire(a: Actor, w: WeaponId, origin: THREE.Vector3, dir: THREE.Vector3) {
    const def = WEAPONS[w];
    const dist = this.distToPlayer(origin);
    const quad = a.quadUntil > this.time;
    if (quad) this.sfx.quadFire(dist);
    if (def.mode === "projectile" || def.mode === "mine") {
      const d = dir.clone();
      if (def.spread > 0) d.x += (Math.random() - 0.5) * def.spread;
      d.normalize();
      if (w === "rocket") this.spawnRocket(a, origin, d, quad);
      else if (w === "balloon") this.spawnBalloon(a, origin, d, quad);
      else if (w === "bfg") this.spawnFartDart(a, origin, d, quad);
      else this.spawnMine(a, origin, d, quad);
      this.sfx.pop(1, 0.5, dist);
      return;
    }
    if (w === "squirt") {
      this.sfx.squeak(1.6, 0.2, dist);
      const hit = this.hitscan(a, origin, dir, 0, 0x7ef6ff, 0, 60, true);
      if (a === this.player) this.showBeam(origin, hit.point, true);
      return;
    }
    if (w === "pistol") {
      this.sfx.blip(1 + Math.random() * 0.6, 0.8, dist);
      this.hitscan(a, origin, dir, 0, 0xff4fd8, 0.17, 160);
      this.spawnLightBlink(origin, def.color);
      return;
    }
    if (w === "sniper") {
      this.sfx.babyPew(1, dist);
      this.hitscan(a, origin, dir, 0, 0xb6ff5a, 0.3, 240);
      return;
    }
    if (w === "punch") {
      this.sfx.punchWham(dist);
      return;
    }
    this.sfx.fart(0.2, 1.15, 0.45, dist);
    this.hitscan(a, origin, dir, 0, 0x5ad7ff, 0.15, 150);
  }

  sendInputs() {
    if (!this.net || !this.isClient) return;
    const p = this.player;
    this.net.send(
      { t: "inputs", yaw: round(p.yaw), pitch: round(p.pitch), mx: round(p.moveX), mz: round(p.moveZ), jump: p.wantJump, fire: p.firing, weapon: p.weapon },
      undefined,
      true,
    );
  }

  pushMessageLocal(text: string, color: string) {
    this.messages.push({ id: this.msgId++, text, color, t: this.time });
    if (this.messages.length > 5) this.messages.shift();
  }

  triggerBannerLocal(text: string, color: string) {
    this.banner = { text, color, id: this.bannerId++, until: this.time + 2.4 };
  }

  emitHUD() {
    const p = this.player;
    const board: ScoreRow[] = this.actors
      .map((a) => ({
        name: a.name,
        team: a.team,
        kind: a.kind,
        giggles: a.gigglesScored,
        caps: a.caps,
        giggledOut: a.outs,
        isPlayer: a.isPlayer,
      }))
      .sort((x, y) => y.caps * 5 + y.giggles - (x.caps * 5 + x.giggles));
    const rivalScore = Math.max(0, ...this.actors.filter((a) => a !== p).map((a) => a.gigglesScored));
    this.hud({
      giggle: p.giggle,
      weapon: p.weapon,
      ammo: { ...p.ammo },
      owned: { ...p.owned },
      scores: { ...this.scores },
      flagState: {
        red: this.mode === "ctf" ? this.flags.red.state : "home",
        blue: this.mode === "ctf" ? this.flags.blue.state : "home",
      },
      carrying: this.mode === "ctf" ? p.carrying : null,
      quad: Math.max(0, p.quadUntil - this.time),
      respawnIn: p.alive ? 0 : Math.max(0, p.respawnAt - this.time),
      timeLeft: this.netTimeLeft ?? Math.max(0, this.matchEnd - this.time),
      messages: this.messages.filter((m) => this.time - m.t < 6).map(({ id, text, color }) => ({ id, text, color })),
      pickup: this.pickupText && this.time - this.pickupText.t < 1.8 ? this.pickupText.text : null,
      hit: this.time - this.hitMarker < 0.22 ? 1 : 0,
      hurt: Math.max(0, 1 - (this.time - this.playerHurt) / 0.5),
      scope: this.scopeAmt,
      giggledOut: !p.alive,
      scoreboard: board,
      winner: this.winner,
      speed: Math.hypot(p.vel.x, p.vel.z),
      teamOfPlayer: p.team,
      banner:
        this.banner && this.time < this.banner.until
          ? { text: this.banner.text, color: this.banner.color, id: this.banner.id }
          : null,
      milkGlow: Math.max(0, (this.milkGlowUntil - this.time) / 1.2),
      mode: this.mode,
      mapName: this.mapName,
      limit: this.limit,
      over: this.over,
      mvp: this.mvp,
      net: !!this.net,
      isHost: !!this.net && !this.isClient,
      playerScore: p.gigglesScored,
      rivalScore,
    });
  }

  frame = () => {
    if (this.disposed) return;
    requestAnimationFrame(this.frame);
    const rawDt = this.clock.getDelta();
    this.updateResolution(rawDt);
    const dt = Math.min(0.05, rawDt);
    if (this.paused) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.time += dt;
    if (!this.over && this.time > this.matchEnd) this.endMatch();

    this.readPlayerInput();
    for (const a of this.actors) this.updateActor(a, dt);
    if (this.net && !this.paused) {
      if (this.isClient) {
        if (this.time - this.lastInputSend > 0.033) {
          this.lastInputSend = this.time;
          this.sendInputs();
        }
      } else if (this.time - this.lastSnapSend > 0.05) {
        this.lastSnapSend = this.time;
        this.sendSnapshot();
      }
    }
    this.updateProjectiles(dt);
    this.updateItems(dt);
    this.updateFlags(dt);
    this.updateEffects(dt);

    // chaingun fart loop & water stream (player only)
    const p = this.player;
    const firingNow = p.alive && p.firing && !this.over;
    const hasAmmo = (w: WeaponId) => WEAPONS[w].ammoPerShot === 0 || p.ammo[w] >= WEAPONS[w].ammoPerShot;
    if (firingNow && p.weapon === "chaingun" && hasAmmo("chaingun")) {
      this.chainLoop.on();
      this.chainLoop.pitch(0.85 + Math.sin(this.time * 3) * 0.12);
    } else this.chainLoop.off();
    if (firingNow && p.weapon === "squirt" && hasAmmo("squirt")) this.waterLoop.on();
    else {
      this.waterLoop.off();
      this.beamMesh.visible = false;
    }

    this.muzzleLight.intensity *= 0.82;
    this.sunLight.target.position.set(this.player.pos.x, 0, this.player.pos.z);
    this.sunLight.position.set(this.player.pos.x + 45, 70, this.player.pos.z + 35);

    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);

    if (this.time - this.lastHudEmit > 0.1) {
      this.lastHudEmit = this.time;
      this.emitHUD();
    }
  };

  /**
   * Slowly scale drawing resolution down when frame time stays above 20ms,
   * then restore it after the GPU has headroom again. Avoid reacting to single
   * spikes (tab switching, shader compilation, etc.).
   */
  updateResolution(rawDt: number) {
    if (rawDt > 0 && rawDt < 0.2) this.averageFrameMs += (rawDt * 1000 - this.averageFrameMs) * 0.035;
    const now = performance.now();
    if (now - this.lastResolutionCheck < 1200) return;
    this.lastResolutionCheck = now;

    let next = this.resolutionScale;
    if (this.averageFrameMs > 21 && next > 0.65) next = Math.max(0.65, next - 0.1);
    else if (this.averageFrameMs < 15.5 && next < 1) next = Math.min(1, next + 0.05);
    if (Math.abs(next - this.resolutionScale) < 0.001) return;

    this.resolutionScale = next;
    this.renderer.setPixelRatio(this.maxPixelRatio * next);
    this.renderer.setSize(this.viewWidth, this.viewHeight, false);
  }

  resize(w: number, h: number) {
    this.viewWidth = Math.max(1, w);
    this.viewHeight = Math.max(1, h);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  start() {
    this.clock.start();
    this.frame();
  }

  dispose() {
    this.disposed = true;
    this.chainLoop.off();
    this.chainLoop.dispose();
    this.waterLoop.off();
    for (const p of this.projectiles) p.whistle?.stop();
    this.disposeViewModel();
    this.environmentTexture?.dispose();
    this.scene.environment = null;
    if (this.scene.background instanceof THREE.Texture) this.scene.background.dispose();
    if (this.sky instanceof THREE.Mesh) {
      this.sky.geometry.dispose();
      const material = this.sky.material;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material.dispose();
    }
    this.renderer.dispose();
  }
}
