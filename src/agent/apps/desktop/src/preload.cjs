const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rakazoDesktop", {
  appsStudio: { request: input => ipcRenderer.invoke("desktop.apps.studio", input) },
  platform: process.platform,
  nativeWindowFrame: process.platform !== "darwin",
  projectRunner: {
    state: botId => ipcRenderer.invoke("desktop.projectRunner.state", botId),
    play: request => ipcRenderer.invoke("desktop.projectRunner.play", request),
    stop: botId => ipcRenderer.invoke("desktop.projectRunner.stop", botId),
  },
  preview: {
    show: request => ipcRenderer.invoke("desktop.preview.show", request),
    layout: request => ipcRenderer.invoke("desktop.preview.layout", request),
    command: request => ipcRenderer.invoke("desktop.preview.command", request),
    close: id => ipcRenderer.invoke("desktop.preview.close", id),
    onChanged: listener => {
      const handler = (_event, state) => listener(state);
      ipcRenderer.on("desktop.preview.changed", handler);
      return () => ipcRenderer.off("desktop.preview.changed", handler);
    },
  },
  runtime: {
    status: () => ipcRenderer.invoke("desktop.runtime.status"),
    identify: () => ipcRenderer.invoke("desktop.runtime.identify"),
    enroll: (bundle) => ipcRenderer.invoke("desktop.runtime.enroll", bundle),
  },
  badge: {
    set: (count) => ipcRenderer.invoke("desktop.badge.set", count),
  },
  computer: {
    managesHostChoice: true,
    requestAccess: () => ipcRenderer.invoke("desktop.computer.requestAccess"),
    revokeAccess: () => ipcRenderer.invoke("desktop.computer.revokeAccess"),
    connect: (botId) => ipcRenderer.invoke("desktop.computer.connect", botId),
    connected: (botId) => ipcRenderer.invoke("desktop.computer.connected", botId),
    chooseProject: (botId) => ipcRenderer.invoke("desktop.computer.chooseProject", botId),
    project: (botId) => ipcRenderer.invoke("desktop.computer.project", botId),
    projectAvailable: () => ipcRenderer.invoke("desktop.computer.projectAvailable"),
    onConfigure: (listener) => {
      const handler = () => listener();
      ipcRenderer.on("desktop.computer.configure", handler);
      return () => ipcRenderer.off("desktop.computer.configure", handler);
    },
  },
  passkeys: {
    rpIds: () => ipcRenderer.invoke("desktop.passkeys.rpIds"),
  },
  window: {
    close: () => ipcRenderer.invoke("desktop.window.close"),
    minimize: () => ipcRenderer.invoke("desktop.window.minimize"),
    toggleMaximize: () => ipcRenderer.invoke("desktop.window.toggleMaximize"),
    state: () => ipcRenderer.invoke("desktop.window.state"),
  },
  update: {
    state: () => ipcRenderer.invoke("desktop.update.state"),
    check: () => ipcRenderer.invoke("desktop.update.check"),
    download: () => ipcRenderer.invoke("desktop.update.download"),
    install: () => ipcRenderer.invoke("desktop.update.install"),
  },
  oauth: {
    open: (url) => ipcRenderer.invoke("desktop.oauth.open", url),
    cancel: (url) => ipcRenderer.invoke("desktop.oauth.cancel", url),
    onCallback: (listener) => {
      // The IpcRendererEvent stays in the preload: the renderer only sees the code.
      const handler = (_event, callback) => listener(callback);
      ipcRenderer.on("desktop.oauth.callback", handler);
      return () => ipcRenderer.off("desktop.oauth.callback", handler);
    },
  },
});
