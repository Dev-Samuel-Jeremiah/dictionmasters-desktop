/*
 * Added to every lesson page in the computer app (server.js):
 *   - the app's own button and panel (bottom right): the learner, their
 *     level, new lessons, their progress, the code
 *   - an activity's result, shown on the activity page after it's marked
 *   - links to other websites open in the computer's browser (main.js)
 * window.DM_DESKTOP is set by server.js; window.dmDesktop by preload.js.
 */
(function () {
  "use strict";
  var info = window.DM_DESKTOP || {};
  var api = window.dmDesktop;

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      if (key === "text") node.textContent = attrs[key];
      else if (key === "class") node.className = attrs[key];
      else node.setAttribute(key, attrs[key]);
    });
    (children || []).forEach(function (child) { if (child) node.appendChild(child); });
    return node;
  }

  function toast(text) {
    var box = el("div", { class: "dm-toast", role: "status", text: text });
    document.body.appendChild(box);
    setTimeout(function () { box.remove(); }, 4000);
  }

  // ------------------------------------------------------- an activity's result
  function showResult(result) {
    var form = document.querySelector("form.activity-form") || document.querySelector("form[method=post], form[method=POST]");
    if (!form || !result) return;
    var marked = result.status === "marked";
    var banner = el("div", { class: "dm-result" + (result.passed ? " dm-result--passed" : ""), role: "status" }, [
      el("strong", { text: marked ? "You scored " + result.score + " out of " + result.max + " (" + result.percent + "%)" : "Your recording is saved" }),
      el("span", { text: marked
        ? (result.passed ? "Well done, you passed! " : "The pass mark is " + result.pass_mark + "%. Have another go. ") + "Your answers are marked below."
        : "Your teacher can listen to it on this computer." }),
    ]);
    form.parentNode.insertBefore(banner, form);
    var unplaced = el("ol");
    result.rows.forEach(function (row) {
      var holder = document.querySelector('[data-item-id="' + row.id + '"]:not(button)');
      var first = document.querySelector('[name="item-' + row.id + '"]');
      if (!holder && first && first.type !== "hidden") holder = first.closest("li, fieldset, .activity-item, label, div");
      var inputs = document.querySelectorAll('[name="item-' + row.id + '"]');
      Array.prototype.forEach.call(inputs, function (input) {
        if (input.type === "checkbox" || input.type === "radio") {
          var given = row.given.split(",").map(function (v) { return v.trim(); });
          input.checked = given.indexOf(input.value) !== -1;
        } else if (input.type !== "hidden") {
          input.value = row.given;
        }
      });
      var kind = row.correct === null ? "wait" : row.correct ? "ok" : "bad";
      var note = el("span", { class: "dm-feedback dm-feedback--" + kind, text: (row.correct ? "✓ " : row.correct === false ? "✗ " : "") + row.feedback });
      if (holder) holder.appendChild(note); else unplaced.appendChild(el("li", {}, [note]));
    });
    if (unplaced.children.length) banner.appendChild(unplaced);
    banner.scrollIntoView({ block: "center" });
  }

  // ---------------------------------------------------------------- the panel
  function panel() {
    var initial = (info.learner || "L").trim().charAt(0).toUpperCase() || "L";
    var dot = el("span", { class: "dm-fab__new", hidden: "" });
    var fab = el("button", { type: "button", class: "dm-fab", "aria-expanded": "false", "aria-controls": "dm-panel" }, [
      el("span", { class: "dm-fab__dot", "aria-hidden": "true", text: initial }),
      el("span", { text: info.learner ? info.learner.split(" ")[0] : "Diction Masters" }),
      dot,
    ]);
    var box = el("div", { class: "dm-panel", id: "dm-panel", hidden: "", role: "dialog", "aria-label": "Diction Masters on this computer" });
    document.body.appendChild(box);
    document.body.appendChild(fab);

    function render(status) {
      box.innerHTML = "";
      box.appendChild(el("h2", { text: info.learner || "Diction Masters" }));
      box.appendChild(el("small", { text: (status.holder || "") + (status.until ? " · code ends " + status.until : "") }));

      if ((info.levels || []).length > 1) {
        var select = el("select", { id: "dm-level" });
        info.levels.forEach(function (level) {
          var option = el("option", { value: level, text: level });
          if (level === info.level) option.selected = true;
          select.appendChild(option);
        });
        select.addEventListener("change", function () { api.setLevel(select.value).then(function (home) { location.href = home; }); });
        box.appendChild(el("section", {}, [el("label", { for: "dm-level", text: "My level" }), select]));
      } else if (info.level) {
        box.appendChild(el("section", {}, [el("label", { text: "My level" }), el("span", { text: info.level })]));
      }

      var sync = el("div", { class: "dm-status", text: status.sync || "" });
      var check = el("button", { type: "button", class: "dm-btn", text: status.ready ? "Open the new lessons" : "Check for new lessons" });
      check.addEventListener("click", function () {
        if (status.ready) { location.reload(); return; }
        sync.textContent = "Checking…";
        api.checkNow().then(function (s) { status = s; render(s); });
      });
      box.appendChild(el("section", {}, [el("label", { text: "Lessons" }),
        el("span", { text: "Release " + (status.release || info.release || 0) + (status.lessonsDate ? " · " + status.lessonsDate : "") }), sync, check]));

      var progress = el("ul");
      (status.progress && status.progress.recent || []).slice(0, 5).forEach(function (a) {
        progress.appendChild(el("li", {}, [el("a", { href: a.p, text: a.title }), document.createTextNode(" — " + a.percent + "%" + (a.passed ? " ✓" : ""))]));
      });
      var tried = status.progress ? status.progress.activities : 0;
      var summary = status.progress ? tried + (tried === 1 ? " activity" : " activities") + " tried, " + status.progress.passed + " passed" : "";
      box.appendChild(el("section", {}, [el("label", { text: "My progress" }), el("span", { text: summary }), progress]));

      var name = el("input", { id: "dm-name", value: info.learner || "", maxlength: "60" });
      var save = el("button", { type: "button", class: "dm-btn dm-btn--quiet", text: "Save name" });
      save.addEventListener("click", function () { api.setLearner(name.value).then(function () { location.reload(); }); });
      box.appendChild(el("section", {}, [el("label", { for: "dm-name", text: "Learner's name" }), name, save]));

      var about = el("button", { type: "button", class: "dm-btn dm-btn--quiet", text: "Code and computer…" });
      about.addEventListener("click", function () { location.href = "/_desktop/activate.html?manage=1"; });
      box.appendChild(el("section", {}, [el("small", { text: "Code " + (status.code || "") + " · app " + (status.appVersion || "") }), el("br"), about]));
    }

    fab.addEventListener("click", function () {
      var open = box.hidden;
      box.hidden = !open;
      fab.setAttribute("aria-expanded", String(open));
      if (open) api.status().then(render);
    });
    document.addEventListener("keydown", function (event) { if (event.key === "Escape") box.hidden = true; });
    if (api.onSync) api.onSync(function (status) {
      dot.hidden = !status.ready;
      if (status.ready && status.announce) toast("New lessons are ready. They open the next time you change page.");
    });
  }

  // The pages were made for a placeholder pupil: their initial ("D") becomes the learner's.
  function initials() {
    var letter = (info.learner || "").trim().charAt(0).toUpperCase();
    if (!letter) return;
    Array.prototype.forEach.call(document.querySelectorAll(".px-avatar, .account-menu__avatar, .px-switch__face--a"), function (node) {
      if (node.textContent.trim() === "D") node.textContent = letter;
    });
  }

  // The home page was made when the lessons were exported: today's date,
  // the greeting and "My week" are put right from this computer's clock
  // and what the learner has done here.
  function today() {
    var now = new Date();
    var date = document.querySelector(".px-hero__date");
    if (date && date.firstChild && date.firstChild.nodeType === 3) {
      date.firstChild.textContent = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }).replace(",", "");
    }
    var hour = now.getHours();
    var greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
    Array.prototype.forEach.call(document.querySelectorAll(".lh-hero__title"), function (title) {
      var text = title.firstChild;
      if (text && text.nodeType === 3) text.textContent = text.textContent.replace(/Good (morning|afternoon|evening)/, greeting);
    });
    var week = info.week;
    var days = document.querySelectorAll(".kh-days .kh-day");
    if (!week || days.length !== 7) return;
    var index = (now.getDay() + 6) % 7;
    var done = 0;
    Array.prototype.forEach.call(days, function (day, i) {
      day.classList.toggle("is-done", week[i]);
      day.classList.toggle("is-today", i === index);
      day.classList.toggle("is-later", i > index);
      if (week[i]) done += 1;
      var dot = day.querySelector(".kh-day__dot");
      if (dot) dot.textContent = week[i] ? "✓" : i === index ? "★" : "";
      var label = day.querySelector(".kh-sr");
      if (label) label.textContent = label.textContent.replace(/: .*$/, ": " + (week[i] ? "practised" : i > index ? "still to come" : "not yet"));
    });
    var line = document.querySelector(".kh-week__head p");
    if (line) {
      line.innerHTML = "";
      if (week[index]) line.appendChild(el("b", { text: "Great work today! " }));
      line.appendChild(document.createTextNode(done + " of 7 days practised" + (week[index] ? "." : ". Play today to light up a star!")));
    }
  }

  function start() {
    initials();
    today();
    if (info.result) showResult(info.result);
    if (api) panel();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
