const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('reportgenSetup', {
  get: () => ipcRenderer.invoke('setup:get'),
  save: (settings) => ipcRenderer.invoke('setup:save', settings),
  configureNetwork: () => ipcRenderer.invoke('setup:network'),
  generateCertificates: (password) => ipcRenderer.invoke('setup:certificates', password),
  installService: () => ipcRenderer.invoke('setup:service'),
  finish: () => ipcRenderer.invoke('setup:finish'),
  cancel: () => ipcRenderer.invoke('setup:cancel')
});
