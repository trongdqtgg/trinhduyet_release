const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getUrl: () => ipcRenderer.invoke('config:get-url'),
  setUrl: (url) => ipcRenderer.invoke('config:set-url', url),
  getNavState: () => ipcRenderer.invoke('nav:get-state'),
  clearCache: () => ipcRenderer.invoke('cache:clear'),
  openDevTools: () => ipcRenderer.send('devtools:open'),

  back: () => ipcRenderer.send('nav:back'),
  forward: () => ipcRenderer.send('nav:forward'),
  reload: () => ipcRenderer.send('nav:reload'),
  home: () => ipcRenderer.send('nav:home'),
  goTo: (url) => ipcRenderer.send('nav:go-to', url),

  onNavState: (callback) => {
    const listener = (event, state) => callback(state);
    ipcRenderer.on('nav:state', listener);
    return () => ipcRenderer.removeListener('nav:state', listener);
  },

  // ---- Quan ly tab (toi da 3 tab) ----
  getMaxTabs: () => ipcRenderer.invoke('tabs:get-max'),
  newTab: () => ipcRenderer.send('tabs:new'),
  switchTab: (tabId) => ipcRenderer.send('tabs:switch', tabId),
  closeTab: (tabId) => ipcRenderer.send('tabs:close', tabId),

  onTabsState: (callback) => {
    const listener = (event, state) => callback(state);
    ipcRenderer.on('tabs:state', listener);
    return () => ipcRenderer.removeListener('tabs:state', listener);
  },

  // ---- Bao cho main process biet luc overlay (Settings) mo/dong, de an/hien
  // BrowserView tuong ung (xem giai thich trong main.js) ----
  notifyOverlayOpen: () => ipcRenderer.send('overlay:open'),
  notifyOverlayClose: () => ipcRenderer.send('overlay:close'),

  // Click phai vao 1 tab tren thanh tab -> mo menu chuot phai (vd "Mo tab
  // nay o man hinh thu 2").
  tabContextMenu: (tabId) => ipcRenderer.send('tabs:context-menu', tabId),

  // ---- Tu dong cap nhat (GitHub Releases qua electron-updater) ----
  getAppVersion: () => ipcRenderer.invoke('update:get-version'),
  checkForUpdates: () => ipcRenderer.invoke('update:check-now'),
  installUpdateNow: () => ipcRenderer.send('update:install-now'),
  onUpdateStatus: (callback) => {
    const listener = (event, state) => callback(state);
    ipcRenderer.on('update:status', listener);
    return () => ipcRenderer.removeListener('update:status', listener);
  },
});
