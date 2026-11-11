/*
 * The lessons on this computer.
 *
 * Two folders hold them, each with manifest.json and blobs/:
 *
 *   installed    came with the installer (resources/content). Never changed.
 *   downloaded   newer lessons from the website (sync.js), in the app's own
 *                data folder. Only files that changed are here; everything
 *                else is still read from the installed folder.
 *
 * Whichever manifest is the newer release is the one used.
 *
 * Every file is sealed with its level's key (AES-256-GCM, in 1 MB pieces;
 * the website's apps/desktop_edition/keys.py). Pieces are opened one by one,
 * so the middle of a video plays without decrypting the whole thing.
 *
 * Plain Node, no Electron, so `npm test` can run it.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MAGIC = Buffer.from("DMB1");
const OVERHEAD = 12 + 16;

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { return null; }
}

class Content {
  /** dirs: [installed, downloaded]; keys: {group: base64 key}. */
  constructor(dirs, keys) {
    this.dirs = dirs.filter(Boolean);
    this.keys = keys || {};
    this.reload();
  }

  reload() {
    let best = null;
    for (const dir of this.dirs) {
      const manifest = readJSON(path.join(dir, "manifest.json"));
      if (manifest && (!best || (manifest.release || 0) > (best.release || 0))) best = manifest;
    }
    this.manifest = best;
    this.answers = {};
    return best;
  }

  get release() { return this.manifest ? this.manifest.release || 0 : 0; }
  get levels() { return this.manifest ? Object.keys(this.manifest.levels || {}) : []; }

  setKeys(keys) { this.keys = keys || {}; this.answers = {}; }

  /** The entry for an address, and the group (level) it belongs to. Looks in
   *  the learner's level first, then the shared files, then their other levels. */
  find(address, level, otherLevels) {
    const m = this.manifest;
    if (!m) return null;
    const order = [level, ...(otherLevels || []).filter((name) => name !== level)];
    const own = m.levels[level];
    if (own && own.files[address]) return { entry: own.files[address], group: level };
    if (m.common.files[address]) return { entry: m.common.files[address], group: "common" };
    for (const name of order.slice(1)) {
      const group = m.levels[name];
      if (group && group.files[address] && !address.endsWith("/") && !address.includes("/?")) {
        return { entry: group.files[address], group: name };    // a picture or recording, not another level's page
      }
    }
    return null;
  }

  redirect(address, level) {
    const group = this.manifest && this.manifest.levels[level];
    return group && group.redirects ? group.redirects[address] || null : null;
  }

  home(level) {
    const group = this.manifest && this.manifest.levels[level];
    return group ? group.home : "/";
  }

  blobFile(blob) {
    for (const dir of [...this.dirs].reverse()) {
      const file = path.join(dir, "blobs", blob);
      if (fs.existsSync(file)) return file;
    }
    return null;
  }

  has(blob) { return Boolean(this.blobFile(blob)); }

  _key(group) {
    const raw = this.keys[group];
    if (!raw) throw Object.assign(new Error(`No key for ${group}`), { code: "NO_KEY" });
    return Buffer.from(raw, "base64");
  }

  /**
   * The bytes [start, end] (inclusive) of a file; the whole file by default.
   */
  read(entry, group, start, end) {
    const file = this.blobFile(entry.b);
    if (!file) throw Object.assign(new Error(`Missing ${entry.b}`), { code: "MISSING" });
    const size = entry.s;
    start = Math.max(0, start || 0);
    end = Math.min(size - 1, end == null ? size - 1 : end);
    if (size === 0 || end < start) return Buffer.alloc(0);
    const key = this._key(group);
    const fd = fs.openSync(file, "r");
    try {
      const header = Buffer.alloc(8);
      fs.readSync(fd, header, 0, 8, 0);
      if (!header.subarray(0, 4).equals(MAGIC)) throw new Error("Not a sealed lesson file");
      const piece = header.readUInt32BE(4);
      const first = Math.floor(start / piece);
      const last = Math.floor(end / piece);
      const parts = [];
      for (let index = first; index <= last; index += 1) {
        const plainLength = Math.min(piece, size - index * piece);
        const sealed = Buffer.alloc(plainLength + OVERHEAD);
        fs.readSync(fd, sealed, 0, sealed.length, 8 + index * (piece + OVERHEAD));
        const decipher = crypto.createDecipheriv("aes-256-gcm", key, sealed.subarray(0, 12));
        decipher.setAuthTag(sealed.subarray(sealed.length - 16));
        const plain = Buffer.concat([decipher.update(sealed.subarray(12, sealed.length - 16)), decipher.final()]);
        const from = index === first ? start - index * piece : 0;
        const to = index === last ? end - index * piece + 1 : plain.length;
        parts.push(plain.subarray(from, to));
      }
      return Buffer.concat(parts);
    } finally {
      fs.closeSync(fd);
    }
  }

  readText(entry, group) { return this.read(entry, group).toString("utf8"); }

  /** {activity page: what marking needs} for a level (written by the website's export). */
  answersFor(level) {
    if (!this.answers[level]) {
      const found = this.find("/_dm/answers.json", level);
      this.answers[level] = found ? JSON.parse(this.readText(found.entry, found.group)) : {};
    }
    return this.answers[level];
  }

  /** Every blob a manifest uses, for these levels. */
  static blobsOf(manifest, levels) {
    const wanted = new Map();
    const groups = [manifest.common, ...Object.entries(manifest.levels).filter(([name]) => !levels || levels.includes(name)).map(([, g]) => g)];
    for (const group of groups) {
      for (const entry of Object.values(group.files)) wanted.set(entry.b, entry.s);
    }
    return wanted;
  }
}

module.exports = { Content };
