const { contextBridge, ipcRenderer } = require('electron');

const on = (channel, cb) => ipcRenderer.on(channel, (_e, data) => cb(data));

contextBridge.exposeInMainWorld('palv', {
  platform: process.platform,
  log: (level, msg, data) => ipcRenderer.send('log', level, msg, data),
  win: {
    minimize: () => ipcRenderer.send('win:minimize'),
    toggleMaximize: () => ipcRenderer.send('win:toggleMaximize'),
    close: () => ipcRenderer.send('win:close'),
    setFullscreen: (on) => ipcRenderer.send('win:setFullscreen', on),
    getState: () => ipcRenderer.invoke('win:getState'),
    onState: (cb) => on('win:state', cb),
  },
  config: {
    load: () => ipcRenderer.invoke('config:load'),
    save: (cfg) => ipcRenderer.invoke('config:save', cfg),
    saveSync: (cfg) => ipcRenderer.sendSync('config:saveSync', cfg),
    exportFile: (cfg) => ipcRenderer.invoke('config:export', cfg),
    importFile: () => ipcRenderer.invoke('config:import'),
    backup: (reason) => ipcRenderer.invoke('config:backup', reason),
    backups: () => ipcRenderer.invoke('config:backups'),
    loadBackup: (name) => ipcRenderer.invoke('config:loadBackup', name),
    openBackups: () => ipcRenderer.invoke('config:openBackups'),
  },
  app: {
    setAutoStart: (on) => ipcRenderer.invoke('app:setAutoStart', on),
    version: () => ipcRenderer.invoke('app:version'),
    keepAwake: (on) => ipcRenderer.invoke('app:keepAwake', on),
    health: () => ipcRenderer.invoke('app:health'),
    openLogs: () => ipcRenderer.invoke('app:openLogs'),
    openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
    reload: () => ipcRenderer.invoke('app:reload'),
  },
  status: {
    heartbeat: () => ipcRenderer.send('status:heartbeat'),
    report: (info) => ipcRenderer.send('status:report', info),
  },
  update: {
    status: () => ipcRenderer.invoke('update:status'),
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    justUpdated: () => ipcRenderer.invoke('update:justUpdated'),
    onStatus: (cb) => on('update:status', cb),
  },
  screens: {
    info: () => ipcRenderer.invoke('screens:info'),
    add: (address) => ipcRenderer.invoke('screens:add', address),
    remove: (id) => ipcRenderer.invoke('screens:remove', id),
    rename: (name) => ipcRenderer.invoke('screens:rename', name),
    onUpdate: (cb) => on('screens:update', cb),
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
  traffic: {
    watch: (req) => ipcRenderer.invoke('traffic:watch', req),
    onUpdate: (cb) => on('traffic:update', cb),
    route: (hex) => ipcRenderer.invoke('traffic:route', hex),
  },
  opensky: {
    status: () => ipcRenderer.invoke('opensky:status'),
    setKey: (id, secret) => ipcRenderer.invoke('opensky:setKey', id, secret),
  },
});
