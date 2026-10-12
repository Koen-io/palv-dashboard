const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('palv', {
  platform: process.platform,
  win: {
    minimize: () => ipcRenderer.send('win:minimize'),
    toggleMaximize: () => ipcRenderer.send('win:toggleMaximize'),
    close: () => ipcRenderer.send('win:close'),
    setFullscreen: (on) => ipcRenderer.send('win:setFullscreen', on),
    getState: () => ipcRenderer.invoke('win:getState'),
    onState: (cb) => ipcRenderer.on('win:state', (_e, state) => cb(state)),
  },
  config: {
    load: () => ipcRenderer.invoke('config:load'),
    save: (cfg) => ipcRenderer.invoke('config:save', cfg),
    exportFile: (cfg) => ipcRenderer.invoke('config:export', cfg),
    importFile: () => ipcRenderer.invoke('config:import'),
  },
  app: {
    setAutoStart: (on) => ipcRenderer.invoke('app:setAutoStart', on),
    version: () => ipcRenderer.invoke('app:version'),
  },
  tile: {
    pickFile: () => ipcRenderer.invoke('tile:pickFile'),
    launch: (tile) => ipcRenderer.invoke('tile:launch', tile),
    icon: (tile) => ipcRenderer.invoke('tile:icon', tile),
  },
  data: {
    metar: (icao) => ipcRenderer.invoke('data:metar', icao),
    wxmap: () => ipcRenderer.invoke('data:wxmap'),
    runways: () => ipcRenderer.invoke('data:runways'),
  },
});
