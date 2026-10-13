const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('reportgenConnection', {
  get: () => ipcRenderer.invoke('connection:get'),
  getServiceStatus: () => ipcRenderer.invoke('connection:service-status'),
  saveAndRestart: (config) => ipcRenderer.invoke('connection:save-and-restart', config),
  cancel: () => ipcRenderer.invoke('connection:cancel')
});
