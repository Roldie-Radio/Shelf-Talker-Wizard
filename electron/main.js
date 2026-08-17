const path = require('path');
const fs = require('fs/promises');
const { app, BrowserWindow, Menu, shell, ipcMain, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const { start } = require('../server/index.js');
const { closeDb } = require('../server/db.js');

// Fixed local port: this app only ever talks to itself on the same PC.
const PORT = 17321;

let mainWindow = null;
let httpServer = null;
let progressWindow = null;
let lastProgressData = null;

// Only true while a check was started from the "Check for Updates…" menu
// item - lets the shared autoUpdater event handlers below decide whether to
// bother the user with "you're already up to date" dialogs. A silent
// background check on launch should never interrupt someone with a dialog
// just to say nothing was wrong; someone who asked directly should always
// get an answer either way. Unlike that dialog, a failure is always worth
// surfacing once a download has actually started (see downloadInProgress
// below) - staff watching a progress window deserves to know if it stalls,
// regardless of what triggered the check that started it.
let manualCheckInProgress = false;
let downloadInProgress = false;

// A small always-on-top window showing live download progress - a user
// reported seeing the one-line "downloading now" message and then nothing
// else, with no way to tell whether it was still working or had silently
// failed. Kept separate from the main app window/renderer entirely (its own
// tiny HTML file + preload) since this is purely an Electron-shell concern,
// the same reasoning that already keeps this file's other native-dialog
// flows out of public/.
function createProgressWindow(version) {
  if (progressWindow) return progressWindow;
  progressWindow = new BrowserWindow({
    width: 420,
    height: 210,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    parent: mainWindow || undefined,
    title: 'Shelf Talker Wizard Update',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'updateProgressPreload.js'),
    },
  });
  progressWindow.setMenuBarVisibility(false);
  progressWindow.loadFile(path.join(__dirname, 'updateProgress.html'));
  lastProgressData = { percent: 0, transferredMB: '0.0', totalMB: '0.0', speedMB: '0.0', version };
  progressWindow.webContents.on('did-finish-load', () => {
    if (progressWindow) progressWindow.webContents.send('update-progress-data', lastProgressData);
  });
  progressWindow.on('closed', () => { progressWindow = null; });
  return progressWindow;
}

function sendProgress(data) {
  lastProgressData = { ...lastProgressData, ...data };
  if (progressWindow) progressWindow.webContents.send('update-progress-data', lastProgressData);
}

function closeProgressWindow() {
  if (progressWindow) progressWindow.close();
  progressWindow = null;
  lastProgressData = null;
}

// electron-updater reads its own update feed config from app-update.yml,
// which electron-builder only writes into a packaged build (see
// build.publish in package.json) - calling any of this against an unpacked
// dev copy throws immediately, so the whole feature stays off there.
function setupAutoUpdater() {
  autoUpdater.autoInstallOnAppQuit = true;
  // Routes electron-updater's own internal logging (feed URL, HTTP status,
  // parsed latest.yml, etc.) into electron-log's file transport, not just
  // the handful of events we already react to below - this is what lets
  // someone actually diagnose an update that fails on a single machine
  // without remote desktop, by pulling this file instead. Defaults to
  // %LOCALAPPDATA%\Shelf Talker Wizard\logs\main.log on Windows.
  autoUpdater.logger = log;
  log.transports.file.level = 'info';
  log.info(`[updater] initialized, current version ${app.getVersion()}, log file: ${log.transports.file.getFile().path}`);

  autoUpdater.on('error', (err) => {
    log.error('[updater] error', err);
    const wasDownloading = downloadInProgress;
    downloadInProgress = false;
    closeProgressWindow();
    // A failure before any download started (e.g. can't reach the update
    // feed at all) only needs to interrupt someone who went looking for it;
    // a failure after the progress window was already showing always does,
    // or "downloading now" would be the last thing anyone ever saw.
    if (manualCheckInProgress || wasDownloading) {
      dialog.showErrorBox('Update failed', err.message);
    }
    manualCheckInProgress = false;
  });

  // Always opens the progress window, not just for a manual check - the
  // whole point is confirming a background-triggered download is actually
  // happening instead of leaving it invisible until (or unless) it finishes.
  autoUpdater.on('update-available', (info) => {
    log.info(`[updater] update available: ${info.version}`);
    manualCheckInProgress = false;
    downloadInProgress = true;
    createProgressWindow(info.version);
  });

  autoUpdater.on('download-progress', (progress) => {
    sendProgress({
      percent: progress.percent,
      transferredMB: (progress.transferred / 1e6).toFixed(1),
      totalMB: (progress.total / 1e6).toFixed(1),
      speedMB: (progress.bytesPerSecond / 1e6).toFixed(2),
    });
  });

  autoUpdater.on('update-not-available', () => {
    log.info('[updater] no update available');
    if (manualCheckInProgress) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'No Updates Available',
        message: `You're already running the latest version (${app.getVersion()}).`,
      });
    }
    manualCheckInProgress = false;
  });

  // Fires regardless of whether the check that found it was silent or
  // manual - an update sitting downloaded and ready is always worth
  // surfacing, not just when someone happened to go looking for it.
  autoUpdater.on('update-downloaded', (info) => {
    log.info(`[updater] update downloaded: ${info.version}`);
    downloadInProgress = false;
    closeProgressWindow();
    dialog
      .showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update Ready',
        message: `Version ${info.version} has been downloaded.`,
        detail: 'Restart now to install it, or it will install automatically the next time '
          + 'the app is closed.',
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall();
      });
  });
}

