const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rakazoDesktop", {
  platform: process.platform,
  nativeWindowFrame: true,
  quickAsk: {
    shortcut: "CommandOrControl+Shift+Space",
    close: () => ipcRenderer.invoke("desktop.quickAsk.close"),
    sent: (conversationPath) => ipcRenderer.invoke("desktop.quickAsk.sent", conversationPath),
  },
});
