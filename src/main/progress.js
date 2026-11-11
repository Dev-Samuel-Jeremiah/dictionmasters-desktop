/*
 * What the learner has done, kept on this computer (progress.json in the
 * app's data folder): pages opened, lessons marked complete, and every
 * activity attempt with its score. Recordings are saved beside it, in
 * recordings/, for a teacher to listen to on this computer.
 *
 * Plain Node, no Electron.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MAX_VISITS = 5000;

class Progress {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, "progress.json");
    this.data = { visits: [], completions: [], attempts: {}, last: "" };
    try { Object.assign(this.data, JSON.parse(fs.readFileSync(this.file, "utf8"))); } catch (error) { /* first run */ }
    this._timer = null;
  }

  _save(now) {
    clearTimeout(this._timer);
    const write = () => {
      fs.mkdirSync(this.dir, { recursive: true });
      const temp = `${this.file}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(this.data));
      fs.renameSync(temp, this.file);
    };
    if (now) write(); else this._timer = setTimeout(write, 500);
  }

  flush() { if (this._timer) this._save(true); }

  visit(learner, address) {
    this.data.last = address;
    this.data.visits.push({ learner, p: address, at: Date.now() });
    if (this.data.visits.length > MAX_VISITS) this.data.visits.splice(0, this.data.visits.length - MAX_VISITS);
    this._save();
  }

  complete(learner, address, fields) {
    this.data.completions.push({ learner, p: address, fields, at: Date.now() });
    this._save();
  }

  saveRecording(file) {
    const folder = path.join(this.dir, "recordings");
    fs.mkdirSync(folder, { recursive: true });
    const ext = (file.filename.match(/\.[a-z0-9]{2,5}$/i) || [".webm"])[0];
    const name = `${new Date().toISOString().replace(/[:.]/g, "-")}-${file.name}${ext}`;
    fs.writeFileSync(path.join(folder, name), file.data);
    return name;
  }

  addAttempt(learner, address, result) {
    const id = Date.now().toString(36) + crypto.randomBytes(3).toString("hex");
    this.data.attempts[id] = { learner, p: address, at: Date.now(), ...result };
    this._save(true);
    return id;
  }

  attempt(id) { return this.data.attempts[id] || null; }

  best(address) {
    let best = null;
    for (const attempt of Object.values(this.data.attempts)) {
      if (attempt.p === address && (!best || attempt.percent > best.percent)) best = attempt;
    }
    return best;
  }

  /** Seven booleans, Monday to Sunday of this week: did they practise that day? */
  week(now) {
    const today = now ? new Date(now) : new Date();
    const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
    const days = [false, false, false, false, false, false, false];
    const mark = (at) => {
      const index = Math.floor((at - monday.getTime()) / 86400000);
      if (index >= 0 && index < 7) days[index] = true;
    };
    const fronts = /^\/(accounts\/dashboard|learning-tools)\/$/;
    this.data.visits.forEach((visit) => { if (!fronts.test(visit.p)) mark(visit.at); });
    this.data.completions.forEach((done) => mark(done.at));
    Object.values(this.data.attempts).forEach((attempt) => mark(attempt.at));
    return days;
  }

  summary() {
    const attempts = Object.values(this.data.attempts);
    return {
      pagesOpened: new Set(this.data.visits.map((v) => v.p)).size,
      activities: new Set(attempts.map((a) => a.p)).size,
      passed: new Set(attempts.filter((a) => a.passed).map((a) => a.p)).size,
      recent: attempts.sort((a, b) => b.at - a.at).slice(0, 20).map((a) => ({ title: a.title, percent: a.percent, passed: a.passed, at: a.at, p: a.p })),
    };
  }
}

module.exports = { Progress };
