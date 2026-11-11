const { contextBridge, ipcRenderer } = require("electron");
const spaceId = process.argv.find(value => value.startsWith("--mycellios-chat-space="))?.split("=")[1];
if (!spaceId || !/^[a-zA-Z0-9_-]{1,160}$/.test(spaceId)) throw new Error("Missing floating chat Space");

contextBridge.exposeInMainWorld("rakazoDesktop", {
  platform: process.platform,
  nativeWindowFrame: true,
  chatWindow: {
    kind: "floating",
    spaceId,
    returnToMain: () => ipcRenderer.invoke("desktop.chat.return"),
    onPrepare: listener => {
      const handler = async (_event, nonce) => {
        if (typeof nonce !== "string" || !/^[a-f0-9]{32}$/.test(nonce)) return;
        let ready = false;
        try { ready = await listener() === true; } catch { /* Keep unsaved work open. */ }
        ipcRenderer.send("desktop.update.prepared", { nonce, ready });
      };
      ipcRenderer.on("desktop.update.prepare", handler);
      return () => ipcRenderer.off("desktop.update.prepare", handler);
    },
  },
});
