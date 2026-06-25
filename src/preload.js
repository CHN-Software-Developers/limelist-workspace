'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// The only surface the renderer can touch. Keeps Node out of the UI while
// still allowing persistence and native notifications.
contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.invoke('data:load'),
  save: (data) => ipcRenderer.invoke('data:save', data),
  notify: (title, body) => ipcRenderer.invoke('notify', { title, body }),
});