function handleCheckForUpdates() {
  if (!app.isPackaged) {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Check for Updates',
      message: 'Automatic updates are only available in the installed app, not this development copy.',
    });
    return;
  }
  manualCheckInProgress = true;
  log.info('[updater] manual check triggered');
  // Swallow the promise rejection here - the 'error' event above is the
  // single source of truth for reporting a failed check, so this doesn't
  // also show its own dialog for the same failure.
  autoUpdater.checkForUpdates().catch(() => {});
}

// The menu bar itself is now built in the renderer (see the "Menu bar"
// section of public/js/app.js), not here - this file just backs the
// handful of its items that genuinely need main-process/OS access, each
// exposed to the renderer as an ipcMain.handle below and called through
// electron/preload.js. Items that only open an in-page modal (Help, What's
// New, Beer Talker Info, Settings, Find Queue, and the three Advanced
// panel dialogs) don't need any of this anymore - the renderer just opens
// them directly, since it owns the menu that triggers them now too.

function showAboutDialog() {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'About Shelf Talker Wizard',
    message: 'Shelf Talker Wizard',
    detail: `Version ${app.getVersion()}\nLiquor Outlet Wine Cellars`,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    buttons: ['OK'],
  });
}
ipcMain.handle('app:about', showAboutDialog);

ipcMain.handle('app:quit', () => app.quit());

ipcMain.handle('devtools:toggle', () => {
  if (mainWindow) mainWindow.webContents.toggleDevTools();
});

ipcMain.handle('updates:check', () => handleCheckForUpdates());

// File > Open Queue… - loads a previously saved queue file (see the "Save
// Queue" export format in app.js: { app, exportedAt, queue }) and hands the
// queue array off to the renderer, which owns actually applying it - this
// only knows how to read/validate the file, not how to render a queue.
ipcMain.handle('queue:open-file', async () => {
  if (!mainWindow) return;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Shelf Talker Queue',
    filters: [{ name: 'Shelf Talker Queue', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths[0]) return;
  try {
    const raw = await fs.readFile(result.filePaths[0], 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.queue)) {
      throw new Error('This file does not contain a valid Shelf Talker Wizard queue.');
    }
    mainWindow.webContents.send('queue:opened', parsed.queue);
  } catch (err) {
    dialog.showErrorBox('Could not open queue', err.message);
  }
});

