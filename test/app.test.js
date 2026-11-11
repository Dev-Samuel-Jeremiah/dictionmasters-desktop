/* npm test — the parts that don't need Electron. */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const marking = require("../src/main/marking");
const licence = require("../src/main/licence");
const { Content } = require("../src/main/content");
const { LessonServer } = require("../src/main/server");
const { Progress } = require("../src/main/progress");
const { parseForm } = require("../src/main/forms");
const { sealedSize } = require("../src/main/sync");

const PIECE = 1024 * 1024;

/** Seal like the website (apps/desktop_edition/keys.py). */
function seal(data, key) {
  const parts = [Buffer.from("DMB1"), Buffer.alloc(4)];
  parts[1].writeUInt32BE(PIECE);
  for (let start = 0; start < Math.max(data.length, 1); start += PIECE) {
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
    const body = Buffer.concat([cipher.update(data.subarray(start, start + PIECE)), cipher.final()]);
    parts.push(nonce, body, cipher.getAuthTag());
  }
  return Buffer.concat(parts);
}

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dm-content-"));
  fs.mkdirSync(path.join(dir, "blobs"));
  const keys = { common: crypto.randomBytes(32), "Level 1": crypto.randomBytes(32) };
  const files = { common: {}, "Level 1": {} };
  let n = 0;
  const put = (group, address, data, type) => {
    const blob = String(++n).padStart(40, "0");
    fs.writeFileSync(path.join(dir, "blobs", blob), seal(Buffer.from(data), keys[group]));
    files[group][address] = { b: blob, t: type, s: Buffer.from(data).length };
  };
  put("common", "/static/css/base.css", "body{}", "text/css");
  put("Level 1", "/accounts/dashboard/", "<html><head></head><body>Hello DMLEARNER</body></html>", "text/html; charset=utf-8");
  put("Level 1", "/echospell/level-1/group-1/activities/fill/", '<html><head></head><body><form class="activity-form" method="post"></form></body></html>', "text/html; charset=utf-8");
  put("Level 1", "/_m/video.mp4", Buffer.alloc(PIECE * 2 + 100, 7), "video/mp4");
  put("Level 1", "/_dm/answers.json", JSON.stringify({ "/echospell/level-1/group-1/activities/fill/": {
    title: "Fill the gaps", kind: "missing-letters", mode: "typed", pass_mark: 70,
    items: [{ id: 1, answers: ["cat"], first: "cat" }, { id: 2, answers: ["hat"], first: "hat" }] } }), "application/json");
  const manifest = { format: 1, release: 3, built: "2026-11-11T10:00:00", placeholder: "DMLEARNER", common: { files: files.common },
    levels: { "Level 1": { home: "/accounts/dashboard/", files: files["Level 1"], redirects: { "/tricks/x/": "/tricks/x/word-bank/" } } } };
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest));
  const b64 = Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, v.toString("base64")]));
  return { dir, keys: b64, manifest };
}

test("marking follows the website's rules", () => {
  const typed = { kind: "missing-letters", mode: "typed" };
  assert.strictEqual(marking.markResponse(typed, { answers: ["colour", "color"] }, " Color. "), true);
  assert.strictEqual(marking.markResponse(typed, { answers: ["cat"] }, ""), false);
  const ipa = { kind: "transcription", mode: "typed" };
  assert.strictEqual(marking.markResponse(ipa, { answers: ["/ʃiːp/"] }, "ʃiːp"), true);
  assert.strictEqual(marking.markResponse(ipa, { answers: ["/ʃiːp/"] }, "/ʃɪp/"), false);
  assert.strictEqual(marking.markResponse(ipa, { answers: ["/ˈhæpi/"] }, "hæpi"), true);
  const circle = { kind: "listen-and-circle", mode: "choice" };
  assert.strictEqual(marking.markResponse(circle, { answers: ["sheep\nship"], lists: [["sheep", "ship"]] }, "ship, sheep"), true);
  assert.strictEqual(marking.markResponse(circle, { answers: ["sheep\nship"], lists: [["sheep", "ship"]] }, "ship"), false);
  const number = { kind: "listen-and-number", mode: "order" };
  assert.strictEqual(marking.markResponse(number, { answers: ["1. sheep\n2. ship"], lists: [["sheep", "ship"]] }, "sheep, ship"), true);
  const sentence = { kind: "word-to-sentence", mode: "typed" };
  assert.strictEqual(marking.markResponse(sentence, { word: "cat" }, "The cat sat down."), true);
  assert.strictEqual(marking.markResponse(sentence, { word: "cat" }, "cat"), false);
  assert.strictEqual(marking.markResponse({ kind: "read-aloud", mode: "record" }, {}, "x"), null);
});

test("an attempt is scored like the website's, halves to even", () => {
  const activity = { title: "T", kind: "missing-letters", mode: "typed", pass_mark: 50,
    items: Array.from({ length: 8 }, (_, i) => ({ id: i + 1, answers: ["a"], first: "a" })) };
  const fields = { "item-1": ["a"] };
  const result = marking.markAttempt(activity, fields);
  assert.strictEqual(result.score, 1);
  assert.strictEqual(result.percent, 12);           // 12.5 -> 12, as Python's round()
  assert.strictEqual(result.passed, false);
  assert.strictEqual(result.rows[1].feedback, "You left this one blank.");
});

