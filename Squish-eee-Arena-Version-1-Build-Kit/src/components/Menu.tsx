import { useEffect, useRef } from "react";
import * as THREE from "three";
import { CHARACTERS, buildCharacter, animateChar, type CharKind } from "../game/models";
import { WEAPONS, WEAPON_ORDER } from "../game/weapons";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

function Preview({ kind }: { kind: CharKind }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(38, canvas.clientWidth / canvas.clientHeight, 0.1, 50);
    cam.position.set(0, 2.55, 8.2);
    cam.lookAt(0, 1.75, 0);
    // glossy studio reflections so the toys look like real plastic and plush
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.7;
    pmrem.dispose();
    scene.add(new THREE.HemisphereLight(0xdff2ff, 0xffd7b0, 0.8));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(3, 5, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xff9ecb, 1.4);
    rim.position.set(-4, 2, -3);
    scene.add(rim);
    const parts = buildCharacter(kind, 0xffd34d);
    scene.add(parts.group);
    let raf = 0;
    let t = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      t += 0.016;
      parts.group.rotation.y = t * 0.8;
      parts.group.position.y = Math.sin(t * 2) * 0.05;
      animateChar(parts, t, 5, true, false);
      renderer.render(scene, cam);
    };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      renderer.dispose();
    };
  }, [kind]);
  return <canvas ref={ref} className="h-full w-full" />;
}

export default function Menu({
  selected,
  onSelect,
  onStart,
}: {
  selected: CharKind;
  onSelect: (k: CharKind) => void;
  onStart: () => void;
}) {
  const info = CHARACTERS.find((c) => c.kind === selected)!;
  return (
    <div className="absolute inset-0 overflow-auto bg-[radial-gradient(circle_at_50%_-10%,#ffe6f3,#cfeaff_45%,#a7d8ff_100%)] text-slate-800">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <header className="text-center">
          <h1
            className="text-6xl font-black tracking-tight text-transparent sm:text-7xl"
            style={{
              backgroundImage: "linear-gradient(90deg,#ff6ba6,#ffb43d,#6ee86e,#5ad7ff,#b46bff)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              filter: "drop-shadow(0 4px 0 rgba(255,255,255,.8))",
            }}
          >
            SQUISH-EEE ARENA
          </h1>
          <p className="mt-1 text-lg font-bold text-slate-600">
            Capture the Flag · 4&nbsp;v&nbsp;4 · Nobody gets hurt, everybody gets the giggles
          </p>
        </header>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          {/* character select */}
          <section className="rounded-3xl border-4 border-white bg-white/70 p-5 shadow-xl backdrop-blur">
            <h2 className="mb-3 text-xl font-black uppercase tracking-wide text-slate-700">
              Pick your squishy
            </h2>
            <div className="grid grid-cols-[1fr_200px] gap-4">
              <div className="grid grid-cols-2 gap-2">
                {CHARACTERS.map((c) => (
                  <button
                    key={c.kind}
                    onClick={() => onSelect(c.kind)}
                    className={`rounded-2xl border-4 p-3 text-left transition-all ${
                      selected === c.kind
                        ? "scale-[1.02] border-amber-400 bg-amber-100 shadow-lg"
                        : "border-white bg-white/80 hover:border-pink-300"
                    }`}
                  >
                    <div className="text-base font-black text-slate-800">{c.name}</div>
                    <div className="text-[11px] font-bold uppercase tracking-wide text-pink-500">
                      {c.kind} · {c.finish}
                    </div>
                    <div className="mt-1 text-xs leading-snug text-slate-500">{c.blurb}</div>
                  </button>
                ))}
              </div>
              <div className="flex flex-col">
                <div
                  className="h-56 rounded-2xl border-4 border-white shadow-inner"
                  style={{ background: `radial-gradient(circle at 50% 30%, #ffffff, ${info.accent}55)` }}
                >
                  <Preview kind={selected} />
                </div>
                <button
                  onClick={onStart}
                  className="mt-3 rounded-2xl bg-gradient-to-br from-pink-500 to-amber-400 px-6 py-4 text-xl font-black text-white shadow-lg transition-transform hover:scale-105 active:scale-95"
                >
                  NEXT: PICK A MAP 🗺️
                </button>
              </div>
            </div>
          </section>

          {/* arsenal */}
          <section className="rounded-3xl border-4 border-white bg-white/70 p-5 shadow-xl backdrop-blur">
            <h2 className="mb-3 text-xl font-black uppercase tracking-wide text-slate-700">
              The silly arsenal
            </h2>
            <ul className="space-y-1.5">
              {WEAPON_ORDER.map((w) => {
                const d = WEAPONS[w];
                return (
                  <li key={w} className="flex items-start gap-3 rounded-xl bg-white/80 px-3 py-2">
                    <span className="text-2xl">{d.icon}</span>
                    <div>
                      <div className="text-sm font-black text-slate-800">
                        <span className="mr-1 rounded bg-slate-200 px-1.5 text-xs">{d.slot}</span>
                        {d.name}
                      </div>
                      <div className="text-xs text-slate-500">{d.blurb}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        <section className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-3xl border-4 border-white bg-white/70 p-4 shadow-lg">
            <h3 className="font-black uppercase tracking-wide text-slate-700">Controls</h3>
            <ul className="mt-1 space-y-0.5 text-sm text-slate-600">
              <li><b>WASD</b> waddle · <b>Space</b> hop · <b>Mouse</b> look</li>
              <li><b>Click</b> fire · <b>Right-click</b> (hold) scope / aim</li>
              <li><b>1-9</b> / <b>wheel</b> / <b>Q</b>·<b>E</b> swap toys</li>
              <li><b>Tab</b> scoreboard · <b>Esc</b> release mouse · <b>R</b> rematch</li>
            </ul>
          </div>
          <div className="rounded-3xl border-4 border-white bg-white/70 p-4 shadow-lg">
            <h3 className="font-black uppercase tracking-wide text-slate-700">Giggle rules</h3>
            <ul className="mt-1 space-y-0.5 text-sm text-slate-600">
              <li>No health — you collect <b>giggle points</b> 0→100.</li>
              <li>At 100 you cackle and <b>float out of the arena</b>, back in 3s.</li>
              <li>🧃 <b>Serious Juice</b> takes the giggles away.</li>
              <li>🍼 <b>Warm Milk Bottle</b> wipes your <b>whole team's giggles to 0!</b></li>
              <li>💜 <b>Quad Giggle</b> on the bridge = 4× tickling.</li>
            </ul>
          </div>
          <div className="rounded-3xl border-4 border-white bg-white/70 p-4 shadow-lg">
            <h3 className="font-black uppercase tracking-wide text-slate-700">Canyon Playpen</h3>
            <ul className="mt-1 space-y-0.5 text-sm text-slate-600">
              <li>Bases at both ends of the canyon floor.</li>
              <li>Block stairs & bouncy pads climb to the cliff tops.</li>
              <li>The bridge crosses the middle — quad sits dead centre.</li>
              <li>First to <b>5 captures</b> wins!</li>
            </ul>
          </div>
        </section>
        <p className="mt-6 text-center text-xs text-slate-500">
          Tip: fire a 💦 water balloon at your own feet while hopping for a classic splash-jump.
        </p>
      </div>
    </div>
  );
}
