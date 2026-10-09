#!/usr/bin/env node
/**
 * SQUISH-EEE ARENA — LAN lobby + signalling server (command-line entry point).
 *
 *     node server.mjs            # port 4870
 *     PORT=4899 node server.mjs  # pick your own port
 *
 * With a `dist/` folder present it also serves the game itself, so anyone on
 * your network can open  http://<this-computer's-IP>:4870  in a browser and
 * play without installing anything.
 *
 * The desktop build embeds this exact same logic (see server/lobby.mjs), so the
 * host player doesn't need to run this separately when using the .exe.
 */
import { createLobbyServer, lanAddresses } from "./server/lobby.mjs";
import { resolve } from "node:path";

const PORT = Number(process.env.PORT || 4870);
const HOST = process.env.HOST || "0.0.0.0";
const staticDir = resolve(process.cwd(), "dist");

const server = createLobbyServer({ staticDir });

server.listen(PORT, HOST, () => {
  const ips = lanAddresses();
  console.log("");
  console.log("  🧸 SQUISH-EEE ARENA — LAN lobby server");
  console.log("  ---------------------------------------");
  console.log(`  Listening on  http://${HOST}:${PORT}`);
  if (ips.length) {
    console.log("");
    console.log("  Friends on this network can open:");
    for (const ip of ips) console.log(`     http://${ip}:${PORT}`);
  }
  console.log("");
  console.log("  In-game: use the LAN link-up menu and enter one of the addresses above.");
  console.log("  Gameplay itself streams peer-to-peer once players link up.");
  console.log("");
});
