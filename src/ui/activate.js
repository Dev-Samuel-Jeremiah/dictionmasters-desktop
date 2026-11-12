/* The activation screen (activate.html). window.dmDesktop comes from preload.js. */
(function () {
  "use strict";
  var api = window.dmDesktop;
  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);

  function show(id) {
    ["activate", "level", "manage"].forEach(function (name) { $(name).hidden = name !== id; });
  }

  function chooseLevel(status) {
    var select = $("level-choice");
    select.innerHTML = "";
    status.levels.forEach(function (level) {
      var option = document.createElement("option");
      option.value = option.textContent = level;
      if (level === status.level) option.selected = true;
      select.appendChild(option);
    });
    show("level");
  }

  function manage(status) {
    var rows = [["This computer's number", status.computer], ["Code", status.code], ["For", status.holder], ["Levels", (status.levels || []).join(", ")],
      ["Ends", status.until || "No end date"], ["Lessons", "Release " + status.release + (status.lessonsDate ? " (" + status.lessonsDate + ")" : "")],
      ["App", status.appVersion], ["This computer", status.deviceName]];
    $("details").innerHTML = "";
    rows.forEach(function (row) {
      var dt = document.createElement("dt"); dt.textContent = row[0];
      var dd = document.createElement("dd"); dd.textContent = row[1] || "—";
      $("details").appendChild(dt); $("details").appendChild(dd);
    });
    show("manage");
  }

  $("activate").addEventListener("submit", function (event) {
    event.preventDefault();
    $("error").hidden = true;
    $("go").disabled = true;
    $("go").textContent = "Checking your code…";
    api.activate($("code").value, $("learner").value).then(function (answer) {
      $("go").disabled = false;
      $("go").textContent = "Unlock";
      if (!answer.ok) { $("error").textContent = answer.error; $("error").hidden = false; return; }
      if (answer.status.levels.length > 1) chooseLevel(answer.status);
      else location.href = answer.status.home;
    });
  });

  $("level").addEventListener("submit", function (event) {
    event.preventDefault();
    api.setLevel($("level-choice").value).then(function (home) { location.href = home; });
  });

  $("back").addEventListener("click", function () { api.status().then(function (s) { location.href = s.home; }); });
  $("videos").addEventListener("click", function () { api.loadVideos(); });
  $("copy").addEventListener("click", function () {
    var number = $("computer").textContent;
    var done = function () { $("copy").textContent = "Copied ✓"; setTimeout(function () { $("copy").textContent = "Copy the number"; }, 2000); };
    if (navigator.clipboard) navigator.clipboard.writeText(number).then(done, function () {});
  });
  $("remove").addEventListener("click", function () {
    if (!confirm("Type a different code on this computer? The lessons stay; the new code decides which levels open.")) return;
    api.deactivate().then(function () { location.href = "/_desktop/activate.html"; });
  });

  api.status().then(function (status) {
    $("learner").value = status.learner || "";
    $("computer").textContent = status.computer || "—";
    if (status.contact) $("contact").textContent = " (" + status.contact + ")";
    if (status.ok && params.get("manage")) return manage(status);
    if (status.ok && params.get("level")) return chooseLevel(status);
    if (status.ok) { location.href = status.home; return; }
    if (status.message) { $("error").textContent = status.message; $("error").hidden = false; }
    if (status.reason === "recheck") $("lead").textContent = "Connect this computer to the internet once, then type your code again to carry on.";
    if (status.code) $("code").value = status.code;
    show("activate");
    $("code").focus();
  });
})();
