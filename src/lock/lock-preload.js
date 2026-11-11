const { contextBridge, ipcRenderer } = require('electron');

// Het vergrendelvenster praat met één module in het hoofdproces (src/main/screenlock.js): de naam en de
// achtergrond om op te starten, en het controleren van de toegangscode. Meer kan het niet.
contextBridge.exposeInMainWorld('lock', {
  boot: () => ipcRenderer.invoke('screenlock:boot'),
  verify: (pin) => ipcRenderer.invoke('screenlock:verify', pin),
});
