const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("companion", {
  onState: listener => { ipcRenderer.on("companion.state", (_event, value) => listener(value)); },
  onHover: listener => { ipcRenderer.on("companion.hover", (_event, value) => listener(value === true)); },
  select: id => { if (typeof id === "string" && id.length <= 128) ipcRenderer.send("companion.select", id); },
});
