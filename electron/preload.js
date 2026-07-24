const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('shelfTalker', {
  // Prints via the main process (see main.js) instead of the renderer's
  // window.print(), which doesn't reliably apply our page size/background
  // settings when running inside Electron.
  print: () => ipcRenderer.invoke('print-sheets'),
});
