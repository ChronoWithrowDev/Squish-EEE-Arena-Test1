# Building the Windows 11 executable

The one thing this project can't produce on its own is a compiled `.exe` — that
has to happen on your machine. It's a single command.

## Quick way

```bash
npm install
node make-exe.mjs
```

When it finishes you'll have:

| File | What it is |
|---|---|
| `release\Squish-eee-Arena-V1-Portable.exe` | **One file. No install, just double-click.** |
| `release\Squish-eee-Arena-V1-Setup.exe` | Traditional installer if you prefer it. |

`make-exe.mjs` runs the web build, adds the few fields Electron needs to
`package.json`, installs Electron on first run, and packages everything. It only
touches `package.json`, and it's safe to run repeatedly.

After the first run you can just use:

```bash
npm run exe
```

## What you get

The desktop build is not just the game in a window. Its main process runs the
**LAN lobby server in-process**, on `0.0.0.0`.

That matters: a browser tab can never listen on a network socket, which is why
multiplayer previously needed a separate `node server.mjs`. An Electron main
process can. So the host player just opens the `.exe` and starts a match — no
extra terminal.

Two nice consequences:

- **Friends don't need the `.exe`.** The packaged app also serves the game over
  HTTP, so anyone on your network can open the address shown in the window title
  in a normal browser and join.
- **The lobby's server field is already correct.** The game guesses its default
  server from `window.location` (see `guessServer()` in `src/game/net.ts`).
  Because the window loads `http://127.0.0.1:4870` rather than a `file://` URL,
  the default is right with zero configuration.

Gameplay itself is peer-to-peer over WebRTC data channels; the server only
handles the lobby and the handshake, so it isn't in the latency path.

## Playing on LAN

1. One person runs `Squish-eee-Arena-V1-Portable.exe`.
2. Read the address from the window title bar, e.g. `http://192.168.1.42:4870`.
3. Everyone else either opens that in a browser, or runs their own copy of the
   `.exe` and enters the same address in **LAN link-up**.
4. Host creates a lobby, shares the room code, everyone joins, host starts.

## Files involved

- `electron/main.cjs` — desktop main process (window + embedded lobby server)
- `server/lobby.mjs` — shared lobby/signalling server, used by both the desktop
  build and the standalone CLI
- `server.mjs` — CLI wrapper: `node server.mjs` runs the same server without Electron
- `electron-builder.json` — packaging config (note the `files` list deliberately
  excludes `node_modules`, because the game is a single self-contained HTML file
  and the main process uses only Node built-ins — this keeps the `.exe` small)
- `make-exe.mjs` — the build helper described above

## Notes & troubleshooting

- **Antivirus / SmartScreen** may flag an unsigned `.exe`. That's expected for
  any unsigned binary. Click *More info* → *Run anyway*, or sign it yourself.
- **Windows Firewall** will ask about network access the first launch — allow it
  on private networks, or friends won't be able to reach your lobby.
- **Port in use**: if you already have `node server.mjs` running, the app
  detects it and points at the existing server instead of failing.
- **No LAN address found** means you're not on a network — solo play still works.
- To change the port: `set SQUISH_PORT=5000` before launching (or `PORT=5000`
  for `server.mjs`).

## Alternatives

If you'd rather not use Electron, [Tauri](https://tauri.app) produces a much
smaller binary (it uses the WebView2 runtime already in Windows 11) but needs
the Rust toolchain installed. The game is a single static HTML file, so it drops
straight into either.
