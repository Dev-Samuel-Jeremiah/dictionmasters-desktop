/*
 * window.dmDesktop on the app's own pages (dm://app/), for the activation
 * screen and the panel on every lesson page (src/ui). Nothing else is
 * exposed to pages.
 */
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

if (location.protocol === "dm:") {
  contextBridge.exposeInMainWorld("dmDesktop", {
    status: () => ipcRenderer.invoke("dm:status"),
    activate: (code, learner) => ipcRenderer.invoke("dm:activate", { code, learner }),
    setLevel: (level) => ipcRenderer.invoke("dm:set-level", level),
    setLearner: (name) => ipcRenderer.invoke("dm:set-learner", name),
    checkNow: () => ipcRenderer.invoke("dm:check-now"),
    deactivate: () => ipcRenderer.invoke("dm:deactivate"),
    loadVideos: () => ipcRenderer.invoke("dm:load-videos"),
    onSync: (listener) => ipcRenderer.on("dm:sync", (_event, status) => listener(status)),
  });
}
