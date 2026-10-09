import { MAPS, MODE_LABEL } from "../game/arena";
import { CHARACTERS, type CharKind } from "../game/models";

const MAP_ART: Record<string, { emoji: string; from: string; to: string }> = {
  canyon: { emoji: "🏜️", from: "#ffe6b8", to: "#ffb4a2" },
  playpen: { emoji: "🧸", from: "#e3f2ff", to: "#ffc9e0" },
  toybox: { emoji: "🧱", from: "#d8efff", to: "#ffe6a6" },
  pond: { emoji: "🦆", from: "#b8efff", to: "#b9f3b4" },
};

export default function MapSelect({
  kind,
  selected,
  onSelect,
  onPlay,
  onBack,
  onMultiplayer,
}: {
  kind: CharKind;
  selected: string;
  onSelect: (id: string) => void;
  onPlay: () => void;
  onBack: () => void;
  onMultiplayer: () => void;
}) {
  const char = CHARACTERS.find((c) => c.kind === kind)!;
  const map = MAPS.find((m) => m.id === selected) ?? MAPS[0];

  return (
    <div className="absolute inset-0 overflow-auto bg-[radial-gradient(circle_at_50%_-10%,#ffe6f3,#cfeaff_45%,#a7d8ff_100%)] text-slate-800">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <header className="text-center">
          <h2
            className="text-5xl font-black tracking-tight text-transparent"
            style={{
              backgroundImage: "linear-gradient(90deg,#5ad7ff,#b46bff,#ff6ba6)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              filter: "drop-shadow(0 3px 0 rgba(255,255,255,.85))",
            }}
          >
            Pick a playpen
          </h2>
          <p className="mt-1 text-base font-bold text-slate-600">
            You're bringing <span style={{ color: "#db2777" }}>{char.name}</span> the {char.kind} 🧸
          </p>
        </header>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {MAPS.map((m) => {
            const art = MAP_ART[m.id] ?? { emoji: "🎈", from: "#fff", to: "#eee" };
            const active = m.id === selected;
            return (
              <button
                key={m.id}
                onClick={() => onSelect(m.id)}
                className={`group overflow-hidden rounded-3xl border-4 text-left shadow-xl transition-all ${
                  active
                    ? "scale-[1.02] border-amber-400 ring-4 ring-amber-200"
                    : "border-white hover:border-pink-300"
                }`}
              >
                <div
                  className="relative flex h-36 items-center justify-center"
                  style={{ background: `linear-gradient(135deg,${art.from},${art.to})` }}
                >
                  <span className="text-7xl drop-shadow-lg transition-transform group-hover:scale-110">
                    {art.emoji}
                  </span>
                  <span className="absolute right-3 top-3 rounded-full bg-white/80 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-slate-700">
                    {m.tag}
                  </span>
                </div>
                <div className="bg-white/80 p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="text-xl font-black text-slate-800">{m.name}</h3>
                    <span className="shrink-0 rounded-full bg-slate-800 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-amber-300">
                      {m.maxPlayers} players
                    </span>
                  </div>
                  <p className="mt-1 text-sm leading-snug text-slate-600">{m.blurb}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {m.modes.map((mo) => (
                      <span
                        key={mo}
                        className="rounded-md bg-pink-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-pink-700"
                      >
                        {MODE_LABEL[mo]}
                      </span>
                    ))}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={onBack}
            className="rounded-2xl bg-white/70 px-6 py-3 text-base font-black text-slate-700 shadow-lg transition-transform hover:scale-105 active:scale-95"
          >
            ← Back to squishies
          </button>
          <button
            onClick={onMultiplayer}
            className="rounded-2xl bg-slate-800 px-6 py-3 text-base font-black text-white shadow-lg transition-transform hover:scale-105 active:scale-95"
          >
            🌐 LAN link-up
          </button>
          <button
            onClick={onPlay}
            className="rounded-2xl bg-gradient-to-br from-pink-500 to-amber-400 px-8 py-4 text-xl font-black text-white shadow-lg transition-transform hover:scale-105 active:scale-95"
          >
            Solo: enter {map.name}! 🎈
          </button>
        </div>
        <p className="mt-3 text-center text-xs text-slate-500">
          Solo fills every open seat with playpen bots. LAN link-up runs a peer-to-peer match with
          friends on your network (run <code className="rounded bg-white/70 px-1 font-mono">node server.mjs</code> first).
        </p>

        <p className="mt-6 text-center text-xs text-slate-500">
          More playpens coming soon — the map list is built to grow.
        </p>
      </div>
    </div>
  );
}
