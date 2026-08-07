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

  // Scan UPC tab's Settings "Browse..." button (see main.js) - only present
  // here, so app.js only shows that button when this bridge exists; the
  // plain browser dev copy has no native file dialog and just falls back to
  // typing/pasting the path instead.
  pickUpcExportFile: () => ipcRenderer.invoke('upc-export:pick-file'),

  // Advanced menu's "Export File Settings...", "View Export File...", "View
  // Database...", and "Server PC..." (see main.js) - each just opens the
  // matching in-app panel, same pattern as onShowHelpRequested above.
  // Electron-only: the plain browser dev copy has no menu to trigger these
  // from at all (though the Export File Settings panel itself is also
  // reachable there via the Scan UPC tab's own fallback - see app.js).
  onExportSettingsRequested: (callback) => ipcRenderer.on('export-settings-requested', () => callback()),
  onViewExportRequested: (callback) => ipcRenderer.on('view-export-requested', () => callback()),
  onViewDatabaseRequested: (callback) => ipcRenderer.on('view-database-requested', () => callback()),
  onServerPcRequested: (callback) => ipcRenderer.on('server-pc-requested', () => callback()),
});
