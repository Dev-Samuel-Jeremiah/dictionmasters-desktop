/*
 * Diction Masters for Windows and Linux — every lesson on the computer.
 *
 * Unlike the website app (the Django project's desktop/ folder), this one
 * doesn't open the website. The lessons came with the installer, sealed;
 * an activation code typed in once (the internet needed just then) opens
 * them, and from then on everything works with no internet:
 *
 *   server.js    answers every page and file from the lessons on disk
 *   content.js   finds and unseals them (installed + downloaded updates)
 *   marking.js   marks activities, with the website's rules
 *   progress.js  keeps what the learner did
 *   licence.js   checks the code's licence, offline
 *   sync.js      new lessons from the website, when it's online
 *
 * The website's side is apps/desktop_edition in the Django project.
 *
 * Must keep working on Electron 22 too (the Windows 7/8 edition): CommonJS,
 * no fetch() in this process, protocol.handle only when it exists.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { app, BrowserWindow, Menu, protocol, net, shell, session, ipcMain, safeStorage, dialog } = require("electron");

const config = require("../../app.config.json");
const { Content } = require("./content");
const { LessonServer } = require("./server");
const { Progress } = require("./progress");
const { State } = require("./state");
const { Sync } = require("./sync");
const licence = require("./licence");
const unlocking = require("./unlock");
const netApi = require("./net");

const SCHEME = "dm";
const ORIGIN = "dm://app";
const SITE = (process.env.DM_SITE_URL || config.siteUrl).replace(/\/+$/, "");
const APP_VERSION = config.version;

app.setName(config.appName);
if (process.env.DM_USER_DATA) app.setPath("userData", process.env.DM_USER_DATA);

// Ubuntu 24.04+ blocks Chromium's sandbox inside an AppImage; the .deb is fine.
if (process.platform === "linux" && process.env.APPIMAGE) {
  try {
    if (fs.readFileSync("/proc/sys/kernel/apparmor_restrict_unprivileged_userns", "utf8").trim() === "1") app.commandLine.appendSwitch("no-sandbox");
  } catch (error) { /* not restricted */ }
}

protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, allowServiceWorkers: false },
}]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
}

let win = null;
let state, content, progress, server, sync;

function installedDir() {
  if (process.env.DM_CONTENT_DIR) return path.resolve(process.env.DM_CONTENT_DIR);
  return app.isPackaged ? path.join(process.resourcesPath, "content") : path.join(__dirname, "..", "..", "content");
}

