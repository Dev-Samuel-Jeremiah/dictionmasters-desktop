/*
 * How the installers are built (electron-builder). Normally you don't edit
 * this: change app.config.json. See README.md.
 *
 *   normal   Windows 10/11 (64-bit) and Linux. The current Electron.
 *   legacy   Windows 7, 8 and 8.1. Electron 22, the last one that runs
 *            there. Build it with DM_LEGACY=1. 32-bit only: it runs on 32-
 *            and 64-bit Windows alike, and an installer holding both copies
 *            (each with the level's lessons) would pass Windows' 2 GB limit.
 *
 * The lessons in content/ (scripts/fetch-content.js) go into the installer
 * as they are, sealed: resources/content on the installed computer.
 */
const fs = require("fs");
const path = require("path");
const config = require("./app.config.json");

const legacy = process.env.DM_LEGACY === "1";
// One installer per level (DM_LEVEL, scripts/fetch-content.js): its name says which.
const level = (process.env.DM_LEVEL || "").trim();
const name = level ? `DictionMasters-${level.replace(/[^A-Za-z0-9]+/g, "-")}` : "DictionMasters-Offline";

if (process.env.DM_RELEASE === "1") {
  if (!config.publicKey) throw new Error("app.config.json has no publicKey. Run `npm run content:fetch` first.");
  if (!fs.existsSync(path.join(__dirname, "content", "manifest.json"))) throw new Error("content/ is empty. Run `npm run content:fetch` first.");
}

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: config.appId,
  productName: config.appName,
  copyright: `© ${new Date().getFullYear()} Techmiary Technology Concepts`,
  directories: { output: "dist", buildResources: "build" },
  files: ["src/**/*", "app.config.json", "package.json", "!test/**", "!scripts/**", "!content/**"],
  extraResources: [{ from: "content", to: "content", filter: ["manifest.json", "blobs/**"] }],
  asar: true,
  // The lessons are already sealed and compressed media: squeezing them again only slows the build.
  compression: "store",
  ...(legacy ? { electronVersion: "22.3.27" } : {}),
  extraMetadata: { version: config.version },
  publish: null,

  win: {
    target: [{ target: "nsis", arch: legacy ? ["ia32"] : ["x64"] }],
    icon: "build/icon.png",
    artifactName: legacy ? `${name}-Setup-Windows7-8.\${ext}` : `${name}-Setup.\${ext}`,
  },
  nsis: {
    oneClick: false,
    perMachine: true,                    // one copy of the lessons for every user of the computer
    allowElevation: true,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: "always",
    createStartMenuShortcut: true,
    shortcutName: config.appName,
    runAfterFinish: true,
    deleteAppDataOnUninstall: false,     // keep progress if they reinstall
    differentialPackage: false,
    include: "build/installer.nsh",      // copies the level's videos from the folder beside the installer
  },

  linux: {
    target: [{ target: "deb", arch: ["x64"] }, { target: "AppImage", arch: ["x64"] }],
    icon: "build/icon.png",
    category: "Education",
    synopsis: "Learn to speak British English, with every lesson on your computer.",
    maintainer: "Techmiary Technology Concepts <sales@techmiary.cloud>",
    executableName: "diction-masters-offline",
    syncDesktopName: true,
    artifactName: `${name}-linux-\${arch}.\${ext}`,
    desktop: { entry: { StartupWMClass: config.appName } },
  },
};