test("licences: signed by the website, for this computer, until their date", () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
  const payload = { a: 1, device: "pc-1", levels: ["Level 1"], until: "2030-01-01", issued: new Date().toISOString(), recheck_days: 0 };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64");
  const signature = crypto.sign(null, Buffer.from(body), privateKey).toString("base64");
  assert.strictEqual(licence.standing({ licence: body, signature }, "pc-1", raw).ok, true);
  assert.strictEqual(licence.standing({ licence: body, signature }, "pc-2", raw).reason, "device");
  const edited = Buffer.from(JSON.stringify({ ...payload, levels: ["Level 1", "Level 6"] })).toString("base64");
  assert.strictEqual(licence.standing({ licence: edited, signature }, "pc-1", raw).reason, "invalid");
  assert.strictEqual(licence.standing({ licence: body, signature }, "pc-1", raw, new Date("2030-01-02")).reason, "ended");
  const strict = Buffer.from(JSON.stringify({ ...payload, recheck_days: 30, issued: "2020-01-01T00:00:00Z" })).toString("base64");
  const strictSig = crypto.sign(null, Buffer.from(strict), privateKey).toString("base64");
  assert.strictEqual(licence.standing({ licence: strict, signature: strictSig }, "pc-1", raw).reason, "recheck");
});

test("sealed files open whole and in parts", () => {
  const { dir, keys, manifest } = fixture();
  const content = new Content([dir], keys);
  const entry = manifest.levels["Level 1"].files["/_m/video.mp4"];
  assert.strictEqual(content.read(entry, "Level 1").length, PIECE * 2 + 100);
  const middle = content.read(entry, "Level 1", PIECE - 5, PIECE + 4);
  assert.strictEqual(middle.length, 10);
  assert.ok(middle.every((byte) => byte === 7));
  assert.throws(() => new Content([dir], { "Level 1": crypto.randomBytes(32).toString("base64") }).read(entry, "Level 1"));
  assert.strictEqual(fs.statSync(content.blobFile(entry.b)).size, sealedSize(entry.s));
});

test("the lesson server: pages, ranges, redirects, activities, progress", async () => {
  const { dir, keys } = fixture();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "dm-data-"));
  const content = new Content([dir], keys);
  const progress = new Progress(data);
  const server = new LessonServer({ content, progress, uiDir: path.join(__dirname, "..", "src", "ui"),
    session: () => ({ learner: "Ada <3", level: "Level 1", levels: ["Level 1"], siteUrl: "https://www.dictionmasters.app" }) });
  const get = (address, headers) => server.handle({ url: `dm://app${address}`, method: "GET", headers: headers || { "sec-fetch-mode": "navigate", accept: "text/html" } });

  const home = await get("/accounts/dashboard/");
  assert.strictEqual(home.status, 200);
  assert.match(home.data.toString(), /Hello Ada &lt;3/);
  assert.match(home.data.toString(), /\/_desktop\/edition\.js/);

  assert.strictEqual((await get("/static/css/base.css", { accept: "text/css" })).data.toString(), "body{}");
  assert.strictEqual((await get("/static/css/base.css?v=1794393289", { accept: "text/css" })).data.toString(), "body{}");
  const part = await get("/_m/video.mp4", { range: "bytes=100-199" });
  assert.strictEqual(part.status, 206);
  assert.strictEqual(part.headers["Content-Range"], `bytes 100-199/${PIECE * 2 + 100}`);
  assert.strictEqual((await get("/tricks/x/")).headers.Location, "/tricks/x/word-bank/");
  assert.strictEqual((await get("/")).headers.Location, "/accounts/dashboard/");
  const missing = await get("/tutor/");
  assert.strictEqual(missing.status, 404);
  assert.match(missing.data.toString(), /needs the internet/);
  assert.match(missing.data.toString(), /https:\/\/www\.dictionmasters\.app\/tutor\//);

  const sent = await server.handle({ url: "dm://app/echospell/level-1/group-1/activities/fill/", method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "sec-fetch-mode": "navigate" }, body: Buffer.from("item-1=Cat&item-2=hot") });
  assert.strictEqual(sent.status, 303);
  const shown = await get(sent.headers.Location);
  const info = JSON.parse(shown.data.toString().match(/window\.DM_DESKTOP=(\{.*?\})<\/script>/)[1]);
  assert.strictEqual(info.result.score, 1);
  assert.strictEqual(info.result.rows[1].feedback, "The answer is hat");

  const done = await server.handle({ url: "dm://app/echospell/level-1/group-1/complete/", method: "POST",
    headers: { "sec-fetch-mode": "cors", "content-type": "application/x-www-form-urlencoded" }, body: Buffer.from("csrfmiddlewaretoken=x&step=3") });
  assert.strictEqual(done.status, 200);
  assert.deepStrictEqual(progress.data.completions[0].fields, { step: ["3"] });
  assert.strictEqual((await server.handle({ url: "dm://app/tutor/ask/", method: "POST", headers: { "sec-fetch-mode": "cors" }, body: null })).status, 503);
});

test("forms: multipart with a recording", () => {
  const boundary = "XyZ";
  const body = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="item-4"\r\n\r\nhello\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="recording-4"; filename="r.webm"\r\nContent-Type: audio/webm\r\n\r\nRIFFDATA\r\n--${boundary}--\r\n`);
  const form = parseForm(body, `multipart/form-data; boundary=${boundary}`);
  assert.deepStrictEqual(form.fields["item-4"], ["hello"]);
  assert.strictEqual(form.files[0].data.toString(), "RIFFDATA");
});
