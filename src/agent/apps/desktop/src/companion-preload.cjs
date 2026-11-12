const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("companion", {
  onState: listener => { ipcRenderer.on("companion.state", (_event, value) => listener(value)); },
  onHover: listener => { ipcRenderer.on("companion.hover", (_event, value) => listener(value === true)); },
  expand: open => { if (typeof open === "boolean") ipcRenderer.send("companion.expand", open); },
  openQuestion: id => { if (typeof id === "string" && id.length <= 384) ipcRenderer.send("companion.question.open", id); },
  answer: reply => ipcRenderer.invoke("companion.answer", reply),
  dragDock: phase => { if (["start", "move", "end", "cancel", "previous", "next"].includes(phase)) ipcRenderer.send("companion.dock.drag", phase); },
  onDockSaved: listener => { ipcRenderer.on("companion.dock.saved", (_event, ok) => listener(ok === true)); },
  select: id => { if (typeof id === "string" && id.length <= 128) ipcRenderer.send("companion.select", id); },
});
