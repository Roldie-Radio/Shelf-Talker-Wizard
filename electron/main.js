const path = require('path');
const { app, BrowserWindow, Menu, shell, ipcMain, dialog } = require('electron');
const { start } = require('../server/index.js');

// Fixed local port: this app only ever talks to itself on the same PC.
const PORT = 17321;

let mainWindow = null;
let httpServer = null;

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

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [{ role: 'quit', label: 'Exit' }],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Shelf Talker Wizard',
          click: showAboutDialog,
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

app.whenReady().then(createWindow);

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
