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
 *     DM_LEVEL="Level 1" one level only (an installer per level: a level
 *                        with its videos is bigger than a Windows installer
 *                        can be, so each level gets its own)
 *     DM_VIDEOS_APART=1  put the videos in videos/ instead of content/: they
 *                        travel beside the installer, which copies them in
 *                        (build/installer.nsh), or the app loads them
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
const TOKEN = (process.env.DM_BUILD_TOKEN || "").trim();      // a pasted secret often carries a space or newline
const PARALLEL = 6;
const VIDEOS = path.join(ROOT, "videos");
const LEVEL = (process.env.DM_LEVEL || "").trim();
const APART = process.env.DM_VIDEOS_APART === "1";

/** Keep only DM_LEVEL's lessons (and the shared styles), if it's set. */
function onlyLevel(manifest) {
  if (!LEVEL) return manifest;
  if (!manifest.levels[LEVEL]) {
    console.error(`${LEVEL} isn't in release ${manifest.release} (it has ${Object.keys(manifest.levels).join(", ")}).`);
    process.exit(1);
  }
  manifest.levels = { [LEVEL]: manifest.levels[LEVEL] };
  return manifest;
}

/** Where a file goes: videos/ when they travel apart, else content/blobs. */
function placeFor(info) { return APART && info.video ? VIDEOS : path.join(OUT, "blobs"); }

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
  let removed = 0;
  for (const dir of [path.join(OUT, "blobs"), VIDEOS]) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const info = wanted.get(name);
      if (!info || placeFor(info) !== dir) { fs.rmSync(path.join(dir, name), { force: true }); removed += 1; }
    }
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
  const answer = await fetch(`${SITE}/desktop-app/content/latest/`, { headers });
  if (answer.status === 403) {
    console.error(`${SITE} refused the build token. DM_BUILD_TOKEN (a GitHub secret here) must be exactly the website's ` +
      "DESKTOP_BUILD_TOKEN: no spaces, quotes or backticks around it.");
    process.exit(1);
  }
  const manifest = await (answer.ok ? answer : await get(`${SITE}/desktop-app/content/latest/`, headers)).json();
  if (!manifest.ok || !manifest.release) {
    console.error("The website has no lessons release yet. Build one: /admin/ > Lessons releases > Add, or `manage.py export_desktop_content`.");
    process.exit(1);
  }
  delete manifest.ok;
  onlyLevel(manifest);
  fs.mkdirSync(path.join(OUT, "blobs"), { recursive: true });
  if (APART) fs.mkdirSync(VIDEOS, { recursive: true });
  const wanted = blobsOf(manifest);
  const skipVideos = process.env.DM_SKIP_VIDEOS === "1";
  const queue = [...wanted.entries()].filter(([blob, info]) => {
    if (skipVideos && info.video) return false;
    const file = path.join(placeFor(info), blob);
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
      fs.writeFileSync(path.join(placeFor(info), blob), data);
      done += 1;
      if (done % 100 === 0) console.log(`  ${done} files…`);
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest));
  const removed = prune(wanted);
  console.log(`Done: content/ holds release ${manifest.release} for ${Object.keys(manifest.levels).join(", ")}${skipVideos ? " (no videos)" : APART ? " (videos in videos/)" : ""}. ${removed} old files removed.`);
}

function fromFolder(folder) {
  const source = path.resolve(folder);
  const manifest = onlyLevel(JSON.parse(fs.readFileSync(path.join(source, "manifest.json"), "utf8")));
  fs.mkdirSync(path.join(OUT, "blobs"), { recursive: true });
  if (APART) fs.mkdirSync(VIDEOS, { recursive: true });
  const wanted = blobsOf(manifest);
  for (const [blob, info] of wanted.entries()) {
    const from = path.join(source, "blobs", blob);
    const to = path.join(placeFor(info), blob);
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
