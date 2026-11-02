const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('rakazoDesktop', {
  platform: process.platform, nativeWindowFrame: process.platform !== 'darwin',
  development: {
    isDevelopment: true,
    state: () => ipcRenderer.invoke('desktop.development.state'),
    connect: (botId) => ipcRenderer.invoke('desktop.development.connect',botId),
  },
  window: {
    close: () => ipcRenderer.invoke('desktop.window.close'),
    minimize: () => ipcRenderer.invoke('desktop.window.minimize'),
    toggleMaximize: () => ipcRenderer.invoke('desktop.window.toggleMaximize'),
    state: () => ipcRenderer.invoke('desktop.window.state'),
  },
});