// This computer's own id, behind the number it shows for its unlock code:
// Windows' MachineGuid (64-bit view, so the Windows 7/8 32-bit build reads
// the same one), Linux's machine-id. It stays the same when the app is
// reinstalled. If neither can be read, the app's own id (lost on reinstall).
let computerMemo = null;
function computer() {
  if (computerMemo) return computerMemo;
  let id = process.env.DM_MACHINE_ID || "";
  try {
    if (!id && process.platform === "win32") {
      const out = require("child_process").execFileSync("reg",
        ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid", "/reg:64"], { encoding: "utf8", windowsHide: true });
      id = (out.match(/MachineGuid\s+REG_SZ\s+(\S+)/) || [])[1] || "";
    }
    if (!id) {
      for (const file of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
        if (fs.existsSync(file)) { id = fs.readFileSync(file, "utf8").trim(); if (id) break; }
      }
    }
  } catch (error) { /* fall back below */ }
  computerMemo = unlocking.computerNumber(id || state.get("deviceId"));
  return computerMemo;
}

function publicKey() {
  return process.env.DM_PUBLIC_KEY || config.publicKey || state.get("devPublicKey") || "";
}

// --------------------------------------------------------------- who and what

/** A computer unlocked with no internet: its code's level and end date. The
 *  computer's clock can't be wound back past the latest day the app has seen. */
function unlockedStanding() {
  const found = state.get("unlock");
  if (found.computer !== computer()) {
    return { ok: false, reason: "device", message: "This unlock code was made for another computer. Please ask for a code for this one." };
  }
  const today = licence.today();
  const seen = state.get("lastDay") || today;
  const day = today > seen ? today : seen;
  const payload = { code: found.code, holder: "", levels: [found.level], until: found.until, device: found.computer };
  if (found.until && day > found.until) {
    return { ok: false, reason: "ended", payload,
             message: `Your unlock code ended on ${found.until}. Please contact Diction Masters for a new one.` };
  }
  return { ok: true, payload };
}

function standing() {
  if (state.get("unlock")) return unlockedStanding();
  return licence.standing({ licence: state.get("licence"), signature: state.get("signature"), lastCheck: state.get("lastCheck") },
    state.get("deviceId"), publicKey());
}

function levelsOpen(payload) {
  const installed = content.levels;
  return ((payload && payload.levels) || []).filter((level) => installed.includes(level));
}

function currentSession() {
  const check = standing();
  const levels = levelsOpen(check.payload);
  const chosen = state.get("level");
  return {
    ok: check.ok,
    learner: state.get("learner") || "",
    level: levels.includes(chosen) ? chosen : levels[0] || "",
    levels,
    siteUrl: SITE,
  };
}

function statusFor() {
  const check = standing();
  const s = currentSession();
  const payload = check.payload || {};
  return {
    ok: check.ok && s.levels.length > 0,
    reason: check.ok && !s.levels.length ? "no-levels" : check.reason,
    message: check.ok && !s.levels.length
      ? "Your code's levels aren't on this computer yet. Connect to the internet to download them."
      : check.message || "",
    learner: s.learner, level: s.level, levels: s.levels, home: content.home(s.level),
    code: payload.code || state.get("code") || "", holder: payload.holder || "", until: payload.until || "",
    release: content.release, lessonsDate: content.manifest && content.manifest.built ? content.manifest.built.slice(0, 10) : "",
    appVersion: APP_VERSION, deviceName: os.hostname(), computer: unlocking.showComputer(computer()),
    unlocked: Boolean(state.get("unlock")), contact: config.contact || "",
    sync: sync.status.message, ready: sync.status.ready,
    progress: progress.summary(),
  };
}

// --------------------------------------------------------------- the protocol

async function answer(request) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/_desktop/") && !statusFor().ok) {
    return { status: 303, headers: { Location: "/_desktop/activate.html" }, data: Buffer.alloc(0) };
  }
  return server.handle(request);
}

function wireProtocol() {
  if (typeof protocol.handle === "function") {
    protocol.handle(SCHEME, async (req) => {
      const headers = {};
      req.headers.forEach((value, name) => { headers[name] = value; });
      const body = req.method === "POST" || req.method === "PUT" ? Buffer.from(await req.arrayBuffer()) : null;
      const res = await answer({ url: req.url, method: req.method, headers, body });
      const empty = res.status === 204 || res.status === 304 || (res.status >= 300 && res.status < 400);
      return new Response(empty ? null : res.data, { status: res.status, headers: res.headers });
    });
  } else {
    protocol.registerBufferProtocol(SCHEME, (req, callback) => {
      const body = req.uploadData ? Buffer.concat(req.uploadData.map((part) => part.bytes || Buffer.alloc(0))) : null;
      answer({ url: req.url, method: req.method, headers: req.headers, body })
        .then((res) => callback({ statusCode: res.status, headers: res.headers, data: res.data }))
        .catch((error) => callback({ statusCode: 500, data: Buffer.from(String(error)) }));
    });
  }
}

// ------------------------------------------------------------------ the window

function isOurs(url) { return url.startsWith(`${ORIGIN}/`); }

