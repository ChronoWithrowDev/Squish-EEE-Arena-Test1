/**
 * SQUISH-EEE ARENA — desktop (Electron) main process.
 *
 * Two responsibilities:
 *   1. Opens a window showing the built game.
 *   2. Runs the LAN lobby/signalling server in-process on 0.0.0.0, so the host
 *      player's copy of the game is reachable by friends without them running
 *      `node server.mjs` themselves.
 *
 * The game is served over http://127.0.0.1:<port> rather than file:// on
 * purpose: the in-game lobby defaults its server field from window.location
 * (see guessServer() in src/game/net.ts), so the address is already correct
 * with nothing to configure.
 *
 * Node built-ins only — no npm packages — which keeps the packaged app tiny.
 */
const { app, BrowserWindow, Menu, shell } = require("electron");
const path = require("node:path");
const { existsSync } = require("node:fs");
const { pathToFileURL } = require("node:url");

const PORT = Number(process.env.SQUISH_PORT || process.env.PORT || 4870);
const BASE_DIR = path.join(__dirname, "..");

let mainWindow = null;
let lobbyServer = null;

/** Where the built single-file game lives. Works dev and packaged (inside asar). */
function resolveStaticDir() {
  const candidates = [
    path.join(BASE_DIR, "dist"), // dev checkout / unpacked build
    path.join(process.resourcesPath || "", "app.asar", "dist"), // packaged app
    path.join(process.resourcesPath || "", "dist"), // extraResources fallback
  ];
  for (const dir of candidates) {
    if (dir && existsSync(path.join(dir, "index.html"))) return dir;
  }
  return candidates[0];
}

async function startLobbyServer() {
  const modulePath = path.join(BASE_DIR, "server", "lobby.mjs");
  const mod = await import(pathToFileURL(modulePath).href);
  const staticDir = resolveStaticDir();

  return new Promise((resolve, reject) => {
    const server = mod.createLobbyServer({
      staticDir,
      onLog: (m) => console.log(`[lobby] ${m}`),
    });
    server.once("error", reject);
    server.listen(PORT, "0.0.0.0", () => {
      const ips = mod.lanAddresses();
      resolve({ server, ips });
    });
  });
}

function createWindow(lanIps) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: "#141026",
    show: false,
    autoHideMenuBar: true,
    title: "Squish-eee Arena",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // Stop Chromium throttling the game loop when the window loses focus.
      backgroundThrottling: false,
      webgl: true,
      spellcheck: false,
    },
  });

  // Put the shareable address where the host can read it off to friends.
  const shareIp = lanIps && lanIps.length ? lanIps[0] : "127.0.0.1";
  mainWindow.setTitle(`Squish-eee Arena  ·  friends join http://${shareIp}:${PORT}`);

  // Open any external links (docs, etc.) in the system browser, not the game window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // If the embedded server didn't come up, say so instead of showing a blank page.
  mainWindow.webContents.on("did-fail-load", (_event, code, desc, url) => {
    if (mainWindow && !mainWindow.webContents.isLoading()) return;
    const hasServer = lobbyServer !== null;
    mainWindow.loadURL(
      "data:text/html;charset=utf-8," +
        encodeURIComponent(
          `<body style="margin:0;display:grid;place-items:center;height:100vh;` +
            `background:#141026;color:#fff;font-family:system-ui,sans-serif;text-align:center">` +
            `<div style="max-width:34rem;padding:2rem">` +
            `<div style="font-size:4rem">🧸</div>` +
            `<h1 style="margin:.5rem 0">The playpen didn't open</h1>` +
            `<p style="opacity:.75;line-height:1.6">The built-in lobby server didn't start on port ${PORT}.` +
            `${hasServer ? "" : " Something may already be using that port."}` +
            `<br>Close it and try again, or launch with a different port:</p>` +
            `<code style="display:block;margin-top:1rem;background:#000;padding:.75rem;border-radius:.5rem;` +
            `font-size:.85rem">SQUISH_PORT=5000 Squish-eee-Arena-Portable.exe</code>` +
            `<p style="opacity:.5;margin-top:1.5rem;font-size:.85rem">(${code} ${desc} — ${url})</p>` +
            `</div></body>`,
        ),
    );
  });

  Menu.setApplicationMenu(null);
  mainWindow.loadURL(`http://127.0.0.1:${PORT}/`);
}

async function bootstrap() {
  try {
    const { server, ips } = await startLobbyServer();
    lobbyServer = server;
    console.log(`[squish] lobby listening on port ${PORT}`);
    if (ips.length) {
      for (const ip of ips) console.log(`[squish] friends can join http://${ip}:${PORT}`);
    } else {
      console.log("[squish] no LAN address found — solo play still works");
    }
    createWindow(ips);
  } catch (err) {
    // Port already in use (another copy open, or `node server.mjs` running).
    // Fall back to pointing at the existing server rather than failing to start.
    console.warn(`[squish] could not start lobby server: ${err.message}`);
    console.warn(`[squish] assuming one is already running on port ${PORT}`);
    createWindow([]);
  }
}

// Exactly one copy of the game should own the lobby port.
if (!app.requestSingleInstanceLock()) {
  console.log("[squish] another copy is already running — quitting");
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(bootstrap);

  app.on("window-all-closed", () => {
    if (lobbyServer) {
      try {
        lobbyServer.close();
      } catch {
        /* already closed */
      }
    }
    app.quit();
  });

  app.on("before-quit", () => {
    if (lobbyServer) {
      try {
        lobbyServer.close();
      } catch {
        /* already closed */
      }
    }
  });
}
