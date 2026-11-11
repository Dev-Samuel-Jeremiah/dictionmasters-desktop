/*
 * The lessons, served inside the app at dm://app/ — no internet, no web server.
 *
 * Every request a lesson page makes comes here (main.js wires it to the
 * app's own "dm:" protocol) and is answered from the lessons on the
 * computer (content.js):
 *
 *   GET a page         the page as the website rendered it for this level,
 *                      with the learner's name put in, and edition.css/.js
 *                      added (what the computer app changes on the page)
 *   GET a file         styles, scripts, pictures, recordings, videos
 *                      (videos in parts, so they can be skipped through)
 *   POST an activity   marked here (marking.js), kept in progress.js, then
 *                      the activity page again with the result on it
 *   POST progress      "I finished this", "my place in the cards": kept
 *   anything else      a page that needs the internet: a friendly page
 *                      saying so, with a button to open it on the website
 *
 * Plain Node, no Electron, so `npm test` can run it.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const { markAttempt } = require("./marking");
const { parseForm } = require("./forms");

const PROGRESS_POSTS = [
  /^\/learning-modules\/[^/]+\/[^/]+\/[^/]+\/[^/]+\/complete\/$/,
  /^\/echospell\/[^/]+\/[^/]+\/complete\/$/,
  /^\/echospell\/card-position\/$/,
  /^\/reading-club\/[^/]+\/[^/]+\/[^/]+\/complete\/$/,
  /^\/assessments\/attempt\/\d+\/save\/$/,
];
const UI_TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml" };
const RANGE_CHUNK = 4 * 1024 * 1024;

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function header(headers, name) {
  if (!headers) return "";
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) if (key.toLowerCase() === wanted) return String(value);
  return "";
}

class LessonServer {
  /**
   * content: Content; progress: Progress; uiDir: src/ui;
   * session(): {learner, level, levels, release, siteUrl} for the person using the app now.
   */
  constructor({ content, progress, uiDir, session }) {
    this.content = content;
    this.progress = progress;
    this.uiDir = uiDir;
    this.session = session;
  }

  _ui(name) {
    const file = path.join(this.uiDir, name);
    if (!file.startsWith(this.uiDir) || !fs.existsSync(file)) return null;
    return fs.readFileSync(file);
  }

  _respond(status, type, data, extra) {
    return { status, headers: { "Content-Type": type, "Cache-Control": "no-store", ...(extra || {}) }, data: data == null ? Buffer.alloc(0) : Buffer.isBuffer(data) ? data : Buffer.from(data) };
  }

  _redirect(location) {
    return { status: 303, headers: { Location: location, "Cache-Control": "no-store" }, data: Buffer.alloc(0) };
  }

  _page(html, extra) {
    const s = this.session();
    const name = escapeHtml(s.learner || "Learner");
    const placeholder = (this.content.manifest && this.content.manifest.placeholder) || "DMLEARNER";
    html = html.split(placeholder).join(name).split(placeholder.toLowerCase()).join(name);
    const info = { learner: s.learner || "", level: s.level, levels: s.levels, release: this.content.release, site: s.siteUrl, ...(extra || {}) };
    const head = `<link rel="stylesheet" href="/_desktop/edition.css"><script>window.DM_DESKTOP=${safeJson(info)}</script>` +
      `<script src="/_desktop/edition.js" defer></script>`;
    html = html.includes("</head>") ? html.replace("</head>", head + "</head>") : head + html;
    return this._respond(200, "text/html; charset=utf-8", html);
  }

  needsInternet(address, why) {
    const s = this.session();
    const template = (this._ui("needs-internet.html") || Buffer.from("<h1>This needs the internet</h1>")).toString("utf8");
    const online = s.siteUrl ? s.siteUrl.replace(/\/+$/, "") + address : "";
    const html = template.split("{{why}}").join(escapeHtml(why || "This part of Diction Masters needs the internet."))
      .split("{{online}}").join(escapeHtml(online)).split("{{home}}").join(escapeHtml(this.content.home(s.level)));
    return { ...this._page(html), status: 404 };
  }

  _file(found, headers) {
    const { entry, group } = found;
    const range = header(headers, "range").match(/bytes=(\d*)-(\d*)/);
    if (range && entry.s > 0) {
      let start = range[1] === "" ? Math.max(0, entry.s - Number(range[2])) : Number(range[1]);
      let end = range[1] !== "" && range[2] !== "" ? Number(range[2]) : Math.min(entry.s - 1, start + RANGE_CHUNK - 1);
      end = Math.min(end, entry.s - 1);
      if (start > end || start >= entry.s) {
        return { status: 416, headers: { "Content-Range": `bytes */${entry.s}` }, data: Buffer.alloc(0) };
      }
      const data = this.content.read(entry, group, start, end);
      return { status: 206, headers: { "Content-Type": entry.t, "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${entry.s}`, "Content-Length": String(data.length) }, data };
    }
    const data = this.content.read(entry, group);
    const extra = entry.t.startsWith("text/html") ? {} : { "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=86400" };
    return { status: 200, headers: { "Content-Type": entry.t, "Cache-Control": "no-store", ...extra }, data };
  }

  async handle(request) {
    const url = new URL(request.url);
    const address = url.pathname;                      // encoded, exactly as the website's own addresses
    const s = this.session();
    try {
      if (address.startsWith("/_desktop/")) {
        const name = address.slice("/_desktop/".length);
        const data = this._ui(name);
        return data ? this._respond(200, UI_TYPES[path.extname(name)] || "application/octet-stream", data) : this._respond(404, "text/plain", "");
      }
      if (request.method === "POST") return this._post(request, url, address);

      if (address === "/" || /^\/accounts\/(login|logout|switch)\//.test(address)) return this._redirect(this.content.home(s.level));

      const result = url.searchParams.get("dm-result");
      const search = url.search.replace(/([?&])dm-result=[^&]*&?/, "$1").replace(/[?&]$/, "");
      // Exactly as asked first; then without the query: styles and scripts
      // carry "?v=…" to defeat browser caches, which doesn't matter here.
      const candidates = search ? [address + search, address] : [address];

      for (const candidate of candidates) {
        const to = this.content.redirect(candidate, s.level);
        if (to) return this._redirect(to);
        const found = this.content.find(candidate, s.level, s.levels);
        if (found) {
          if (!found.entry.t.startsWith("text/html")) return this._file(found, request.headers);
          this.progress.visit(s.learner, candidate);
          const extra = { week: this.progress.week() };
          if (result) extra.result = this.progress.attempt(result);
          const best = this.progress.best(address);
          if (best) extra.best = { percent: best.percent, passed: best.passed };
          return this._page(this.content.readText(found.entry, found.group), extra);
        }
      }
      // A file a page asks for in the background (a picture, a script, data):
      // say "not here" plainly. A page someone opened: say it needs the internet.
      const accept = header(request.headers, "accept");
      const mode = header(request.headers, "sec-fetch-mode");
      if (mode === "navigate" || (accept.includes("text/html") && mode !== "cors" && mode !== "no-cors")) {
        return this.needsInternet(address + search);
      }
      if (accept.includes("json")) return this._respond(404, "application/json", JSON.stringify({ ok: false, offline: true }));
      return this._respond(404, "text/plain", "");
    } catch (error) {
      if (error.code === "NO_KEY") return this.needsInternet(address, "This level isn't part of your code.");
      if (error.code === "MISSING") return this.needsInternet(address, "This lesson hasn't finished downloading yet.");
      return this._respond(500, "text/plain", `Something went wrong: ${error.message}`);
    }
  }

  _post(request, url, address) {
    const s = this.session();
    const navigate = header(request.headers, "sec-fetch-mode") === "navigate" || !header(request.headers, "sec-fetch-mode");
    const answers = this.content.answersFor(s.level);
    const activity = answers[address];
    const form = parseForm(request.body, header(request.headers, "content-type"));

    if (activity) {
      const recorded = new Set();
      for (const file of form.files) {
        const match = file.name.match(/^recording-(\d+)$/);
        if (match) { recorded.add(match[1]); this.progress.saveRecording(file); }
      }
      const result = markAttempt(activity, form.fields, recorded);
      const id = this.progress.addAttempt(s.learner, address, result);
      if (!navigate) return this._respond(200, "application/json", JSON.stringify({ ok: true, result, redirect: `${address}?dm-result=${id}` }));
      return this._redirect(`${address}?dm-result=${id}`);
    }
    if (PROGRESS_POSTS.some((pattern) => pattern.test(address)) || /\/complete\/$/.test(address)) {
      const fields = {};
      for (const [name, values] of Object.entries(form.fields)) if (name !== "csrfmiddlewaretoken") fields[name] = values;
      this.progress.complete(s.learner, address, fields);
      if (!navigate) return this._respond(200, "application/json", JSON.stringify({ ok: true }));
      const back = header(request.headers, "referer");
      return this._redirect(back && back.startsWith("dm://app/") ? back.slice("dm://app".length) : address.replace(/complete\/$/, ""));
    }
    if (/^\/accounts\/logout\/$/.test(address)) return this._redirect(this.content.home(s.level));
    if (!navigate) return this._respond(503, "application/json", JSON.stringify({ ok: false, offline: true, error: "This needs the internet." }));
    return this.needsInternet(address, "Sending this needs the internet. Everything else in your lessons works here.");
  }
}

module.exports = { LessonServer, escapeHtml };
