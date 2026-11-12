const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rakazoDesktop", {
  appsStudio: { request: input => ipcRenderer.invoke("desktop.apps.studio", input) },
  servers: { list: () => ipcRenderer.invoke("desktop.servers.list"), manage: url => ipcRenderer.invoke("desktop.servers.manage", url) },
  platform: process.platform,
  settings: {
    fonts: () => ipcRenderer.invoke("desktop.settings.fonts"),
    logo: png => ipcRenderer.invoke("desktop.settings.logo", png),
    state: () => ipcRenderer.invoke("desktop.settings.state"),
    update: patch => ipcRenderer.invoke("desktop.settings.update", patch),
  },
  companions: {
    state: () => ipcRenderer.invoke("desktop.companions.state"),
    save: value => ipcRenderer.invoke("desktop.companions.save", value),
    displays: () => ipcRenderer.invoke("desktop.companions.displays"),
    publish: value => ipcRenderer.invoke("desktop.companions.publish", value),
    openChat: target => ipcRenderer.invoke("desktop.companions.openChat", target),
    onSelect: listener => {
      const handler = (_event, target) => listener(target);
      ipcRenderer.on("desktop.companions.select", handler);
      return () => ipcRenderer.off("desktop.companions.select", handler);
    },
  },
  localVoice: {
    status: () => ipcRenderer.invoke("desktop.localVoice.status"),
    prepare: () => ipcRenderer.invoke("desktop.localVoice.prepare"),
    prepareModel: kind => ipcRenderer.invoke("desktop.localVoice.prepareModel", kind),
    removeModel: kind => ipcRenderer.invoke("desktop.localVoice.removeModel", kind),
    transcribe: samples => ipcRenderer.invoke("desktop.localVoice.transcribe", samples),
    speak: input => ipcRenderer.invoke("desktop.localVoice.speak", input),
    stop: () => ipcRenderer.invoke("desktop.localVoice.stop"),
  },

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
  notifications: {
    clear: () => ipcRenderer.invoke("desktop.notifications.clear"),
    status: () => ipcRenderer.invoke("desktop.notifications.status"),
    show: input => ipcRenderer.invoke("desktop.notifications.show", input),
    openSettings: () => ipcRenderer.invoke("desktop.notifications.settings"),
    onOpen: listener => {
      const handler = (_event, url) => listener(url);
      ipcRenderer.on("desktop.notifications.open", handler);
      return () => ipcRenderer.off("desktop.notifications.open", handler);
    },
  },
  computer: {
    prepareTask: request => ipcRenderer.invoke("desktop.computer.prepareTask", request),
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
    preferences: () => ipcRenderer.invoke("desktop.update.preferences"),
    savePreferences: patch => ipcRenderer.invoke("desktop.update.savePreferences", patch),
    restartWhenIdle: () => ipcRenderer.invoke("desktop.update.restartWhenIdle"),
    cancelRestart: () => ipcRenderer.invoke("desktop.update.cancelRestart"),
    state: () => ipcRenderer.invoke("desktop.update.state"),
    check: () => ipcRenderer.invoke("desktop.update.check"),
    download: () => ipcRenderer.invoke("desktop.update.download"),
    install: () => ipcRenderer.invoke("desktop.update.install"),
    cancelInstall: () => ipcRenderer.invoke("desktop.update.cancelInstall"),
    forceInstall: () => ipcRenderer.invoke("desktop.update.forceInstall"),
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
