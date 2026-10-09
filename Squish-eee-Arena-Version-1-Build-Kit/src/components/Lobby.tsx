import { useEffect, useRef, useState } from "react";
import { MAPS, type GameMode } from "../game/arena";
import { CHARACTERS, type CharKind } from "../game/models";
import {
  Net,
  makeRoomCode,
  makeClientId,
  guessServer,
  type LobbyPeer,
  type LobbySlot,
  type StartConfig,
} from "../game/net";

const BOT_NAMES = [
  "Mr. Wigglebottom", "Captain Drool", "Sir Bonkers", "Lady Nibbles",
  "Professor Boop", "Tiny Tornado", "Admiral Snuggles", "Doctor Wobble",
  "Jellybean", "Pickles", "Squish", "Boop",
];

function shuffled<T>(arr: T[], seed: number): T[] {
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export interface LaunchArgs {
  net: Net;
  role: "host" | "client";
  localPeer: string;
  cfg: StartConfig;
}

export default function Lobby({
  kind,
  onKind,
  onStart,
  onBack,
}: {
  kind: CharKind;
  onKind: (k: CharKind) => void;
  onStart: (args: LaunchArgs) => void;
  onBack: () => void;
}) {
  const [tab, setTab] = useState<"host" | "join">("host");
  const [server, setServer] = useState(guessServer());
  const [embedPage, setEmbedPage] = useState(() =>
    typeof window === "undefined"
      ? "https://your-domain.example/squish-eee/"
      : `${window.location.origin}/squish-eee/`,
  );
  const [embedCopied, setEmbedCopied] = useState(false);
  const [room, setRoom] = useState("");
  const [peers, setPeers] = useState<LobbyPeer[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mapId, setMapId] = useState("canyon");
  const [mode, setMode] = useState<GameMode | "">("");
  const [conn, setConn] = useState<[number, number] | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [done, setDone] = useState(false);

  const netRef = useRef<Net | null>(null);
  const clientIdRef = useRef<string>("");
  const map = MAPS.find((m) => m.id === mapId)!;
  const activeMode: GameMode = (mode || map.modes[0]) as GameMode;
  const embedSrc = embedPage.trim() || "https://your-domain.example/squish-eee/";
  const embedCode = `<iframe\n  src="${embedSrc.replace(/"/g, "&quot;")}"\n  title="Squish-eee Arena"\n  width="100%"\n  height="720"\n  loading="lazy"\n  allow="fullscreen; pointer-lock; gamepad; autoplay"\n  allowfullscreen\n  style="display:block;width:100%;max-width:1280px;height:720px;border:0;border-radius:18px;background:#141026"\n></iframe>`;

  useEffect(() => {
    return () => {
      netRef.current?.close();
      netRef.current = null;
    };
  }, []);

  const wire = (role: "host" | "client", onCfg?: (cfg: StartConfig) => void) => {
    const net = new Net({
      role,
      server,
      room,
      peerId: role === "host" ? "host" : clientIdRef.current,
      name: "You",
      kind,
      onLobby: (p) => setPeers(p),
      onReady: (o, t) => setConn([o, t]),
      onClosed: () => setStatus("A connection was lost."),
      onSignal: (e) => setErr(e),
      onStart: onCfg,
    });
    netRef.current = net;
    return net;
  };

  // ----------------------------------------------------------------- host
  const createHost = async () => {
    setErr(null);
    setStatus("Starting lobby…");
    setConnecting(true);
    setPeers([]);
    const code = makeRoomCode();
    setRoom(code);
    try {
      const net = wire("host");
      await net.join();
      setStatus(`Lobby open! Room ${code}. Share the room code + server with friends.`);
    } catch (e) {
      setErr("Could not reach the lobby server. Is `node server.mjs` running? " + (e as Error).message);
    } finally {
      setConnecting(false);
    }
  };

  // Build the full roster the host ships: humans + bots up to the map's size.
  const buildRoster = (): LobbySlot[] => {
    const seed = Math.floor(Math.random() * 1e9);
    const per = map.teamSize; // 0 for ffa / dm
    const slots: LobbySlot[] = peers.map((p) => ({
      peer: p.peer,
      name: p.name,
      kind: p.kind,
      team: "red",
      bot: false,
      ready: true,
      isHost: p.role === "host",
    }));
    const namePool = shuffled(BOT_NAMES, seed);
    const kinds = shuffled(CHARACTERS.map((c) => c.kind), seed ^ 0x9e37);
    // balance teams, then top up with bots to the map's designed player count
    for (const s of slots) {
      const reds = slots.filter((x) => x.team === "red").length;
      const blues = slots.length - reds;
      s.team = per > 0 ? (reds < per ? "red" : "blue") : reds <= blues ? "red" : "blue";
    }
    const need = Math.max(0, map.maxPlayers - slots.length);
    for (let b = 0; b < need; b++) {
      const reds = slots.filter((x) => x.team === "red").length;
      const blues = slots.length - reds;
      const team = per > 0 ? (reds < per ? "red" : "blue") : reds <= blues ? "red" : "blue";
      slots.push({
        peer: "",
        name: namePool[b % namePool.length],
        kind: kinds[b % kinds.length],
        team,
        bot: true,
        ready: true,
        isHost: false,
      });
    }
    return slots;
  };

  const startHost = () => {
    const net = netRef.current;
    if (!net) return;
    const cfg: StartConfig = {
      mapId,
      mode: activeMode,
      seed: Math.floor(Math.random() * 1e9),
      roster: buildRoster(),
      botCount: 0,
    };
    setDone(true);
    net.sendSignal("*", { type: "start", config: cfg });
    netRef.current = null; // hand ownership to the game (don't close on unmount)
    onStart({ net, role: "host", localPeer: "host", cfg });
  };

  // ----------------------------------------------------------------- join
  const createJoin = async () => {
    setErr(null);
    if (!room.trim()) {
      setErr("Enter the room code first.");
      return;
    }
    setStatus("Joining…");
    setConnecting(true);
    setPeers([]);
    clientIdRef.current = makeClientId();
    try {
      const net = wire("client", (cfg) => {
        setDone(true);
        netRef.current = null; // hand ownership to the game (don't close on unmount)
        onStart({ net, role: "client", localPeer: clientIdRef.current, cfg });
      });
      await net.join();
      setStatus(`Joined room ${room}! Waiting for the host to start…`);
    } catch (e) {
      setErr("Could not join. Check the room code and that the server is up. " + (e as Error).message);
    } finally {
      setConnecting(false);
    }
  };

  const clientConnected = conn !== null && conn[0] >= 1;
  const allReady = conn === null || (conn[1] === 0) || conn[0] === conn[1];

  const copyEmbed = async () => {
    try {
      await navigator.clipboard.writeText(embedCode);
    } catch {
      const field = document.getElementById("squish-embed-code") as HTMLTextAreaElement | null;
      field?.focus();
      field?.select();
      document.execCommand("copy");
    }
    setEmbedCopied(true);
    window.setTimeout(() => setEmbedCopied(false), 1600);
  };

  return (
    <div className="absolute inset-0 overflow-auto bg-[radial-gradient(circle_at_50%_-10%,#e9f7ff,#c9ecff_45%,#a7d8ff_100%)] text-slate-800">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <header className="text-center">
          <h2
            className="text-5xl font-black tracking-tight text-transparent"
            style={{
              backgroundImage: "linear-gradient(90deg,#6ee86e,#5ad7ff,#b46bff)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              filter: "drop-shadow(0 3px 0 rgba(255,255,255,.85))",
            }}
          >
            LAN link-up
          </h2>
          <p className="mt-1 text-base font-bold text-slate-600">Play with friends on the same network.</p>
        </header>

        {/* Self-hosting: the generated iframe points at the user's own static copy. */}
        <details className="mt-5 rounded-3xl border-4 border-white bg-white/80 p-5 shadow-xl">
          <summary className="cursor-pointer list-none text-sm font-black uppercase tracking-wide text-slate-700">
            <span className="mr-2 text-lg">📦</span>
            Embed on your own website
            <span className="float-right text-xs font-bold normal-case tracking-normal text-slate-500">
              Copy the game to a permanent domain
            </span>
          </summary>
          <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
            <label className="block">
              <span className="text-xs font-black uppercase tracking-wide text-slate-500">
                Your hosted game page URL
              </span>
              <input
                type="url"
                value={embedPage}
                onChange={(e) => setEmbedPage(e.target.value)}
                placeholder="https://your-domain.example/squish-eee/"
                className="mt-1 w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-700 outline-none focus:border-amber-400"
              />
            </label>
            <button
              type="button"
              onClick={copyEmbed}
              className="rounded-xl bg-slate-800 px-5 py-2.5 text-sm font-black uppercase tracking-wide text-white transition hover:bg-slate-700"
            >
              {embedCopied ? "Copied" : "Copy iframe"}
            </button>
          </div>
          <textarea
            id="squish-embed-code"
            aria-label="Embeddable iframe code"
            readOnly
            value={embedCode}
            onFocus={(e) => e.currentTarget.select()}
            className="mt-3 h-40 w-full resize-y rounded-xl border-2 border-slate-700 bg-slate-950 p-3 font-mono text-xs leading-relaxed text-emerald-200 outline-none"
          />
          <div className="mt-3 rounded-xl bg-sky-50 px-4 py-3 text-xs leading-relaxed text-sky-950">
            <b>To keep playing after this site's URL expires:</b> run <code className="rounded bg-white px-1 font-mono">npm run build</code>,
            upload <code className="rounded bg-white px-1 font-mono">dist/index.html</code> to your own site as
            <code className="mx-1 rounded bg-white px-1 font-mono">/squish-eee/index.html</code>, set the URL above to that page,
            then paste the iframe into any page you control. This build inlines the game code, so that single HTML file is the game client.
            <br /><br />
            <b>Important:</b> the iframe embeds the game client; it does not create a signaling server. For multiplayer, keep
            <code className="mx-1 rounded bg-white px-1 font-mono">node server.mjs</code> running at a reachable address and enter that
            address in the LAN server field below. Static hosting alone cannot accept LAN connections.
          </div>
        </details>

        {/* step 0 — the lobby server */}
        <div className="mt-5 rounded-3xl border-4 border-white bg-amber-50/90 p-5 shadow-xl">
          <h3 className="text-sm font-black uppercase tracking-wide text-amber-800">Step 1 · the lobby server</h3>
          <p className="mt-1 text-sm leading-relaxed text-amber-900/80">
            One machine acts as the lobby. If you're playing the <b>Windows desktop build</b>, that's already
            running — the address in the title bar just works, so paste it below.
            Otherwise run <code className="rounded bg-white/70 px-1.5 py-0.5 font-mono text-xs">node server.mjs</code>.
            It hosts the lobby and the handshake only — the actual game streams peer-to-peer after that.
            Everyone enters the server's <b>LAN IP:port</b> below (default port <b>4870</b>).
          </p>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs font-black uppercase text-amber-700">Server</span>
            <input
              value={server}
              onChange={(e) => setServer(e.target.value)}
              placeholder="http://192.168.1.4:4870"
              className="min-w-0 flex-1 rounded-xl border-2 border-amber-200 bg-white px-3 py-2 font-mono text-sm font-bold text-slate-700 outline-none focus:border-amber-400"
            />
          </div>
        </div>

        {/* step 1 — host or join */}
        <div className="mt-4 flex justify-center gap-2">
          {(["host", "join"] as const).map((t) => (
            <button
              key={t}
              onClick={() => !done && setTab(t)}
              className={`rounded-2xl px-8 py-2.5 text-base font-black uppercase tracking-wide shadow-lg transition-transform ${
                tab === t ? "scale-105 bg-white text-slate-800" : "bg-white/50 text-slate-500 hover:bg-white/70"
              }`}
            >
              {t === "host" ? "🎮 Host" : "🔗 Join"}
            </button>
          ))}
        </div>

        <div className="mt-4 rounded-3xl border-4 border-white bg-white/80 p-5 shadow-xl backdrop-blur">
          {tab === "host" ? (
            <>
              {!netRef.current ? (
                <div className="text-center">
                  <p className="text-sm font-bold text-slate-600">
                    Create a lobby. Friends pick <b>Join</b>, enter this same server and the room code you'll see.
                  </p>
                  <button
                    onClick={createHost}
                    disabled={connecting || done}
                    className="mt-4 rounded-2xl bg-gradient-to-br from-emerald-400 to-sky-400 px-8 py-3.5 text-lg font-black text-white shadow-lg transition-transform hover:scale-105 disabled:opacity-50"
                  >
                    {connecting ? "Opening…" : " Open a lobby"}
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-emerald-50 px-4 py-3">
                    <div>
                      <div className="text-xs font-black uppercase tracking-wide text-emerald-700">Room code</div>
                      <div className="font-mono text-2xl font-black tracking-widest text-emerald-800">{room}</div>
                    </div>
                    <div className="text-right text-xs font-bold text-emerald-700">
                      {conn ? `📶 ${conn[0]}/${conn[1]} linked` : "waiting for players…"}
                    </div>
                  </div>

                  {/* player list */}
                  <div className="mt-3 space-y-1.5">
                    {peers.map((p) => (
                      <div
                        key={p.peer}
                        className={`flex items-center justify-between rounded-2xl border-2 px-3 py-2 ${
                          p.role === "host" ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">🧸</span>
                          <div>
                            <div className="text-sm font-black capitalize text-slate-800">
                              {p.name} {p.role === "host" && <span className="text-emerald-600">(you)</span>}
                            </div>
                            <div className="text-xs capitalize text-slate-500">{p.kind}</div>
                          </div>
                        </div>
                        <span
                          className={`rounded-lg px-2 py-0.5 text-xs font-black uppercase text-white ${
                            "bg-slate-400"
                          }`}
                        >
                          {p.role === "host" ? "host" : "player"}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* map + mode */}
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-black uppercase tracking-wide text-slate-500">Map</label>
                      <select
                        value={mapId}
                        onChange={(e) => {
                          setMapId(e.target.value);
                          setMode("");
                        }}
                        className="w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:border-amber-400"
                      >
                        {MAPS.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name} — {m.tag}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-black uppercase tracking-wide text-slate-500">Mode</label>
                      <select
                        value={activeMode}
                        onChange={(e) => setMode(e.target.value as GameMode)}
                        className="w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:border-amber-400"
                      >
                        {map.modes.map((m) => (
                          <option key={m} value={m}>
                            {m === "ctf" ? "Capture the Flag" : m === "tdm" ? "Team Squishmatch" : m === "ffa" ? "Free For All" : "Squishmatch"}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    {map.maxPlayers - peers.length > 0 ? `${map.maxPlayers - peers.length} seat${map.maxPlayers - peers.length === 1 ? "" : "s"} will fill with playpen bots.` : "All seats are taken by players."}
                  </p>

                  <button
                    onClick={startHost}
                    disabled={connecting || done || !allReady}
                    className="mt-4 w-full rounded-2xl bg-gradient-to-br from-pink-500 to-amber-400 px-6 py-4 text-xl font-black text-white shadow-lg transition-transform hover:scale-[1.02] disabled:opacity-50"
                  >
                    {allReady ? "▶ Start the match" : "Waiting for players to link…"}
                  </button>
                  {!allReady && (
                    <p className="mt-2 text-center text-xs font-bold text-amber-600">
                      Some players aren't fully linked yet — give it a second, or start anyway once the counter fills.
                    </p>
                  )}
                </>
              )}
            </>
          ) : (
            <>
              <label className="mb-1 block text-xs font-black uppercase tracking-wide text-slate-500">Room code</label>
              <div className="flex gap-2">
                <input
                  value={room}
                  onChange={(e) => setRoom(e.target.value.toUpperCase())}
                  placeholder="e.g. PLAY-1234"
                  className="min-w-0 flex-1 rounded-xl border-2 border-slate-200 bg-white px-3 py-2.5 font-mono text-lg font-black tracking-widest text-slate-700 outline-none focus:border-sky-400"
                />
                <button
                  onClick={createJoin}
                  disabled={connecting || done}
                  className="rounded-xl bg-sky-400 px-6 py-2.5 text-sm font-black uppercase text-white hover:bg-sky-500 disabled:opacity-50"
                >
                  {connecting ? "…" : "Join"}
                </button>
              </div>

              {netRef.current && (
                <div className="mt-4">
                  <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm font-bold text-slate-600">
                    In room <span className="font-mono font-black text-slate-800">{room}</span> · {peers.length} here ·{" "}
                    {clientConnected ? "📶 linked" : "linking…"}
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {peers.map((p) => (
                      <div key={p.peer} className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm font-bold text-slate-700">
                        <span>🧸</span> <span className="capitalize">{p.name}</span>
                        {p.role === "host" && <span className="text-xs text-emerald-600">(host)</span>}
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-center text-sm font-bold text-slate-500">
                    Waiting for the host to start the match…
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* your squishy */}
        <div className="mt-4 rounded-3xl border-4 border-white bg-white/70 p-4 shadow-xl">
          <h3 className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">You'll play as</h3>
          <div className="flex flex-wrap gap-1.5">
            {CHARACTERS.map((c) => (
              <button
                key={c.kind}
                onClick={() => onKind(c.kind)}
                className={`rounded-xl border-2 px-3 py-1.5 text-xs font-black capitalize transition-all ${
                  kind === c.kind ? "scale-105 border-amber-400 bg-amber-100" : "border-white bg-white/80 hover:border-pink-300"
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>

        {(status || err) && (
          <div className={`mt-4 rounded-2xl px-4 py-3 text-sm font-bold ${err ? "bg-rose-100 text-rose-700" : "bg-sky-100 text-sky-800"}`}>
            {err || status}
          </div>
        )}

        <div className="mt-6 text-center">
          <button
            onClick={() => {
              netRef.current?.close();
              netRef.current = null;
              onBack();
            }}
            className="rounded-2xl bg-white/70 px-6 py-3 text-base font-black text-slate-700 shadow-lg transition-transform hover:scale-105 active:scale-95"
          >
            ← Back
          </button>
        </div>
      </div>
    </div>
  );
}