function createWindow() {
  const bounds = state.get("window") || {};
  win = new BrowserWindow({
    width: bounds.width || config.window.width, height: bounds.height || config.window.height,
    x: bounds.x, y: bounds.y,
    minWidth: config.window.minWidth, minHeight: config.window.minHeight,
    title: config.appName, backgroundColor: "#0B1A4A", show: false, autoHideMenuBar: true,
    icon: path.join(__dirname, "..", "ui", "logo.png"),
    webPreferences: { preload: path.join(__dirname, "..", "preload.js"), contextIsolation: true, sandbox: true, spellcheck: false },
  });
  if (config.blockScreenCapture) win.setContentProtection(true);
  if (bounds.maximized) win.maximize();
  win.once("ready-to-show", () => win.show());

  const remember = () => {
    if (!win || win.isMinimized()) return;
    state.set({ window: { ...(win.isMaximized() ? state.get("window") : win.getBounds()), maximized: win.isMaximized() } });
  };
  win.on("close", remember);

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isOurs(url)) { win.loadURL(url); return { action: "deny" }; }
    if (/^https?:|^mailto:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (isOurs(url)) return;
    event.preventDefault();
    if (/^https?:|^mailto:/.test(url)) shell.openExternal(url);
  });
  win.webContents.on("did-finish-load", () => win.webContents.send("dm:sync", sync.status));

  win.loadURL(`${ORIGIN}/_desktop/activate.html`);
}

function allowMicrophone() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    const from = (details && details.requestingUrl) || contents.getURL();
    callback(isOurs(from) && ["media", "fullscreen", "clipboard-sanitized-write"].includes(permission));
  });
  if (ses.setPermissionCheckHandler) {
    ses.setPermissionCheckHandler((_contents, permission, origin) => origin === ORIGIN && ["media", "fullscreen"].includes(permission));
  }
}

