// ============================================================
// ELECTRON MAIN PROCESS – Desktop-App Einstiegspunkt
// Lädt die gleiche Web-App in einem nativen Fenster.
// ============================================================

const { app, BrowserWindow, Notification, ipcMain } = require('electron');
const path = require('path');
const Store = require('electron-store');

const store = new Store();

// ── Fenster erstellen ───────────────────────────────────────

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 480,
    minHeight: 600,
    title: 'Team Kalender',
    icon: path.join(__dirname, '../../assets/icons/icon-512.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    // macOS-spezifisch
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 16 },
  });

  // Web-App laden (aus src/index.html)
  win.loadFile(path.join(__dirname, '../../src/index.html'));

  // DevTools in Entwicklung öffnen
  if (process.env.NODE_ENV === 'development') {
    win.webContents.openDevTools();
  }

  return win;
}

// ── App-Lifecycle ───────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();

  // macOS: Fenster neu erstellen wenn Dock-Icon angeklickt
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Alle Fenster geschlossen → App beenden (außer macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── IPC: Benachrichtigungen ─────────────────────────────────

ipcMain.handle('show-notification', (_event, { title, body }) => {
  if (Notification.isSupported()) {
    const notif = new Notification({ title, body });
    notif.show();
  }
});

ipcMain.handle('request-notification-permission', () => {
  return Notification.isSupported();
});

// ── IPC: Lokaler Speicher (electron-store) ──────────────────

ipcMain.handle('store-get', (_event, key) => store.get(key, null));
ipcMain.handle('store-set', (_event, key, value) => store.set(key, value));
ipcMain.handle('store-remove', (_event, key) => store.delete(key));
ipcMain.handle('store-clear', () => store.clear());
