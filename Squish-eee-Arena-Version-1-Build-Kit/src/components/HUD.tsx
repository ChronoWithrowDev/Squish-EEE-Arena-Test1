import { WEAPONS, WEAPON_ORDER, type WeaponId } from "../game/weapons";
import type { HUDState } from "../game/engine";

function face(g: number) {
  if (g < 20) return "😐";
  if (g < 45) return "🙂";
  if (g < 70) return "😄";
  if (g < 90) return "😆";
  return "🤣";
}

function fmtTime(s: number) {
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${ss.toString().padStart(2, "0")}`;
}

function FlagPip({ team, state }: { team: "red" | "blue"; state: string }) {
  const col = team === "red" ? "bg-rose-400" : "bg-sky-400";
  return (
    <span
      className={`inline-flex h-5 w-5 items-center justify-center rounded-md text-[11px] ${col} ${
        state === "home" ? "opacity-100" : state === "carried" ? "animate-pulse opacity-100 ring-2 ring-yellow-300" : "opacity-50"
      }`}
      title={state}
    >
      🚩
    </span>
  );
}

export default function HUD({ s, scoreboard }: { s: HUDState; scoreboard: boolean }) {
  const def = WEAPONS[s.weapon];
  const sniperScoped = s.weapon === "sniper" && s.scope > 0.35 && !s.giggledOut;
  const ammo = def.ammoPerShot === 0 ? "∞" : Math.floor(s.ammo[s.weapon] ?? 0);
  const giggle = Math.round(s.giggle);

  return (
    <div className="pointer-events-none absolute inset-0 select-none font-[Fredoka,system-ui] text-white">
      {/* getting-tickled vignette */}
      <div
        className="absolute inset-0 transition-opacity duration-100"
        style={{
          opacity: Math.min(0.9, s.hurt * 0.75 + Math.max(0, (giggle - 55) / 100)),
          background:
            "radial-gradient(circle at 50% 50%, rgba(255,105,180,0) 35%, rgba(255,105,180,0.55) 100%)",
        }}
      />
      {/* warm milk healing flash */}
      {s.milkGlow > 0 && (
        <div
          className="pointer-events-none absolute inset-0 transition-opacity duration-200"
          style={{
            opacity: Math.min(0.85, s.milkGlow * 0.9),
            background:
              "radial-gradient(circle at 50% 50%, rgba(255,252,235,0.75) 0%, rgba(255,240,180,0.5) 60%, rgba(255,225,130,0.65) 100%)",
          }}
        >
          <div className="absolute left-1/2 top-1/4 -translate-x-1/2 -translate-y-1/2 animate-bounce text-center text-3xl font-black text-amber-900 drop-shadow-[0_2px_12px_rgba(255,255,255,0.9)] sm:text-4xl">
            🍼 WARM MILK TIME! TEAM HEALED!
          </div>
        </div>
      )}
      {/* big announcer banner (sprees, captures remaining, flag alerts) */}
      {s.banner && (
        <div
          key={s.banner.id}
          className="pointer-events-none absolute left-1/2 top-32 -translate-x-1/2 transform text-center"
        >
          <div
            className="animate-bounce rounded-3xl border-4 px-6 py-2.5 text-xl font-black uppercase tracking-wider shadow-2xl backdrop-blur-md sm:px-8 sm:py-3 sm:text-2xl"
            style={{
              backgroundColor: "rgba(15, 23, 42, 0.85)",
              borderColor: s.banner.color,
              color: s.banner.color,
              boxShadow: `0 0 35px ${s.banner.color}88`,
            }}
          >
            {s.banner.text}
          </div>
        </div>
      )}
      {/* sniper scope overlay (hold right mouse button) */}
      {sniperScoped && (
        <div className="absolute inset-0" style={{ opacity: Math.min(1, (s.scope - 0.3) / 0.35) }}>
          {/* dark plush vignette with a round window */}
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 0, rgba(0,0,0,0) 30vmin, rgba(34,12,58,0.94) 30.8vmin)",
            }}
          />
          {/* chunky lime toy rim */}
          <div
            className="absolute left-1/2 top-1/2 rounded-full"
            style={{
              width: "61.6vmin",
              height: "61.6vmin",
              transform: "translate(-50%, -50%)",
              border: "0.8vmin solid #b6ff5a",
              boxShadow: "0 0 3vmin #b6ff5a88, inset 0 0 4vmin #b6ff5a44",
            }}
          />
          {/* crosshair lines with a gap in the middle */}
          <div
            className="absolute left-1/2 top-1/2"
            style={{
              width: "60vmin",
              height: 2,
              transform: "translate(-50%, -50%)",
              background:
                "linear-gradient(90deg, transparent 0, rgba(25,5,45,.92) 6%, rgba(25,5,45,.92) 45%, transparent 45%, transparent 55%, rgba(25,5,45,.92) 55%, rgba(25,5,45,.92) 94%, transparent 100%)",
              boxShadow: "0 0 3px rgba(255,255,255,.7)",
            }}
          />
          <div
            className="absolute left-1/2 top-1/2"
            style={{
              height: "60vmin",
              width: 2,
              transform: "translate(-50%, -50%)",
              background:
                "linear-gradient(180deg, transparent 0, rgba(25,5,45,.92) 6%, rgba(25,5,45,.92) 45%, transparent 45%, transparent 55%, rgba(25,5,45,.92) 55%, rgba(25,5,45,.92) 94%, transparent 100%)",
              boxShadow: "0 0 3px rgba(255,255,255,.7)",
            }}
          />
          {/* pink centre dot */}
          <div
            className="absolute left-1/2 top-1/2 rounded-full bg-pink-500"
            style={{
              width: 6,
              height: 6,
              transform: "translate(-50%, -50%)",
              boxShadow: "0 0 8px #ff4fd8",
            }}
          />
          <div
            className="absolute left-1/2 text-center text-[11px] font-black uppercase tracking-[0.3em] text-lime-200"
            style={{ top: "calc(50% + 33.5vmin)", transform: "translateX(-50%)" }}
          >
            🎯 squeak-scope · 4×
          </div>
        </div>
      )}

      {/* crosshair */}
      {!s.giggledOut && !sniperScoped && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="relative h-8 w-8">
            <div className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/90 shadow-[0_0_6px_#000]" />
            {[0, 90, 180, 270].map((r) => (
              <div
                key={r}
                className="absolute left-1/2 top-1/2 h-2.5 w-[3px] origin-center rounded-full bg-white/80 shadow-[0_0_4px_#000]"
                style={{ transform: `rotate(${r}deg) translate(-50%, -11px)` }}
              />
            ))}
            {s.hit > 0 && (
              <div className="absolute inset-0 animate-ping rounded-full border-2 border-pink-300" />
            )}
          </div>
        </div>
      )}

      {/* top centre: match score */}
      <div className="absolute left-1/2 top-3 -translate-x-1/2">
        <div className="flex items-center gap-4 rounded-2xl border border-white/20 bg-black/40 px-5 py-2 backdrop-blur-md">
          <div className="flex items-center gap-2">
            {s.mode === "ctf" && <FlagPip team="red" state={s.flagState.red} />}
            <span className="text-2xl font-black text-rose-300 drop-shadow">{s.scores.red}</span>
          </div>
          <div className="text-center">
            <div className="text-[10px] uppercase tracking-[0.25em] text-white/60">
              {s.mode === "ctf" ? "squish-eee CTF" : "squishmatch"}
            </div>
            <div className="font-mono text-sm text-amber-200">{fmtTime(s.timeLeft)}</div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-black text-sky-300 drop-shadow">{s.scores.blue}</span>
            {s.mode === "ctf" && <FlagPip team="blue" state={s.flagState.blue} />}
          </div>
        </div>
        <div className="mt-1 text-center text-[10px] font-bold uppercase tracking-[0.2em] text-white/45">
          {s.mode === "ctf"
            ? `first to ${s.limit} captures · ${s.mapName}`
            : `first to ${s.limit} giggle-outs · ${s.mapName}`}
        </div>
        {s.carrying && (
          <div className="mt-2 animate-bounce rounded-full bg-amber-300 px-4 py-1 text-center text-sm font-bold text-amber-900 shadow-lg">
            🚩 You have the {s.carrying.toUpperCase()} flag — run home!
          </div>
        )}
      </div>

      {/* kill feed */}
      <div className="absolute right-3 top-20 w-72 space-y-1 text-right text-sm">
        {s.messages.map((m) => (
          <div
            key={m.id}
            className="rounded-lg bg-black/40 px-3 py-1 backdrop-blur-sm"
            style={{ color: m.color }}
          >
            {m.text}
          </div>
        ))}
      </div>

      {/* quad */}
      {s.quad > 0 && (
        <div className="absolute left-1/2 top-24 -translate-x-1/2 animate-pulse rounded-full bg-purple-500/80 px-5 py-1.5 text-lg font-black tracking-wide shadow-[0_0_30px_#a855f7]">
          💜 QUAD GIGGLE {s.quad.toFixed(1)}s
        </div>
      )}

      {/* pickup toast */}
      {s.pickup && (
        <div className="absolute left-1/2 top-1/2 mt-20 -translate-x-1/2 rounded-xl bg-black/50 px-4 py-2 text-lg font-bold text-amber-200 backdrop-blur">
          {s.pickup}
        </div>
      )}

      {/* giggle meter */}
      <div className="absolute bottom-5 left-5 w-80">
        <div className="mb-1 flex items-end justify-between">
          <span className="text-xs font-bold uppercase tracking-widest text-white/70">Giggle-o-meter</span>
          <span className="text-sm font-black text-white/90">{giggle}/100</span>
        </div>
        <div className="relative h-10 overflow-hidden rounded-2xl border-2 border-white/30 bg-black/45 backdrop-blur">
          <div
            className="h-full rounded-xl transition-[width] duration-150"
            style={{
              width: `${giggle}%`,
              background:
                giggle > 80
                  ? "linear-gradient(90deg,#fb7185,#f472b6,#f0abfc)"
                  : giggle > 50
                    ? "linear-gradient(90deg,#fbbf24,#fb923c,#f472b6)"
                    : "linear-gradient(90deg,#4ade80,#86efac,#fde047)",
            }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 text-2xl transition-[left] duration-150"
            style={{ left: `calc(${giggle}% - 18px)` }}
          >
            {face(giggle)}
          </div>
        </div>
        <div className="mt-1 text-[11px] text-white/50">
          100 giggles = you float away for 3s. Grab 🧃 Serious Juice to calm down.
        </div>
      </div>

      {/* weapon + ammo */}
      <div className="absolute bottom-5 right-5 text-right">
        <div className="rounded-2xl border-2 border-white/25 bg-black/45 px-5 py-3 backdrop-blur">
          <div className="text-xs uppercase tracking-widest text-white/60">{def.short}</div>
          <div className="flex items-baseline justify-end gap-2">
            <span className="text-4xl font-black text-amber-200 drop-shadow">{ammo}</span>
            <span className="text-sm text-white/60">{def.ammoName}</span>
          </div>
          {s.weapon === "punch" && (
            <div className="text-[10px] font-bold uppercase tracking-wider text-pink-200">
              Spring winds back between punches
            </div>
          )}
        </div>
      </div>

      {/* weapon bar */}
      <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 gap-1 sm:gap-1.5">
        {WEAPON_ORDER.map((w: WeaponId) => {
          const owned = s.owned[w];
          const cur = s.weapon === w;
          return (
            <div
              key={w}
              className={`flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-xl border-2 text-base transition-all sm:h-12 sm:w-12 sm:text-lg ${
                cur
                  ? "scale-110 border-amber-300 bg-amber-300/25"
                  : owned
                    ? "border-white/30 bg-black/40"
                    : "border-white/10 bg-black/25 opacity-30"
              }`}
              title={WEAPONS[w].name}
            >
              <span>{WEAPONS[w].icon}</span>
              <span className="text-[9px] text-white/60">{WEAPONS[w].slot}</span>
            </div>
          );
        })}
      </div>

      {/* giggled out overlay */}
      {s.giggledOut && !s.over && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-pink-300/10 backdrop-blur-[2px]">
          <div className="animate-bounce text-7xl">🤣</div>
          <div className="mt-2 text-4xl font-black text-white drop-shadow-lg">YOU GIGGLED OUT!</div>
          <div className="mt-1 text-xl text-white/80">floating back in {s.respawnIn.toFixed(1)}s…</div>
        </div>
      )}

      {/* net badge */}
      {s.net && (
        <div className="absolute left-5 top-4 flex items-center gap-2 rounded-full border border-white/20 bg-black/40 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-emerald-300 backdrop-blur">
          <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
          LAN · {s.isHost ? "you are host" : "client"}
        </div>
      )}

      {/* scoreboard */}
      {(scoreboard || s.over) && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-[640px] rounded-3xl border-2 border-white/20 bg-slate-900/80 p-6 shadow-2xl">
            {s.over && (
              <div className="mb-3 text-center text-3xl font-black">
                {s.winner === "tie" ? (
                  <span className="text-amber-200">😜 Giggly Tie!</span>
                ) : s.mvp ? (
                  <span className={s.mvp === "You" ? "text-emerald-300" : "text-rose-300"}>
                    {s.mvp === "You" ? "🏆 YOU WIN!" : `🏆 ${s.mvp} WINS!`}
                  </span>
                ) : (
                  <span className={s.winner === s.teamOfPlayer ? "text-emerald-300" : "text-rose-300"}>
                    {s.winner?.toUpperCase()} TEAM WINS! {s.winner === s.teamOfPlayer ? "🎉" : "😭"}
                  </span>
                )}
              </div>
            )}
            <div className="mb-3 flex justify-center gap-8 text-2xl font-black">
              <span className="text-rose-300">
                {s.mode === "ctf" || s.mode === "tdm" ? "RED" : "YOU"}{" "}
                {s.mode === "ffa" ? s.playerScore : s.scores.red}
              </span>
              <span className="text-white/40">
                {s.mode === "ctf" ? `${s.limit} caps to win` : `${s.limit} to win`}
              </span>
              <span className="text-sky-300">
                {s.mode === "ctf" || s.mode === "tdm" ? "BLUE" : "RIVALS"}{" "}
                {s.mode === "ffa" ? s.rivalScore : s.scores.blue}
              </span>
            </div>
            <table className="w-full text-left text-sm">
              <thead className="text-white/50">
                <tr>
                  <th className="pb-1">Squishy</th>
                  {s.mode === "ctf" && <th className="pb-1 text-center">Captures</th>}
                  <th className="pb-1 text-center">Giggled others</th>
                  <th className="pb-1 text-center">Floated away</th>
                </tr>
              </thead>
              <tbody>
                {s.scoreboard.map((r) => (
                  <tr
                    key={r.name}
                    className={`${r.isPlayer ? "bg-white/10 font-bold" : ""} border-t border-white/10`}
                  >
                    <td className={`py-1 ${r.team === "red" ? "text-rose-300" : "text-sky-300"}`}>
                      {r.name} <span className="text-white/40">({r.kind})</span>
                    </td>
                    {s.mode === "ctf" && <td className="text-center">{r.caps}</td>}
                    <td className="text-center">{r.giggles}</td>
                    <td className="text-center">{r.giggledOut}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {s.over && (
              <div className="mt-4 text-center text-white/70">
                {s.net && !s.isHost ? (
                  "waiting for the host to start a rematch…"
                ) : (
                  <>
                    Press <b>R</b> for a rematch
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
