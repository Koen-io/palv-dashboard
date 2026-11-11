const { contextBridge, ipcRenderer } = require('electron');

// Het vergrendelvenster praat met één module in het hoofdproces (src/main/screenlock.js): de naam en de
// achtergrond om op te starten, het controleren van de toegangscode, en
// het op zwart gaan na een minuut zonder aanraking. Meer kan het niet.
contextBridge.exposeInMainWorld('lock', {
  boot: () => ipcRenderer.invoke('screenlock:boot'),
  verify: (pin) => ipcRenderer.invoke('screenlock:verify', pin),
  touch: () => ipcRenderer.send('screenlock:touch'),
  onDim: (fn) => ipcRenderer.on('screenlock:dim', (_e, on) => fn(!!on)),
});
