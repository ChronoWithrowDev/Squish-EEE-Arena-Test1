#!/usr/bin/env node
/**
 * SQUISH-EEE ARENA — one-command Windows executable builder.
 *
 *     node make-exe.mjs
 *
 * Produces:
 *   release/Squish-eee-Arena-Portable.exe   ← single file, no install needed
 *   release/Squish-eee-Arena-Setup.exe      ← classic installer
 *
 * What this does, in order:
 *   1. Runs the normal web build (`npm run build`) into dist/.
 *   2. Adds the fields Electron needs to package.json — `main`, `version`,
 *      `description`, `author`, and an `exe` script. (Existing values are kept;
 *      this is the only file it modifies.)
 *   3. Installs Electron + electron-builder if they are not already present.
 *   4. Runs electron-builder for Windows x64.
 *
 * Re-running it is safe — every step is idempotent.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const pkgPath = path.join(root, "package.json");

const die = (msg) => {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
};

const run = (cmd, args, label) => {
  console.log(`\n▸ ${label}`);
  const result = spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    shell: true, // required so `npx` / `npm` resolve on Windows
  });
  if (result.status !== 0) die(`${label} failed (exit ${result.status}).`);
  return result;
};

// ---------------------------------------------------------------- 1. web build
console.log("🧸  Squish-eee Arena — building the Windows executable\n");

if (!existsSync(path.join(root, "electron", "main.cjs"))) die("electron/main.cjs is missing.");
if (!existsSync(path.join(root, "electron-builder.json"))) die("electron-builder.json is missing.");

run("npm", ["run", "build"], "Building the game bundle (vite)");

const gameFile = path.join(root, "dist", "index.html");
if (!existsSync(gameFile)) die("dist/index.html not found after the build.");

// ------------------------------------------------------- 2. package.json fields
console.log("\n▸ Checking package.json fields");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

const next = {
  ...pkg,
  name: pkg.name && pkg.name !== "react-vite-tailwind" ? pkg.name : "squish-eee-arena",
  version: pkg.version || "1.0.0",
  description: pkg.description || "A squishy, giggly, nobody-gets-hurt first-person arena shooter.",
  author: pkg.author || { name: "Squish-eee Arena" },
  // Electron's entry point — required for packaging.
  main: "electron/main.cjs",
  scripts: {
    ...pkg.scripts,
    // Handy aliases so `npm run exe` works from now on.
    exe: "electron-builder --win --config electron-builder.json",
    electron: "electron electron/main.cjs",
  },
};

const changedMain = pkg.main !== next.main;
if (JSON.stringify(pkg) !== JSON.stringify(next)) {
  writeFileSync(pkgPath, JSON.stringify(next, null, 2) + "\n");
  console.log(`   added main: "${next.main}"${changedMain ? "" : " (already set)"}, version, author, and scripts`);
} else {
  console.log("   already configured");
}

// ------------------------------------------------------------- 3. electron deps
const hasElectron = existsSync(path.join(root, "node_modules", "electron", "package.json"));
const hasBuilder = existsSync(path.join(root, "node_modules", "electron-builder", "package.json"));
if (!hasElectron || !hasBuilder) {
  console.log("\n▸ Installing Electron + electron-builder (first run only)");
  run("npm", ["install", "--save-dev", "electron", "electron-builder"], "Installing packaging tools");
}

// --------------------------------------------------------------- 4. package it
console.log("\n▸ Packaging for Windows x64 (this downloads Electron the first time)");
run("npx", ["electron-builder", "--win", "--config", "electron-builder.json"], "electron-builder");

// ------------------------------------------------------------------- 5. report
console.log(`
✔ Done!

  Portable (no install):  release\\Squish-eee-Arena-Portable.exe
  Installer:              release\\Squish-eee-Arena-Setup.exe

  Double-click the portable one to play immediately. The LAN lobby server is
  built in — friends on your network open the address shown in the window title
  in their own browser, or use the desktop build too.

  Tip: once package.json is set up you can just run   npm run exe
`);
