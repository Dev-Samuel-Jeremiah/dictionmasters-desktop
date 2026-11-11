/*
 * Reading what a page's form sent: {fields: {name: [values]}, files: [{name, filename, type, data}]}.
 * Handles ordinary forms and multipart ones (an activity with a voice recording).
 */
"use strict";

function parseUrlEncoded(text) {
  const fields = {};
  for (const [name, value] of new URLSearchParams(text)) (fields[name] = fields[name] || []).push(value);
  return fields;
}

function parseMultipart(body, boundary) {
  const fields = {};
  const files = [];
  const marker = Buffer.from(`--${boundary}`);
  let start = body.indexOf(marker);
  while (start !== -1) {
    start += marker.length;
    if (body.subarray(start, start + 2).toString() === "--") break;
    const next = body.indexOf(marker, start);
    if (next === -1) break;
    let part = body.subarray(start, next);
    if (part.subarray(0, 2).toString() === "\r\n") part = part.subarray(2);
    if (part.subarray(part.length - 2).toString() === "\r\n") part = part.subarray(0, part.length - 2);
    const split = part.indexOf("\r\n\r\n");
    if (split !== -1) {
      const head = part.subarray(0, split).toString("utf8");
      const data = part.subarray(split + 4);
      const name = (head.match(/name="([^"]*)"/i) || [])[1];
      const filename = (head.match(/filename="([^"]*)"/i) || [])[1];
      const type = (head.match(/content-type:\s*([^\r\n]+)/i) || [])[1] || "application/octet-stream";
      if (name != null) {
        if (filename != null) {
          if (data.length) files.push({ name, filename, type, data });
        } else {
          (fields[name] = fields[name] || []).push(data.toString("utf8"));
        }
      }
    }
    start = next;
  }
  return { fields, files };
}

function parseForm(body, contentType) {
  body = body || Buffer.alloc(0);
  const type = String(contentType || "");
  const boundary = (type.match(/boundary=(?:"([^"]+)"|([^;]+))/i) || []).slice(1).find(Boolean);
  if (/multipart\/form-data/i.test(type) && boundary) return parseMultipart(body, boundary.trim());
  if (/application\/json/i.test(type)) {
    try {
      const data = JSON.parse(body.toString("utf8"));
      const fields = {};
      for (const [name, value] of Object.entries(data || {})) fields[name] = [].concat(value).map(String);
      return { fields, files: [] };
    } catch (error) { return { fields: {}, files: [] }; }
  }
  return { fields: parseUrlEncoded(body.toString("utf8")), files: [] };
}

module.exports = { parseForm };