// File > Save Queue (Electron path only - see runMenuAction's 'save-queue'
// case in app.js, which falls back to a plain browser download outside
// Electron) - the live queue only exists in the renderer, so it builds the
// export payload and passes it here for the native save dialog + write.
ipcMain.handle('queue:save', async (_event, payload) => {
  if (!mainWindow) return { success: false };
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Shelf Talker Queue',
    defaultPath: `shelf-talker-queue-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'Shelf Talker Queue', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) return { success: false };
  await fs.writeFile(result.filePath, JSON.stringify(payload, null, 2), 'utf-8');
  return { success: true, filePath: result.filePath };
});

// Native "Browse..." for the Scan UPC tab's Settings box (see preload.js /
// public/js/app.js) - only the main process can show OS file dialogs, so
// the renderer asks for a path this way rather than the plain browser dev
// copy, which has no equivalent and just falls back to typing the path in.
ipcMain.handle('upc-export:pick-file', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select WinePOS Export File',
    filters: [
      { name: 'Product Export', extensions: ['csv', 'tsv', 'txt'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return result.filePaths[0];
});

// Same "Browse..." pattern as upc-export:pick-file above, for the Advanced
// menu's "Import Beer Bible from Export File..." dialog (see
// beerBibleImport.js/app.js) - also accepts .xlsx/.xlsm, since a WinePOS
// export is often a plain Excel workbook rather than CSV/TSV.
ipcMain.handle('beer-bible-import:pick-file', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Beer Product Export File',
    filters: [
      { name: 'Product Export', extensions: ['csv', 'tsv', 'txt', 'xlsx', 'xlsm'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return result.filePaths[0];
});

// Electron's default print (triggered by the renderer calling window.print())
// doesn't reliably honor our @page CSS (landscape Letter) or print background
// colors, which was causing print failures / blank-looking output. Printing
// through the main process fixes that, but forcing an exact custom pageSize
// + margins here (in microns) turned out to be rejected outright by some
// real printer drivers as "Invalid printer settings" - unlike "Microsoft
// Print to PDF", physical printers validate requested margins against their
// own fixed unprintable border and refuse anything outside it, rather than
// clamping. Stick to landscape + printBackground, which every driver
// supports, and let @page CSS (plus the printer's own paper-size default,
// selectable in the dialog below) handle the rest.
ipcMain.handle('print-sheets', () => {
  return new Promise((resolve) => {
    if (!mainWindow) {
      resolve({ success: false, failureReason: 'No window' });
      return;
    }
    mainWindow.webContents.print(
      {
        silent: false,
        printBackground: true,
        landscape: true,
      },
      (success, failureReason) => {
        resolve({ success, failureReason });
      }
    );
  });
});

async function createWindow() {
  if (!httpServer) {
    httpServer = await start(PORT);
  }

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 700,
    title: 'Shelf Talker Wizard',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // No native application menu - File/Tools/Help/Advanced now live in the
  // renderer itself (see the "Menu bar" section of public/js/app.js) so
  // their size is something Settings can control. Explicitly null rather
  // than just skipping this call, which would leave Electron's own default
  // menu (File/Edit/View/Window/Help) in place instead of none at all.
  Menu.setApplicationMenu(null);
  mainWindow.loadURL(`http://127.0.0.1:${PORT}`);

  // Electron's BrowserWindow doesn't show a native copy/paste context menu on
  // its own - the host app has to build one. Editable fields (inputs/
  // textareas) get the full cut/copy/paste/select-all set; non-editable
  // content (e.g. the Live Preview's shelf talker/sign text, which is
  // selectable but not editable) only gets a menu at all when there's a
  // selection to copy - right-click still does nothing on a plain click
  // with nothing selected, or on images/badges, same as before.
  mainWindow.webContents.on('context-menu', (_event, params) => {
    if (params.isEditable) {
      const template = [
        { role: 'cut', enabled: params.editFlags.canCut },
        { role: 'copy', enabled: params.editFlags.canCopy },
        { role: 'paste', enabled: params.editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll', enabled: params.editFlags.canSelectAll },
      ];
      Menu.buildFromTemplate(template).popup({ window: mainWindow });
    } else if (params.selectionText) {
      Menu.buildFromTemplate([
        { role: 'copy', enabled: params.editFlags.canCopy },
      ]).popup({ window: mainWindow });
    }
  });

  // Any link the app tries to open in a new window/tab (e.g. target="_blank")
  // should go to the system browser, not spawn another Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  await createWindow();
  if (!app.isPackaged) return;
  setupAutoUpdater();
  // A few seconds after launch, not blocking startup on it - this is a
  // background check for staff who just leave the app running, not
  // something the window needs to wait on.
  setTimeout(() => {
    log.info('[updater] background check triggered');
    autoUpdater.checkForUpdates().catch(() => {});
  }, 5000);
});

app.on('window-all-closed', () => {
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }
  // Flushes the SQLite WAL file back into data.db and releases the file
  // handle cleanly - better-sqlite3's own docs recommend this rather than
  // just letting the process exit and hoping the OS does it, and this is
  // the one place both server/index.js's require chain and the app's own
  // lifecycle agree the app is actually shutting down.
  closeDb();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
