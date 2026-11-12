/*
 * What the app keeps about itself (state.json in its data folder): this
 * computer's id, the learner's name and level, the licence, and the keys to
 * the lessons. The keys are locked with the computer's own key store when it
 * has one (Electron safeStorage: Windows DPAPI, the Linux keyring), so
 * copying the data folder to another computer doesn't copy the keys.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

class State {
  /** safe: electron.safeStorage, or null (tests). */
  constructor(dir, safe) {
    this.dir = dir;
    this.file = path.join(dir, "state.json");
    this.safe = safe && safe.isEncryptionAvailable && safe.isEncryptionAvailable() ? safe : null;
    this.data = {};
    try { this.data = JSON.parse(fs.readFileSync(this.file, "utf8")); } catch (error) { /* first run */ }
    if (!this.data.deviceId) {
      this.data.deviceId = crypto.randomUUID();
      this.save();
    }
  }

  get(name) { return this.data[name]; }

  set(values) {
    Object.assign(this.data, values);
    this.save();
  }

  save() {
    fs.mkdirSync(this.dir, { recursive: true });
    const temp = `${this.file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.data, null, 1));
    fs.renameSync(temp, this.file);
  }

  get keys() {
    try {
      if (this.data.keysLocked && this.safe) return JSON.parse(this.safe.decryptString(Buffer.from(this.data.keysLocked, "base64")));
      if (this.data.keys) return this.data.keys;
    } catch (error) { /* locked on another computer */ }
    return {};
  }

  set keys(value) {
    if (this.safe) {
      this.data.keysLocked = this.safe.encryptString(JSON.stringify(value)).toString("base64");
      delete this.data.keys;
    } else {
      this.data.keys = value;
      delete this.data.keysLocked;
    }
    this.save();
  }

  /** Forget the licence (a different code, or the website stopped this one). */
  forgetLicence() {
    for (const name of ["licence", "signature", "keys", "keysLocked", "lastCheck", "unlock"]) delete this.data[name];
    this.save();
  }
}

module.exports = { State };
