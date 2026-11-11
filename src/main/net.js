/*
 * Talking to the website. Uses Electron's own network stack (net.request),
 * so the computer's proxy settings are used, as in a school network. Works
 * on Electron 22 (the Windows 7/8 edition), which has no fetch() here.
 *
 * The functions take a `requester` (electron.net, or a stand-in in tests).
 */
"use strict";

const fs = require("fs");

function send(requester, { url, method = "GET", headers = {}, body = null, timeout = 30000 }) {
  return new Promise((resolve, reject) => {
    const request = requester.request({ url, method, redirect: "follow" });
    for (const [name, value] of Object.entries(headers)) request.setHeader(name, value);
    const timer = setTimeout(() => { request.abort(); reject(new Error("The website took too long to answer.")); }, timeout);
    request.on("response", (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => { clearTimeout(timer); resolve({ status: response.statusCode, body: Buffer.concat(chunks) }); });
      response.on("error", (error) => { clearTimeout(timer); reject(error); });
    });
    request.on("error", (error) => { clearTimeout(timer); reject(error); });
    if (body != null) request.write(body);
    request.end();
  });
}

async function json(requester, options) {
  const headers = { Accept: "application/json", ...(options.headers || {}) };
  let body = null;
  if (options.data !== undefined) {
    body = JSON.stringify(options.data);
    headers["Content-Type"] = "application/json";
  }
  const answer = await send(requester, { ...options, headers, body });
  let data = null;
  try { data = JSON.parse(answer.body.toString("utf8")); } catch (error) { /* not JSON */ }
  return { status: answer.status, data };
}

/** Download to a file (through a .part file, so a half download is never used). */
function download(requester, { url, headers = {}, file, timeout = 120000 }) {
  return new Promise((resolve, reject) => {
    const part = `${file}.part`;
    const out = fs.createWriteStream(part);
    let size = 0;
    const request = requester.request({ url, method: "GET", redirect: "follow" });
    for (const [name, value] of Object.entries(headers)) request.setHeader(name, value);
    let timer = setTimeout(() => request.abort(), timeout);
    const fail = (error) => { clearTimeout(timer); out.destroy(); fs.rm(part, { force: true }, () => reject(error)); };
    request.on("response", (response) => {
      if (response.statusCode !== 200) { response.on("data", () => {}); fail(new Error(`The website answered ${response.statusCode}.`)); return; }
      response.on("data", (chunk) => {
        size += chunk.length;
        clearTimeout(timer);
        timer = setTimeout(() => request.abort(), timeout);
        out.write(Buffer.from(chunk));
      });
      response.on("end", () => {
        clearTimeout(timer);
        out.end(() => { fs.renameSync(part, file); resolve(size); });
      });
      response.on("error", fail);
    });
    request.on("abort", () => fail(new Error("The download stopped.")));
    request.on("error", fail);
    request.end();
  });
}

module.exports = { send, json, download };
