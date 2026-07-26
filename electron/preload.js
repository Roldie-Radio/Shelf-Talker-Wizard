const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('shelfTalker', {
  // Prints via the main process (see main.js) instead of the renderer's
  // window.print(), which doesn't reliably apply our page size/background
  // settings when running inside Electron.
  print: () => ipcRenderer.invoke('print-sheets'),

  // File menu "Open Queue…"/"Save Queue" (see main.js): native dialogs live
  // in the main process, but only the renderer has the live queue to save
  // or the logic to apply an opened one, hence this round trip.
  onSaveRequested: (callback) => ipcRenderer.on('queue:save-requested', () => callback()),
  saveQueueToFile: (payload) => ipcRenderer.invoke('queue:save', payload),
  onQueueOpened: (callback) => ipcRenderer.on('queue:opened', (_event, queue) => callback(queue)),

  // Help menu "Help" (see main.js) - opens the same in-app panel the app
  // bar's own Help button does, rather than a separate window.
  onShowHelpRequested: (callback) => ipcRenderer.on('help:show-requested', () => callback()),
});
