const path = require('path');
const { app, BrowserWindow, Menu, shell } = require('electron');
const { start } = require('../server/index.js');

// Fixed local port: this app only ever talks to itself on the same PC.
const PORT = 17321;

let mainWindow = null;
let httpServer = null;

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
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  Menu.setApplicationMenu(null);
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
