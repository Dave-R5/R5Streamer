// Klein doorgeefluik voor de site: updates van de app en prompt().
const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('r5app', {
  // in-place updates: action = 'state' | 'check' | 'download' | 'install'; onUpdate(fn) krijgt elke wijziging
  update: (action) => ipcRenderer.invoke('r5:update', String(action || 'state')),
  onUpdate: (fn) => ipcRenderer.on('r5:update-state', (_e, u) => fn(u)),
  prompt: (message, value) => ipcRenderer.sendSync('r5:prompt', String(message ?? ''), value == null ? '' : String(value)),
});

// Electron kent window.prompt() niet (geeft een fout); vervang het door een eigen invoervenster van de app.
webFrame.executeJavaScript('window.prompt = (m, v) => window.r5app.prompt(m, v);');
