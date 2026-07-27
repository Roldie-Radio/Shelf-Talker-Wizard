const { contextBridge, ipcRenderer } = require('electron');

// Same isolated-bridge pattern as preload.js: the progress window's own
// page never gets direct ipcRenderer access, just this one narrow channel.
contextBridge.exposeInMainWorld('updateAPI', {
  onProgress: (callback) => ipcRenderer.on('update-progress-data', (_event, data) => callback(data)),
});
