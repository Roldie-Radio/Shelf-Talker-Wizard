const { contextBridge, ipcRenderer } = require('electron');

// The menu bar itself lives in the renderer now (see the "Menu bar" section
// of public/js/app.js) - everything below just backs the handful of its
// items that need real main-process/OS access (native dialogs, DevTools,
// checking for updates, the About dialog's app version, quitting). Items
// that only open an in-page modal (Help, What's New, Beer Talker Info,
// Settings, Find Queue, and the Advanced panel dialogs) don't go through
// this bridge at all - the renderer just calls their modal's open()
// directly, since it owns the menu that triggers them now too.
contextBridge.exposeInMainWorld('shelfTalker', {
  // Prints via the main process (see main.js) instead of the renderer's
  // window.print(), which doesn't reliably apply our page size/background
  // settings when running inside Electron.
  print: () => ipcRenderer.invoke('print-sheets'),

  // File > Open Queue…/Save Queue (see main.js): native dialogs live in the
  // main process, but only the renderer has the live queue to save or the
  // logic to apply an opened one.
  openQueueFile: () => ipcRenderer.invoke('queue:open-file'),
  onQueueOpened: (callback) => ipcRenderer.on('queue:opened', (_event, queue) => callback(queue)),
  saveQueueToFile: (payload) => ipcRenderer.invoke('queue:save', payload),

  // File > Exit.
  quitApp: () => ipcRenderer.invoke('app:quit'),

  // Help > Check for Updates…/About Shelf Talker Wizard - both need the
  // main process (autoUpdater / app.getVersion()).
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  showAbout: () => ipcRenderer.invoke('app:about'),

  // Advanced > Toggle Developer Tools - only the main process can toggle
  // DevTools on the window.
  toggleDevTools: () => ipcRenderer.invoke('devtools:toggle'),

  // Scan UPC tab's Settings "Browse..." button (see main.js) - only present
  // here, so app.js only shows that button when this bridge exists; the
  // plain browser dev copy has no native file dialog and just falls back to
  // typing/pasting the path instead.
  pickUpcExportFile: () => ipcRenderer.invoke('upc-export:pick-file'),

  // Advanced > Import Beer Bible from Export File...'s own "Browse..."
  // button - same reasoning as pickUpcExportFile above.
  pickBeerBibleImportFile: () => ipcRenderer.invoke('beer-bible-import:pick-file'),
});
