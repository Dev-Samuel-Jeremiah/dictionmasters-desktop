/*
 * New lessons from the website, when the internet is there.
 *
 *   1. Check in (POST /desktop-app/check/): a fresh licence and keys, or
 *      "stopped" if the code was stopped or this computer's seat freed.
 *   2. Ask for the newest release (GET /desktop-app/content/latest/).
 *   3. If it's newer than the one here, download only the files this
 *      computer hasn't got (for its own levels), then switch to it.
 *
 * Nothing is used until every file is down, so a dropped connection never
 * leaves half a release: the next try carries on where this one stopped.
 *
 * Plain Node; the network comes in as `requester` (electron.net).
 */
"use strict";

const fs = require("fs");
const path = require("path");

const { Content } = require("./content");
const net = require("./net");

function sealedSize(plain) {
  const piece = 1024 * 1024;
  const pieces = Math.max(1, Math.ceil(plain / piece));
  return 8 + plain + 28 * pieces;
}

class Sync {
  constructor({ content, state, requester, siteUrl, downloadedDir, appVersion, onChange, onStopped }) {
    Object.assign(this, { content, state, requester, downloadedDir, appVersion, onChange, onStopped });
    this.site = siteUrl.replace(/\/+$/, "");
    this.status = { busy: false, ready: false, message: "", done: 0, total: 0 };
    this.running = null;
  }

  _set(values) {
    Object.assign(this.status, values);
    if (this.onChange) this.onChange({ ...this.status });
  }

  headers() {
    return { "X-DM-Licence": `${this.state.get("licence")}.${this.state.get("signature")}` };
  }

  async checkIn() {
    const unlocked = this.state.get("unlock");
    if (!this.state.get("licence") && !unlocked) return { ok: false };
    // A computer unlocked with no internet, online at last: its number and
    // code stand in for the licence (the website answers with one).
    const sent = this.state.get("licence")
      ? { licence: this.state.get("licence"), signature: this.state.get("signature") }
      : { computer: unlocked.computer, unlock: unlocked.code };
    const { status, data } = await net.json(this.requester, {
      url: `${this.site}/desktop-app/check/`, method: "POST",
      data: { ...sent, release: this.content.release, app_version: this.appVersion },
    });
    if (data && data.ok) {
      this.state.set({ licence: data.licence, signature: data.signature, lastCheck: Date.now() });
      this.state.keys = data.keys;
      this.content.setKeys(data.keys);
      return { ok: true, release: data.release };
    }
    if (data && data.stopped) {
      if (this.onStopped) this.onStopped(data.error);
      return { ok: false, stopped: true, error: data.error };
    }
    throw new Error(`The website answered ${status}.`);
  }

  /** Check in, then fetch a newer release if there is one. Safe to call often. */
  run() {
    if (!this.running) this.running = this._run().finally(() => { this.running = null; });
    return this.running;
  }

  async _run() {
    this._set({ busy: true, message: "Checking for new lessons…" });
    try {
      const checked = await this.checkIn();
      if (!checked.ok) { this._set({ busy: false, message: checked.error || "" }); return this.status; }
      if (checked.release && checked.release <= this.content.release) {
        // Same release: fetch only what's missing here (a download that was
        // cut off, videos left out of the installer, a level added to the code).
        if (this.missing(this.content.manifest).length) {
          await this._fetch(this.content.manifest);
          this._set({ busy: false, ready: true, announce: true, message: "The rest of your lessons have downloaded.", checkedAt: Date.now() });
          this.status.announce = false;
        } else {
          this._set({ busy: false, message: "Your lessons are up to date.", checkedAt: Date.now() });
        }
        return this.status;
      }
      const { data } = await net.json(this.requester, { url: `${this.site}/desktop-app/content/latest/`, headers: this.headers(), timeout: 120000 });
      if (!data || !data.ok) throw new Error("The website didn't send the list of lessons.");
      if (!data.release || data.release <= this.content.release) {
        this._set({ busy: false, message: "Your lessons are up to date.", checkedAt: Date.now() });
        return this.status;
      }
      delete data.ok;
      await this._fetch(data);
      this._set({ busy: false, ready: true, announce: true, message: `New lessons are ready (release ${data.release}).`, checkedAt: Date.now() });
      this.status.announce = false;
    } catch (error) {
      this._set({ busy: false, message: `Couldn't reach the website (${error.message}). Your lessons still work.` });
    }
    return this.status;
  }

  /** [[blob, size]] a manifest uses, for this computer's levels, that aren't here. */
  missing(manifest) {
    if (!manifest) return [];
    const levels = Object.keys(this.content.keys).filter((group) => group !== "common");
    return [...Content.blobsOf(manifest, levels).entries()].filter(([blob]) => !this.content.has(blob));
  }

  async _fetch(manifest) {
    const blobs = path.join(this.downloadedDir, "blobs");
    fs.mkdirSync(blobs, { recursive: true });
    const levels = Object.keys(this.content.keys).filter((group) => group !== "common");
    const wanted = Content.blobsOf(manifest, levels);
    const missing = this.missing(manifest);
    const bytes = missing.reduce((sum, [, size]) => sum + sealedSize(size), 0);
    let done = 0;
    let got = 0;
    this._set({ total: missing.length, done: 0, message: `Downloading new lessons: ${Math.round(bytes / 1048576)} MB…` });
    for (const [blob, size] of missing) {
      const file = path.join(blobs, blob);
      const length = await net.download(this.requester, { url: `${this.site}/desktop-app/content/blob/${blob}/`, headers: this.headers(), file });
      if (length !== sealedSize(size)) { fs.rmSync(file, { force: true }); throw new Error("a file arrived damaged"); }
      done += 1;
      got += length;
      if (done % 10 === 0 || done === missing.length) {
        this._set({ done, message: `Downloading new lessons: ${Math.round(got / 1048576)} of ${Math.round(bytes / 1048576)} MB…` });
      }
    }
    if (manifest !== this.content.manifest) {
      const target = path.join(this.downloadedDir, "manifest.json");
      fs.writeFileSync(`${target}.tmp`, JSON.stringify(manifest));
      fs.renameSync(`${target}.tmp`, target);
      this.content.reload();
    }
    this._prune(wanted);
  }

  /** Delete downloaded files the newest release no longer uses. */
  _prune(wanted) {
    const blobs = path.join(this.downloadedDir, "blobs");
    for (const name of fs.readdirSync(blobs)) {
      if (!wanted.has(name.replace(/\.part$/, "")) || name.endsWith(".part")) fs.rmSync(path.join(blobs, name), { force: true });
    }
  }
}

module.exports = { Sync, sealedSize };
