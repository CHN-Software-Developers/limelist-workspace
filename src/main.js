'use strict';

const { app, BrowserWindow, ipcMain, Notification } = require('electron');
const path = require('path');
const fs = require('fs');

// All persistent data lives in a single JSON file inside Electron's per-user
// data directory, so it survives app restarts and machine reboots.
const dataFile = path.join(app.getPath('userData'), 'limelist-data.json');

function readData() {
  try {
    const raw = fs.readFileSync(dataFile, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    // Missing or corrupt file -> start fresh.
    return {};
  }
}

function writeData(data) {
  // Write to a temp file then rename for an atomic, crash-safe save.
  const tmp = dataFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, dataFile);
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 860,
    minWidth: 880,
    minHeight: 620,
    title: 'Limelist Workspace',
    backgroundColor: '#171225',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // Ensures notifications are attributed to the app name on Windows.
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.limelist.workspace');
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- IPC: storage + notifications -------------------------------------------

ipcMain.handle('data:load', () => readData());

ipcMain.handle('data:save', (_event, data) => {
  writeData(data);
  return true;
});

ipcMain.handle('notify', (_event, payload) => {
  if (!Notification.isSupported()) return false;
  const notification = new Notification({
    title: payload && payload.title ? String(payload.title) : 'Limelist Workspace',
    body: payload && payload.body ? String(payload.body) : '',
    silent: false,
  });
  notification.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  notification.show();
  return true;
});