function buildMenu() {
  const go = (address) => () => win && win.loadURL(ORIGIN + address);
  const template = [
    { label: "File", submenu: [
      { label: "My lessons", accelerator: "Alt+Home", click: () => go(content.home(currentSession().level))() },
      { label: "Print…", accelerator: "CmdOrCtrl+P", click: () => win && win.webContents.print() },
      { type: "separator" },
      { role: "quit" },
    ] },
    { label: "View", submenu: [
      { label: "Back", accelerator: "Alt+Left", click: () => win && win.webContents.canGoBack() && win.webContents.goBack() },
      { label: "Forward", accelerator: "Alt+Right", click: () => win && win.webContents.canGoForward() && win.webContents.goForward() },
      { role: "reload" }, { type: "separator" },
      { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" },
    ] },
    { label: "Help", submenu: [
      { label: "Check for new lessons", click: () => sync.run() },
      { label: "Change level…", click: go("/_desktop/activate.html?level=1") },
      { label: "Load videos from a folder…", click: () => chooseVideos() },
      { label: "Code and computer…", click: go("/_desktop/activate.html?manage=1") },
      { type: "separator" },
      { label: "Open my recordings folder", click: () => { const dir = path.join(app.getPath("userData"), "recordings"); fs.mkdirSync(dir, { recursive: true }); shell.openPath(dir); } },
      { label: "Troubleshooting: developer tools", accelerator: "CmdOrCtrl+Shift+I", click: () => win && win.webContents.toggleDevTools() },
      { label: `About ${config.appName}`, click: () => dialog.showMessageBox(win, {
        type: "info", title: config.appName, message: `${config.appName} ${APP_VERSION}`,
        detail: `Lessons: release ${content.release}${content.manifest && content.manifest.built ? ` (${content.manifest.built.slice(0, 10)})` : ""}\n${SITE}\n© Techmiary Technology Concepts`,
      }) },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ------------------------------------------------------------------- the IPC

function wireIpc() {
  ipcMain.handle("dm:status", () => statusFor());

  ipcMain.handle("dm:activate", async (_event, { code, learner }) => {
    if (learner != null) state.set({ learner: String(learner).trim().slice(0, 60) });
    // An unlock code: checked right here, with no internet.
    if (unlocking.looksLikeCode(code)) {
      const opened = unlocking.unlock(code, computer(), content.manifest);
      if (!opened.ok) return { ok: false, error: opened.error };
      state.set({ unlock: { code: String(code).toUpperCase().trim(), level: opened.level, until: opened.until, computer: computer() },
                  level: opened.level });
      state.keys = opened.keys;
      content.setKeys(opened.keys);
      setTimeout(() => sync.run(), 1500);           // only does anything if this computer is ever online
      const status = statusFor();
      if (!status.ok) return { ok: false, error: status.message };
      setTimeout(offerVideos, 800);
      return { ok: true, status };
    }
    try {
      if (!publicKey() && !app.isPackaged) {
        const { data } = await netApi.json(net, { url: `${SITE}/desktop-app/public-key/` });   // testing only
        if (data && data.public_key) state.set({ devPublicKey: data.public_key });
      }
      const { data } = await netApi.json(net, {
        url: `${SITE}/desktop-app/activate/`, method: "POST",
        data: { code, device_id: state.get("deviceId"), device_name: os.hostname(), learner_name: state.get("learner") || "",
                system: { win32: "windows", darwin: "mac" }[process.platform] || process.platform, app_version: APP_VERSION },
      });
      if (!data || !data.ok) return { ok: false, error: (data && data.error) || "The website didn't answer properly. Try again in a minute." };
      if (!licence.verify(data.licence, data.signature, publicKey())) {
        return { ok: false, error: "The answer from the website couldn't be checked. Is this the right app for this website?" };
      }
      state.set({ licence: data.licence, signature: data.signature, lastCheck: Date.now(), code: String(code).toUpperCase().trim() });
      state.keys = data.keys;
      content.setKeys(data.keys);
      setTimeout(() => sync.run(), 1500);
      const status = statusFor();
      if (!status.ok) return { ok: false, error: status.message };
      return { ok: true, status };
    } catch (error) {
      return { ok: false, error: "Couldn't reach the Diction Masters website. Check the internet connection and try again." };
    }
  });

  ipcMain.handle("dm:set-level", (_event, level) => {
    if (currentSession().levels.includes(level)) state.set({ level });
    return content.home(currentSession().level);
  });
  ipcMain.handle("dm:set-learner", (_event, name) => { state.set({ learner: String(name || "").trim().slice(0, 60) }); return true; });
  ipcMain.handle("dm:check-now", async () => { await sync.run(); return statusFor(); });
  ipcMain.handle("dm:deactivate", () => { state.forgetLicence(); content.setKeys({}); return true; });
  ipcMain.handle("dm:load-videos", () => chooseVideos());
}

// ------------------------------------------------------------------- videos
//
// A level's videos are too big to go inside its installer (Windows installers
// stop at 2 GB), so they travel beside it, in a videos/ folder. The Windows
// installer copies them in (build/installer.nsh); otherwise they're loaded
// from that folder here, into the app's own lessons folder. Only files the
// lessons on this computer actually use are copied, and nothing is changed
// in them: they're sealed, and still open only with this computer's code.

function missingVideos() {
  if (!content.manifest) return new Set();
  // The learner's level once unlocked; before that, every level installed here.
  const level = currentSession().level;
  const levels = level ? [level] : content.levels;
  const wanted = new Set();
  for (const group of levels.map((name) => content.manifest.levels[name])) {
    for (const entry of Object.values((group && group.files) || {})) {
      if (/^video\//.test(entry.t || "") && !content.has(entry.b)) wanted.add(entry.b);
    }
  }
  return wanted;
}

let importing = null;
function importVideos(dir, { quiet } = {}) {
  if (importing) return importing;
  importing = (async () => {
    const wanted = missingVideos();
    let names = [];
    try { names = fs.readdirSync(dir).filter((name) => wanted.has(name)); } catch (error) { names = []; }
    if (!names.length) return { copied: 0, missing: wanted.size };
    const target = path.join(app.getPath("userData"), "content", "blobs");
    fs.mkdirSync(target, { recursive: true });
    let copied = 0;
    for (const name of names) {
      sync._set({ busy: true, message: `Copying videos: ${copied + 1} of ${names.length}…` });
      await fs.promises.copyFile(path.join(dir, name), path.join(target, `${name}.part`));
      await fs.promises.rename(path.join(target, `${name}.part`), path.join(target, name));
      copied += 1;
    }
    const left = missingVideos().size;
    sync._set({ busy: false, message: left ? `${copied} videos loaded. ${left} are still missing.` : "All the videos are on this computer." });
    if (!quiet && win) dialog.showMessageBox(win, { type: "info", title: config.appName,
      message: left ? `${copied} videos loaded; ${left} still missing.` : `All ${copied} videos are loaded. They play with no internet.` });
    return { copied, missing: left };
  })().finally(() => { importing = null; });
  return importing;
}

async function chooseVideos() {
  if (!missingVideos().size) {
    if (win) dialog.showMessageBox(win, { type: "info", title: config.appName, message: "All this level's videos are already on this computer." });
    return { copied: 0, missing: 0 };
  }
  const picked = await dialog.showOpenDialog(win, {
    title: "Choose the videos folder (on the flash drive, next to the installer)",
    properties: ["openDirectory"],
  });
  if (picked.canceled || !picked.filePaths.length) return { copied: 0, missing: missingVideos().size };
  let dir = picked.filePaths[0];
  if (fs.existsSync(path.join(dir, "videos"))) dir = path.join(dir, "videos");      // they picked the level's folder
  return importVideos(dir);
}

// Straight after unlocking: if this level's videos aren't here yet, offer to load them.
async function offerVideos() {
  if (!win || !missingVideos().size) return;
  const { response } = await dialog.showMessageBox(win, {
    type: "question", title: config.appName, buttons: ["Load videos now", "Later"], defaultId: 0, cancelId: 1,
    message: "This level's videos aren't on this computer yet.",
    detail: "They're in the videos folder next to the installer (on the flash drive). Load them now? You can also do it later from Help.",
  });
  if (response === 0) chooseVideos();
}

// ------------------------------------------------------------------ starting

app.whenReady().then(() => {
  const data = app.getPath("userData");
  state = new State(data, safeStorage);
  content = new Content([installedDir(), path.join(data, "content")], state.keys);
  progress = new Progress(data);
  server = new LessonServer({ content, progress, uiDir: path.join(__dirname, "..", "ui"), session: currentSession });
  sync = new Sync({
    content, state, requester: net, siteUrl: SITE, downloadedDir: path.join(data, "content"), appVersion: APP_VERSION,
    onChange: (status) => { if (win && !win.isDestroyed()) win.webContents.send("dm:sync", status); },
    onStopped: (message) => {
      state.forgetLicence();
      content.setKeys({});
      if (win && !win.isDestroyed()) win.loadURL(`${ORIGIN}/_desktop/activate.html`);
      if (message) dialog.showMessageBox(win, { type: "warning", title: config.appName, message });
    },
  });

  wireProtocol();
  wireIpc();
  allowMicrophone();
  buildMenu();
  createWindow();

  // The latest day this computer has shown, so winding the clock back
  // doesn't stretch an unlock code's end date.
  const today = licence.today();
  if (!state.get("lastDay") || today > state.get("lastDay")) state.set({ lastDay: today });

  // Videos sitting next to the app (a Linux AppImage copied with its videos/ folder).
  if (process.env.APPIMAGE) importVideos(path.join(path.dirname(process.env.APPIMAGE), "videos"), { quiet: true });

  // New lessons: a little after starting, then every few hours (only if online).
  const linked = () => state.get("licence") || state.get("unlock");
  if (linked()) setTimeout(() => sync.run(), 10000);
  setInterval(() => { if (linked()) sync.run(); }, Math.max(1, config.syncHours) * 3600 * 1000);
});

app.on("before-quit", () => progress && progress.flush());
app.on("window-all-closed", () => app.quit());
