/*
 * Unlocking this computer with no internet at all.
 *
 * The app shows this computer's number (from the computer's own id). The
 * school sends it to Diction Masters, who make this computer's unlock code
 * (the website's /admin/ -> Unlocked computers). Typed in here, the code is
 * checked with nothing but sums: no internet, and no secret inside the app.
 *
 * Each level's lesson keys come in the installer LOCKED (the release's
 * manifest, levels[level].unlock). The code carries the missing piece, the
 * level's "factor", scrambled with this computer's number, the level and the
 * end date. Unscrambled here it opens the lock; on another computer, or
 * with its end date edited, the factor comes out wrong and nothing opens.
 *
 * The website does the same sums in apps/desktop_edition/unlock.py. Change
 * both together; never change LEVELS' order or EPOCH. A fixed example is
 * tested on both sides (test/unlock.test.js).
 *
 * Plain Node, no Electron, and nothing newer than Electron 22's Node
 * (the Windows 7/8 edition) can run.
 */
"use strict";

const crypto = require("crypto");

const ALPHABET = "ABCDEFGHJKMNPQRTUVWXY346789";        // no 0/O, 1/I/L, 5/S, 2/Z: read out and typed by hand
const LEVELS = ["Pre-Level", "Level 1", "Level 2", "Level 3", "Level 4", "Level 5", "Level 6",
                "Level 7", "Level 8", "Level 9", "Level 10", "Level 11", "Level 12"];
const EPOCH = Date.UTC(2026, 0, 1);
const VERSION = 1n;
const BASE = BigInt(ALPHABET.length);
const COMPUTER_CHARS = 7;
const CODE_CHARS = 20;

function sha256(text) { return crypto.createHash("sha256").update(text).digest(); }

function bigOf(buffer) { return BigInt(`0x${buffer.toString("hex") || "0"}`); }

function chars(number, length) {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out = ALPHABET[Number(number % BASE)] + out;
    number /= BASE;
  }
  return out;
}

function numberOf(text) {
  let value = 0n;
  for (const char of text) value = value * BASE + BigInt(ALPHABET.indexOf(char));
  return value;
}

function letters(raw) { return String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }

function checkChar(data) {
  let sum = 0;
  for (let place = 0; place < data.length; place += 1) sum += (place + 1) * ALPHABET.indexOf(data[place]);
  return ALPHABET[sum % ALPHABET.length];
}

// ----------------------------------------------------------------- the computer

/** The number this computer shows, from its own id (XXXXXXXX). */
function computerNumber(machineId) {
  const digest = sha256(`dm-computer|${String(machineId).trim().toLowerCase()}`);
  const data = chars(bigOf(digest.subarray(0, 6)) % BASE ** BigInt(COMPUTER_CHARS), COMPUTER_CHARS);
  return data + checkChar(data);
}

function showComputer(number) { return number ? `${number.slice(0, 4)}-${number.slice(4)}` : ""; }

// --------------------------------------------------------------------- codes

function mask(computer, index, days) {
  return bigOf(sha256(`dm-unlock|${VERSION}|${computer}|${index}|${days}`).subarray(0, 8));
}

function check(value) {
  const bytes = Buffer.from(value.toString(16).padStart(22, "0"), "hex");
  const digest = crypto.createHash("sha256").update(Buffer.concat([Buffer.from("dm-check|"), bytes])).digest();
  return BigInt(digest.readUInt16BE(0) >> 4);
}

/** Does it look like an unlock code at all (not an older online code)? */
function looksLikeCode(raw) {
  const text = letters(raw);
  return text.length === CODE_CHARS || (text.length === CODE_CHARS + 2 && text.startsWith("DM"));
}

/**
 * What a code says, for this computer: {level, until, factor} or
 * {error}. It can't tell a right code yet: only opening the lock can.
 */
function readCode(raw, computer) {
  let text = letters(raw);
  if (text.length === CODE_CHARS + 2 && text.startsWith("DM")) text = text.slice(2);
  if (text.length !== CODE_CHARS || [...text].some((char) => !ALPHABET.includes(char))) {
    return { error: "That isn't an unlock code. It looks like DM-XXXX-XXXX-XXXX-XXXX-XXXX." };
  }
  const full = numberOf(text);
  const value = full >> 12n;
  if (value >= 1n << 83n || check(value) !== (full & 0xFFFn)) {
    return { error: "One of the characters isn't right. Check the code letter by letter." };
  }
  const index = Number((value >> 77n) & 0xFn);
  const days = Number((value >> 64n) & 0x1FFFn);
  if ((value >> 81n) !== VERSION || index >= LEVELS.length) return { error: "This code is for a newer version of the app." };
  const factor = (value & ((1n << 64n) - 1n)) ^ mask(computer, index, days);
  return {
    level: LEVELS[index],
    until: days ? new Date(EPOCH + days * 86400000).toISOString().slice(0, 10) : null,
    factor: Buffer.from(factor.toString(16).padStart(16, "0"), "hex"),
  };
}

/** The keys a level's lock holds, opened with its factor; null if it's the wrong one. */
function unwrap(wrapped, level, factor) {
  try {
    const raw = Buffer.from(String(wrapped), "base64");
    const key = crypto.createHash("sha256").update(Buffer.concat([Buffer.from("dm-unwrap|"), factor])).digest();
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(level));
    decipher.setAuthTag(raw.subarray(raw.length - 16));
    return JSON.parse(Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString("utf8"));
  } catch (error) {
    return null;
  }
}

/**
 * Unlock with a code: {ok, level, until, keys} or {ok: false, error}.
 * manifest: the lessons on this computer (each level's lock is in it).
 */
function unlock(raw, computer, manifest) {
  const found = readCode(raw, computer);
  if (found.error) return { ok: false, error: found.error };
  const group = manifest && manifest.levels && manifest.levels[found.level];
  if (!group) {
    const here = manifest ? Object.keys(manifest.levels || {}).join(", ") : "";
    return { ok: false, error: `This code is for ${found.level}, but this computer has ${here || "no lessons"} installed. Install ${found.level} first.` };
  }
  const keys = group.unlock ? unwrap(group.unlock, found.level, found.factor) : null;
  if (!keys) {
    return { ok: false, error: `This code doesn't match this computer (number ${showComputer(computer)}). Check the code, and that it was made for this number.` };
  }
  return { ok: true, level: found.level, until: found.until, keys };
}

module.exports = { ALPHABET, LEVELS, computerNumber, showComputer, looksLikeCode, readCode, unwrap, unlock };
