const path = require('path');
const fs = require('fs/promises');
const { app, BrowserWindow, Menu, shell, ipcMain, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const { start } = require('../server/index.js');

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

  autoUpdater.on('error', (err) => {
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
  // Swallow the promise rejection here - the 'error' event above is the
  // single source of truth for reporting a failed check, so this doesn't
  // also show its own dialog for the same failure.
  autoUpdater.checkForUpdates().catch(() => {});
}

// Opens the same in-app Help panel the app bar's own Help button does,
// rather than a separate window - the renderer owns the actual content
// (see index.html/app.js), this just asks it to show it.
function handleShowHelp() {
  if (!mainWindow) return;
  mainWindow.webContents.send('help:show-requested');
}

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

// Loads a previously saved queue file (see the "Save Queue" export format in
// app.js: { app, exportedAt, queue }) and hands the queue array off to the
// renderer, which owns actually applying it - the main process only knows
// how to read/validate the file, not how to render a queue.
async function handleOpenQueue() {
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
}

// "Save Queue" from the File menu can't build the export payload itself (the
// live queue only exists in the renderer), so it asks the renderer for one
// via this event and waits for the queue:save invoke below.
function handleSaveQueueRequest() {
  if (!mainWindow) return;
  mainWindow.webContents.send('queue:save-requested');
}

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

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Open Queue…', accelerator: 'CmdOrCtrl+O', click: handleOpenQueue },
        { label: 'Save Queue', accelerator: 'CmdOrCtrl+S', click: handleSaveQueueRequest },
        { type: 'separator' },
        { role: 'quit', label: 'Exit' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Help', click: handleShowHelp },
        { type: 'separator' },
        { label: 'Check for Updates…', click: handleCheckForUpdates },
        { type: 'separator' },
        {
          label: 'About Shelf Talker Wizard',
          click: showAboutDialog,
        },
      ],
    },
    // This custom menu replaces Electron's default application menu wholesale
    // (see the Menu.setApplicationMenu call below) - the default is the only
    // place "Toggle Developer Tools" normally lives, so without an entry
    // here there was no way to open DevTools in the packaged app at all, not
    // even the usual Ctrl+Shift+I/F12 shortcuts. Kept under its own menu
    // (not tucked into Help) since it's a troubleshooting tool for staff on
    // the phone with support, not something to stumble into during normal use.
    {
      label: 'Advanced',
      submenu: [
        {
          label: 'Toggle Developer Tools',
          accelerator: process.platform === 'darwin' ? 'Cmd+Alt+I' : 'Ctrl+Shift+I',
          click: () => { if (mainWindow) mainWindow.webContents.toggleDevTools(); },
        },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

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

  Menu.setApplicationMenu(buildMenu());
  mainWindow.loadURL(`http://127.0.0.1:${PORT}`);

  // Electron's BrowserWindow doesn't show a native copy/paste context menu on
  // its own - the host app has to build one. Scope it to editable fields
  // (inputs/textareas) so right-click still does nothing on non-editable
  // content like product cards/images.
  mainWindow.webContents.on('context-menu', (_event, params) => {
    if (!params.isEditable) return;

    const template = [
      { role: 'cut', enabled: params.editFlags.canCut },
      { role: 'copy', enabled: params.editFlags.canCopy },
      { role: 'paste', enabled: params.editFlags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', enabled: params.editFlags.canSelectAll },
    ];
    Menu.buildFromTemplate(template).popup({ window: mainWindow });
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
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000);
});

app.on('window-all-closed', () => {
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
