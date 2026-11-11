/*
 * End-to-end check, the real app on a real (local) website:
 *
 *   DM_SITE_URL=http://127.0.0.1:8000 DM_PUBLIC_KEY=... DM_CODE=DM-XXXX-XXXX-XXXX \
 *   DM_SHOTS=/tmp/shots xvfb-run -a npx electron --no-sandbox test/e2e.js
 *
 * Activates, chooses a level, opens lessons, plays a recording, answers an
 * activity, opens a page that needs the internet, and (with DM_SYNC_STEP set
 * to a command that builds a new release on the website) downloads new lessons.
 * Screenshots go to DM_SHOTS. Exits 0 when every step passed.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

process.env.DM_USER_DATA = process.env.DM_USER_DATA || fs.mkdtempSync(path.join(os.tmpdir(), "dm-e2e-"));
const { app, BrowserWindow } = require("electron");
app.disableHardwareAcceleration();          // virtual screens have no GPU
require("../src/main/main.js");

const shots = process.env.DM_SHOTS || path.join(os.tmpdir(), "dm-shots");
fs.mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];

function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

async function until(fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const value = await fn(); if (value) return value; } catch (error) { /* not yet */ }
    await sleep(200);
  }
  return null;
}

async function main() {
  const win = await until(() => BrowserWindow.getAllWindows()[0]);
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const shot = async (name) => fs.writeFileSync(path.join(shots, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  const go = async (address) => { await win.loadURL(`dm://app${address}`); await sleep(600); };
  const url = () => win.webContents.getURL();

  await until(() => url().includes("activate.html") && js("!document.getElementById('activate').hidden"));
  await shot("01-activate");
  check("activation screen shows before a code", url().includes("/_desktop/activate.html"));

  await go("/accounts/dashboard/");
  check("lessons stay locked without a code", url().includes("/_desktop/activate.html"));

  await js(`document.getElementById('code').value = 'dm-0000-0000-0000'; document.getElementById('activate').requestSubmit(); 1`);
  const wrong = await until(() => js("!document.getElementById('error').hidden && document.getElementById('error').textContent"));
  check("a wrong code is refused", wrong && /wasn't found/.test(wrong), wrong);

  await js(`document.getElementById('code').value = ${JSON.stringify(process.env.DM_CODE.toLowerCase())};
            document.getElementById('learner').value = 'Ada Obi'; document.getElementById('activate').requestSubmit(); 1`);
  const chooser = await until(() => js("!document.getElementById('level').hidden"));
  await shot("02-choose-level");
  check("a two-level code asks for the level", chooser);

  await js(`document.getElementById('level-choice').value = 'Level 1'; document.getElementById('level').requestSubmit(); 1`);
  await until(() => url().endsWith("/accounts/dashboard/"));
  await sleep(1200);
  await shot("03-home");
  const name = await js("document.body.innerText.includes('Ada') && !document.body.innerText.includes('DMLEARNER')");
  check("home page opens, with the learner's name", url().endsWith("/accounts/dashboard/") && name);
  const styled = await js(`(() => { let rules = 0; for (const sheet of document.styleSheets) { try { rules += sheet.cssRules.length; } catch (e) {} }
    const header = document.querySelector('header'); return rules + ' rules, header ' + (header ? getComputedStyle(header).position : 'none'); })()`);
  check("the site's styles load", parseInt(styled, 10) > 200, styled);

  await go("/echospell/level-1/group-1/spelling/");
  await sleep(800);
  await shot("04-card");
  const audio = await js(`(async () => {
    const el = document.querySelector('audio[src^="/_m/"]');
    if (!el) return 'no audio element';
    el.preload = 'auto'; el.load();
    for (let i = 0; i < 50 && !(el.duration > 0); i++) await new Promise(r => setTimeout(r, 100));
    return el.src + ' ' + el.duration;
  })()`);
  check("a recording plays from the computer", / [12](\.\d+)?$/.test(audio), audio);

  await go("/echospell/level-1/group-1/activities/fill-the-gaps/");
  const inputs = await js("document.querySelectorAll('form.activity-form input[name^=\"item-\"]:not([type=hidden])').length");
  check("an activity opens", inputs > 0, `${inputs} questions`);
  await js(`(() => { const answers = ['cat', 'hat', 'bug', 'map'];
    document.querySelectorAll('form.activity-form input[name^="item-"]:not([type=hidden])').forEach((el, i) => { el.value = answers[i] || ''; });
    document.querySelector('form.activity-form').submit(); return 1; })()`);
  await until(() => url().includes("dm-result="));
  await sleep(800);
  await shot("05-activity-result");
  const banner = await js("(document.querySelector('.dm-result') || {}).innerText || ''");
  check("the activity is marked on the computer", /3 out of 4 \(75%\)/.test(banner) && /passed/.test(banner), banner.split("\n")[0]);
  const marks = await js("document.querySelectorAll('.dm-feedback--ok').length + '/' + document.querySelectorAll('.dm-feedback--bad').length");
  check("each answer shows right or wrong", marks === "3/1", marks);

  await js("document.querySelector('.dm-fab').click(); 1");
  await sleep(800);
  await shot("06-panel");
  const panelText = await js("document.getElementById('dm-panel').innerText");
  check("the panel shows the level and progress", /Level 1/.test(panelText) && /1 activity tried, 1 passed/.test(panelText), panelText.replace(/\n/g, " | ").slice(0, 160));

  await go("/accounts/dashboard/");
  await sleep(600);
  const week = await js("document.querySelector('.kh-week__head p').innerText + ' | ' + document.querySelector('.px-hero__date').innerText");
  const day = new Date().toLocaleDateString("en-GB", { weekday: "long" });
  check("home shows today and this week's practice", /1 of 7 days practised/.test(week) && week.includes(day), week);

  await go("/tutor/");
  await shot("07-needs-internet");
  check("an online-only page says it needs the internet", await js("document.body.innerText.includes('This needs the internet')"));

  await go("/tricks/lessons/soft-th/");
  check("a redirect is followed", url().endsWith("/tricks/lessons/soft-th/word-bank/"), url());

  if (process.env.DM_SYNC_STEP) {
    execSync(process.env.DM_SYNC_STEP, { stdio: "inherit" });
    const status = await js("window.dmDesktop.checkNow()");
    check("new lessons download from the website", status.ready && status.release > 0, `${status.sync} release ${status.release}`);
    await go("/echospell/level-1/group-1/passage-reading/");
    const updated = await js("document.body.innerText.includes('UPDATED FROM THE WEBSITE')");
    await shot("08-after-sync");
    check("the changed lesson shows the new text", updated);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} of ${results.length} passed. Screenshots: ${shots}`);
  app.exit(failed.length ? 1 : 0);
}

app.whenReady().then(() => main().catch((error) => { console.error(error); app.exit(2); }));
