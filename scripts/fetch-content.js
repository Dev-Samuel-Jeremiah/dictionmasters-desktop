#!/usr/bin/env node
/*
 * Puts the lessons into content/ so the installer carries them.
 *
 *   From the website (what the GitHub build does):
 *     DM_BUILD_TOKEN=... node scripts/fetch-content.js
 *       downloads the newest release of EVERY level from
 *       <siteUrl>/desktop-app/content/latest/ (DESKTOP_BUILD_TOKEN on the
 *       website), and writes the website's public key into app.config.json.
 *     DM_SKIP_VIDEOS=1   leave videos out of the installer (smaller; each
 *                        computer downloads them after activating)
 *     DM_SITE_URL=...    another website (e.g. http://127.0.0.1:8000)
 *
 *   From a folder (to try a build with lessons exported on your own computer):
 *     python manage.py export_desktop_content --to /tmp/lessons      (in the Django project)
 *     node scripts/fetch-content.js --from-folder /tmp/lessons
 *
 * Only files that changed are downloaded again; files no longer used are removed.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "content");
const CONFIG = path.join(ROOT, "app.config.json");
const config = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
const SITE = (process.env.DM_SITE_URL || config.siteUrl).replace(/\/+$/, "");
const TOKEN = process.env.DM_BUILD_TOKEN || "";
const PARALLEL = 6;

function sealedSize(plain) {
  return 8 + plain + 28 * Math.max(1, Math.ceil(plain / (1024 * 1024)));
}

function blobsOf(manifest) {
  const wanted = new Map();
  for (const group of [manifest.common, ...Object.values(manifest.levels)]) {
    for (const [address, entry] of Object.entries(group.files)) wanted.set(entry.b, { size: entry.s, video: /^video\//.test(entry.t), address });
  }
  return wanted;
}

function prune(wanted) {
  const dir = path.join(OUT, "blobs");
  let removed = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!wanted.has(name)) { fs.rmSync(path.join(dir, name), { force: true }); removed += 1; }
  }
  return removed;
}

function setPublicKey(key) {
  if (!key || config.publicKey === key) return;
  const text = fs.readFileSync(CONFIG, "utf8");
  const updated = text.replace(/"publicKey":\s*"[^"]*"/, `"publicKey": "${key}"`);
  fs.writeFileSync(CONFIG, updated);
  console.log(`app.config.json: publicKey set to the website's (${key.slice(0, 8)}…).`);
}

async function get(url, headers) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(url, { headers, redirect: "follow" });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
      return response;
    } catch (error) {
      if (attempt >= 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }
}

async function fromWebsite() {
  if (!TOKEN) {
    console.error("Set DM_BUILD_TOKEN (the website's DESKTOP_BUILD_TOKEN) to download the lessons.");
    process.exit(1);
  }
  const headers = { "X-DM-Build-Token": TOKEN, Accept: "application/json" };
  const key = await (await get(`${SITE}/desktop-app/public-key/`, {})).json();
  setPublicKey(key.public_key);
  const manifest = await (await get(`${SITE}/desktop-app/content/latest/`, headers)).json();
  if (!manifest.ok || !manifest.release) {
    console.error("The website has no lessons release yet. Build one: /admin/ > Lessons releases > Add, or `manage.py export_desktop_content`.");
    process.exit(1);
  }
  delete manifest.ok;
  fs.mkdirSync(path.join(OUT, "blobs"), { recursive: true });
  const wanted = blobsOf(manifest);
  const skipVideos = process.env.DM_SKIP_VIDEOS === "1";
  const queue = [...wanted.entries()].filter(([blob, info]) => {
    if (skipVideos && info.video) return false;
    const file = path.join(OUT, "blobs", blob);
    return !(fs.existsSync(file) && fs.statSync(file).size === sealedSize(info.size));
  });
  const total = queue.reduce((sum, [, info]) => sum + sealedSize(info.size), 0);
  console.log(`Release ${manifest.release}: ${wanted.size} files; downloading ${queue.length} (${Math.round(total / 1048576)} MB).`);
  let done = 0;
  async function worker() {
    while (queue.length) {
      const [blob, info] = queue.shift();
      const response = await get(`${SITE}/desktop-app/content/blob/${blob}/`, { "X-DM-Build-Token": TOKEN });
      const data = Buffer.from(await response.arrayBuffer());
      if (data.length !== sealedSize(info.size)) throw new Error(`${blob} (${info.address}) arrived damaged`);
      fs.writeFileSync(path.join(OUT, "blobs", blob), data);
      done += 1;
      if (done % 100 === 0) console.log(`  ${done} files…`);
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest));
  const removed = prune(wanted);
  console.log(`Done: content/ holds release ${manifest.release} for ${Object.keys(manifest.levels).join(", ")}${skipVideos ? " (no videos)" : ""}. ${removed} old files removed.`);
}

function fromFolder(folder) {
  const source = path.resolve(folder);
  const manifest = JSON.parse(fs.readFileSync(path.join(source, "manifest.json"), "utf8"));
  fs.mkdirSync(path.join(OUT, "blobs"), { recursive: true });
  const wanted = blobsOf(manifest);
  for (const blob of wanted.keys()) {
    const from = path.join(source, "blobs", blob);
    const to = path.join(OUT, "blobs", blob);
    if (fs.existsSync(from) && !fs.existsSync(to)) fs.copyFileSync(from, to);
  }
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest));
  prune(wanted);
  console.log(`content/ holds release ${manifest.release} (${Object.keys(manifest.levels).join(", ")}) from ${source}.`);
  if (!config.publicKey) console.log("Remember: app.config.json needs the website's publicKey (manage.py desktop_keys --show-public).");
}

const at = process.argv.indexOf("--from-folder");
(at !== -1 ? Promise.resolve(fromFolder(process.argv[at + 1])) : fromWebsite()).catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
