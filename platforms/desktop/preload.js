// ============================================================
// ELECTRON PRELOAD – Brücke zwischen Main-Process und Web-App
// Stellt sichere APIs über window.electronAPI bereit.
// ============================================================

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Plattform-Info
  platform: 'desktop',

  // Benachrichtigungen
  showNotification: (opts) => ipcRenderer.invoke('show-notification', opts),
  requestNotificationPermission: () => ipcRenderer.invoke('request-notification-permission'),

  // Lokaler Speicher
  storeGet:    (key) => ipcRenderer.invoke('store-get', key),
  storeSet:    (key, val) => ipcRenderer.invoke('store-set', key, val),
  storeRemove: (key) => ipcRenderer.invoke('store-remove', key),
  storeClear:  () => ipcRenderer.invoke('store-clear'),

  // App-Info
  getVersion: () => ipcRenderer.invoke('get-version'),
});
