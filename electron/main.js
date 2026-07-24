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
// through the main process with explicit options fixes both.
ipcMain.handle('print-sheets', () => {
  return new Promise((resolve) => {
    if (!mainWindow) {
      resolve({ success: false, failureReason: 'No window' });
      return;
    }
    // Margins match the @page rule in styles.css (0.28in = 7112 microns) so
    // the sheet layout's math (card size, rows/cols) lines up with what's
    // actually reserved on the physical page.
    const MARGIN_MICRONS = 7112;
    mainWindow.webContents.print(
      {
        silent: false,
        printBackground: true,
        landscape: true,
        pageSize: 'Letter',
        margins: {
          marginType: 'custom',
          top: MARGIN_MICRONS,
          bottom: MARGIN_MICRONS,
          left: MARGIN_MICRONS,
          right: MARGIN_MICRONS,
        },
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
