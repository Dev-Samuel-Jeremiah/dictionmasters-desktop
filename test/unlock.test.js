/* Unlocking offline (src/main/unlock.js). The fixed example is the same as
   the website's (apps/desktop_edition/tests.py, UnlockCodeTests): the two
   must always agree, or codes made on the website won't open the app. */
"use strict";

const test = require("node:test");
const assert = require("node:assert");

const unlock = require("../src/main/unlock");

// Made by the website with DESKTOP_CONTENT_KEY = bytes 0..31.
const EXAMPLE = {
  machineId: "0f3c2a6e9b7d4e1f8a2b3c4d5e6f7a8b",
  computer: "7GF38R79",
  code: "DM-GXXA-NBMH-8NAY-V6EM-GN7H",
  factor: "59807329d4957ccb",
  wrap: "Mja2Y/433Yxahp6/MQO5Cm6fEzmpvPTN5YTsboQz8ej0KBwSz1L2M06jco8tMRv3z+OSmfldcMjsM/TcHLHzpaljGBuaot9jH10HT4f3g65n3IDZlknTGSjkAeAeFbi1aeGC7dq/Evq/OgtsRmRMXo68nDxPJ3e82GMYMHPfQYixOoAlJogZEg/OeEbQ4v5gVQ==",
  levelKey: "9xFSTBIKo5tdExsy8rpqebsKfiUkDYa4uBykKKq6qI0=",
  commonKey: "kmSFvAyJRS758ggQtcXS3gpKg0u4gFx5szFEn3WmniY=",
};
const manifest = { levels: { "Level 1": { unlock: EXAMPLE.wrap } } };

test("the same computer number and code as the website", () => {
  assert.strictEqual(unlock.computerNumber(EXAMPLE.machineId), EXAMPLE.computer);
  assert.strictEqual(unlock.computerNumber(` ${EXAMPLE.machineId.toUpperCase()}\n`), EXAMPLE.computer, "id read with spaces or capitals");
  const found = unlock.readCode(EXAMPLE.code, EXAMPLE.computer);
  assert.deepStrictEqual([found.level, found.until, found.factor.toString("hex")], ["Level 1", "2027-07-31", EXAMPLE.factor]);
});

test("the right code opens the level's keys", () => {
  const opened = unlock.unlock(EXAMPLE.code.toLowerCase().replace(/-/g, " "), EXAMPLE.computer, manifest);
  assert.ok(opened.ok, opened.error);
  assert.deepStrictEqual(opened.keys, { "Level 1": EXAMPLE.levelKey, common: EXAMPLE.commonKey });
  assert.strictEqual(opened.until, "2027-07-31");
});

test("another computer, a typo, an edited date or a missing level open nothing", () => {
  const elsewhere = unlock.unlock(EXAMPLE.code, unlock.computerNumber("another-machine"), manifest);
  assert.ok(!elsewhere.ok && /doesn't match this computer/.test(elsewhere.error));
  const typo = EXAMPLE.code.slice(0, -1) + (EXAMPLE.code.endsWith("A") ? "B" : "A");
  assert.ok(/isn't right/.test(unlock.unlock(typo, EXAMPLE.computer, manifest).error));
  assert.ok(/isn't an unlock code/.test(unlock.unlock("DM-K7QX-3MPA", EXAMPLE.computer, manifest).error));
  const noLevel = unlock.unlock(EXAMPLE.code, EXAMPLE.computer, { levels: { "Level 2": { unlock: EXAMPLE.wrap } } });
  assert.ok(/is for Level 1, but this computer has Level 2/.test(noLevel.error));
});

test("computer numbers carry a check character", () => {
  const number = unlock.computerNumber("machine-a");
  assert.strictEqual(number.length, 8);
  assert.match(unlock.showComputer(number), /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.ok(unlock.looksLikeCode(EXAMPLE.code) && !unlock.looksLikeCode("DM-K7QX-3MPA-9VTR"));
});
