/*
 * The licence: what the website gave this computer when its code was typed
 * in (the website's apps/desktop_edition/views.py, "activate").
 *
 *   licence    base64 JSON: the code, its levels, its end date, this
 *              computer's id, when it was issued
 *   signature  the website's Ed25519 signature of it
 *   keys       the keys that open those levels' lessons
 *
 * The signature is checked here with the public key in app.config.json, so
 * a licence can't be written or edited by hand. Everything is checked with
 * no internet: the end date against the computer's clock, and (only if the
 * website asks for it, DESKTOP_RECHECK_DAYS) how long since it last checked in.
 *
 * Plain Node, no Electron, so `npm test` can run it.
 */
"use strict";

const crypto = require("crypto");

const ED25519_SPKI = Buffer.from("302a300506032b6570032100", "hex");

function publicKey(base64) {
  return crypto.createPublicKey({ key: Buffer.concat([ED25519_SPKI, Buffer.from(base64, "base64")]), format: "der", type: "spki" });
}

/** The licence's contents if the website signed it, else null. */
function verify(licence, signature, publicKeyBase64) {
  if (!licence || !signature || !publicKeyBase64) return null;
  try {
    const ok = crypto.verify(null, Buffer.from(String(licence)), publicKey(publicKeyBase64), Buffer.from(String(signature), "base64"));
    return ok ? JSON.parse(Buffer.from(String(licence), "base64").toString("utf8")) : null;
  } catch (error) {
    return null;
  }
}

function today(now) {
  const d = now || new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Can this computer open its lessons now? {ok, payload} or {ok: false, reason, message}.
 * state: {licence, signature, lastCheck (ms)}.
 */
function standing(state, deviceId, publicKeyBase64, now) {
  if (!state || !state.licence) return { ok: false, reason: "none", message: "" };
  const payload = verify(state.licence, state.signature, publicKeyBase64);
  if (!payload) return { ok: false, reason: "invalid", message: "This computer's licence isn't valid. Please type your code again." };
  if (payload.device !== deviceId) {
    return { ok: false, reason: "device", message: "This licence belongs to another computer. Please type your code to use it here." };
  }
  const date = today(now);
  if (payload.until && date > payload.until) {
    return { ok: false, reason: "ended", payload,
             message: `Your code ended on ${payload.until}. Please contact Diction Masters to renew it.` };
  }
  const days = Number(payload.recheck_days || 0);
  const last = Number(state.lastCheck || Date.parse(payload.issued) || 0);
  if (days > 0 && (now || new Date()).getTime() - last > days * 86400000) {
    return { ok: false, reason: "recheck", payload,
             message: `Please connect this computer to the internet once, so it can check its code (every ${days} days).` };
  }
  return { ok: true, payload };
}

module.exports = { verify, standing, today };
