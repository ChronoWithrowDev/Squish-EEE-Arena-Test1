import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import Menu from "./components/Menu";
import MapSelect from "./components/MapSelect";
import HUD from "./components/HUD";
import { Game, type HUDState, type NetConfig } from "./game/engine";
import type { LaunchArgs } from "./components/Lobby";
import { getSFX } from "./game/audio";
import type { CharKind } from "./game/models";
import type { GameMode } from "./game/arena";

// Networking stays out of the initial bundle and solo boot path.
const Lobby = lazy(() => import("./components/Lobby"));

/** A visible safety net: never leave a player staring at an unexplained black page. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };

  static getDerivedStateFromError(error: Error) {
    return { error: error.message || "Unknown startup error" };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[squish] React crashed", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6 font-[Fredoka,system-ui] text-white">
        <div className="max-w-xl rounded-3xl border-4 border-rose-300 bg-slate-900 p-7 shadow-2xl">
          <div className="text-5xl">🧸💥</div>
          <h1 className="mt-3 text-2xl font-black">The playpen hit a snag</h1>
          <p className="mt-2 text-slate-300">The game caught a startup error instead of leaving a black screen.</p>
          <pre className="mt-4 overflow-auto rounded-xl bg-black/40 p-3 text-xs text-rose-200">{this.state.error}</pre>
          <button
            onClick={() => window.location.reload()}
            className="mt-5 rounded-2xl bg-gradient-to-br from-pink-500 to-amber-400 px-5 py-3 font-black"
          >
            Reload playpen
          </button>
        </div>
      </div>
    );
  }
}

// Load the bubbly UI font at runtime (kept out of the HTML so the single-file build stays offline-safe).
if (typeof document !== "undefined" && !document.getElementById("fredoka-font")) {
  const link = document.createElement("link");
  link.id = "fredoka-font";
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&display=swap";
  document.head.appendChild(link);
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [phase, setPhase] = useState<"menu" | "maps" | "lobby" | "game">("menu");
  const [kind, setKind] = useState<CharKind>("lion");
  const [mapId, setMapId] = useState("canyon");
  const [netCfg, setNetCfg] = useState<NetConfig | null>(null);
  const [hud, setHud] = useState<HUDState | null>(null);
  const [locked, setLocked] = useState(false);
  const [board, setBoard] = useState(false);
  const [round, setRound] = useState(0);
  const [bootError, setBootError] = useState<string | null>(null);

  // ------------------------------------------------------------ game setup
  useEffect(() => {
    if (phase !== "game" || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const sfx = getSFX();
    sfx.resume();

    let g: Game;
    let unbind = () => {};
    try {
      g = new Game(canvas, kind, mapId, (s) => setHud(s), netCfg ?? undefined);
      gameRef.current = g;
      unbind = g.bindInput(canvas);
      g.paused = true;
      g.start();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setBootError(message);
      setLocked(false);
      return () => {};
    }

    const onResize = () => g.resize(window.innerWidth, window.innerHeight);
    onResize();
    window.addEventListener("resize", onResize);

    const onLockChange = () => {
      const l = document.pointerLockElement === canvas;
      setLocked(l);
      g.paused = !l;
      if (l) sfx.resume();
      else g.releaseInputs(); // never leave fire / scope "stuck" when the pointer is released
    };
    document.addEventListener("pointerlockchange", onLockChange);

    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Tab") {
        e.preventDefault();
        setBoard(true);
      }
      if (e.code === "KeyR" && g.over) {
        document.exitPointerLock?.();
        setRound((r) => r + 1);
      }
      if (e.code === "Escape") document.exitPointerLock?.();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Tab") setBoard(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);

    return () => {
      window.removeEventListener("resize", onResize);
      document.removeEventListener("pointerlockchange", onLockChange);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      unbind();
      g.dispose();
      gameRef.current = null;
    };
  }, [phase, kind, mapId, round, netCfg]);

  const requestLock = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    getSFX().resume();
    try {
      const r = c.requestPointerLock?.() as unknown as Promise<void> | undefined;
      if (r && typeof r.catch === "function") r.catch(() => undefined);
    } catch {
      /* pointer lock can fail if requested too quickly — ignore */
    }
  }, []);

  const startGame = () => {
    getSFX().resume();
    setBootError(null);
    setPhase("game");
    // Keep the start curtain visible until the player clicks. It makes startup
    // failures visible instead of presenting a silent black, pointer-locked screen.
  };

  const closeNet = () => {
    netCfg?.session.close();
    setNetCfg(null);
  };

  const quitToMenu = () => {
    document.exitPointerLock?.();
    closeNet();
    setHud(null);
    setPhase("menu");
  };

  const quitToMaps = () => {
    document.exitPointerLock?.();
    closeNet();
    setHud(null);
    setPhase("maps");
  };

  const startNetGame = (a: LaunchArgs) => {
    setBootError(null);
    setMapId(a.cfg.mapId);
    setNetCfg({
      session: a.net,
      role: a.role,
      localPeer: a.localPeer,
      slots: a.cfg.roster,
      botCount: a.cfg.roster.filter((s) => s.bot).length,
      seed: a.cfg.seed,
      mode: a.cfg.mode as GameMode,
    });
    setPhase("game");
  };

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-slate-900">
      <canvas
        ref={canvasRef}
        onClick={requestLock}
        className={`block h-full w-full ${phase === "game" ? "" : "hidden"} [filter:saturate(1.14)_brightness(0.94)]`}
      />

      {phase === "game" && hud && <HUD s={hud} scoreboard={board} />}

      {/* click-to-play / pause curtain */}
      {phase === "game" && (!locked || bootError) && (
        <div
          className="absolute inset-0 flex cursor-pointer flex-col items-center justify-center bg-slate-900/70 backdrop-blur-sm"
          onClick={bootError ? undefined : requestLock}
        >
          <div className="rounded-3xl border-4 border-white/30 bg-white/10 px-10 py-8 text-center text-white shadow-2xl">
            <div className="text-5xl">🫧🦁🎈</div>
            <h2 className="mt-3 text-3xl font-black">
              {bootError ? "The playpen needs a quick reset" : hud?.over ? "Match over!" : "Click to squish in"}
            </h2>
            {bootError && (
              <p className="mx-auto mt-3 max-w-lg rounded-xl bg-rose-950/40 px-4 py-3 text-left font-mono text-xs text-rose-100">
                {bootError}
              </p>
            )}
            {hud && (
              <p className="mt-1 text-sm font-bold uppercase tracking-widest text-amber-200">
                {hud.mapName}
              </p>
            )}
            <p className="mt-1 text-white/70">
              Mouse look + WASD. Press <b>Esc</b> any time to free the cursor.
            </p>
            {hud?.over && (
              <p className="mt-2 text-amber-200">
                Press <b>R</b> for a rematch, or pick another playpen below.
              </p>
            )}
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              {!bootError && <button
                onClick={(e) => {
                  e.stopPropagation();
                  requestLock();
                }}
                className="pointer-events-auto rounded-2xl bg-gradient-to-br from-pink-500 to-amber-400 px-6 py-3 text-lg font-black shadow-lg transition-transform hover:scale-105"
              >
                Resume
              </button>}
              {bootError && <button
                onClick={(e) => {
                  e.stopPropagation();
                  setBootError(null);
                  setPhase("maps");
                }}
                className="pointer-events-auto rounded-2xl bg-gradient-to-br from-pink-500 to-amber-400 px-6 py-3 text-lg font-black shadow-lg transition-transform hover:scale-105"
              >
                Back to maps
              </button>}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setRound((r) => r + 1);
                }}
                className="pointer-events-auto rounded-2xl bg-white/20 px-6 py-3 text-lg font-black shadow-lg transition-transform hover:scale-105"
              >
                Restart
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  quitToMaps();
                }}
                className="pointer-events-auto rounded-2xl bg-white/20 px-6 py-3 text-lg font-black shadow-lg transition-transform hover:scale-105"
              >
                Change map
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  quitToMenu();
                }}
                className="pointer-events-auto rounded-2xl bg-white/20 px-6 py-3 text-lg font-black shadow-lg transition-transform hover:scale-105"
              >
                Change squishy
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === "menu" && (
        <Menu selected={kind} onSelect={setKind} onStart={() => setPhase("maps")} />
      )}

      {phase === "maps" && (
        <MapSelect
          kind={kind}
          selected={mapId}
          onSelect={setMapId}
          onPlay={startGame}
          onBack={() => setPhase("menu")}
          onMultiplayer={() => setPhase("lobby")}
        />
      )}

      {phase === "lobby" && (
        <Suspense
          fallback={
            <div className="absolute inset-0 flex items-center justify-center bg-sky-100 text-xl font-black text-slate-700">
              Opening the LAN playpen…
            </div>
          }
        >
          <Lobby
            kind={kind}
            onKind={setKind}
            onStart={startNetGame}
            onBack={() => setPhase("maps")}
          />
        </Suspense>
      )}
    </div>
  );
}
