const { app, BrowserWindow, BrowserView, ipcMain, Menu, shell, clipboard, session, screen, dialog } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { autoUpdater } = require('electron-updater');

// URL mac dinh khi chay lan dau. Nguoi dung co the doi trong man hinh Settings
// cua app, hoac sua truc tiep gia tri "url" trong file config luu tai:
//   Windows: %APPDATA%\HTHV4 Browser\config.json
//   Linux:   ~/.config/HTHV4 Browser/config.json
//   macOS:   ~/Library/Application Support/HTHV4 Browser/config.json
const store = new Store({
  name: 'config',
  defaults: {
    url: 'https://hthv4.vnpthis.vn/',
  },
});

const MAX_TABS = 10;

// Phai khop CHINH XAC voi #toolbar / #tabbar trong index.html - ca 2 element
// do deu dat "height" tuong minh (khong phai auto-height) va co
// box-sizing:border-box toan cuc, nen 2 so nay LA gia tri pixel cuoi cung,
// khong can cong them padding/border thu cong.
const TOOLBAR_HEIGHT = 38;
const TAB_BAR_HEIGHT = 28;
const TOP_OFFSET = TOOLBAR_HEIGHT + TAB_BAR_HEIGHT;

// ---- Polyfill cho cac API JS moi ma Chromium cu (Electron 22, dung de
// tuong thich Windows 7) chua co san. Thu vien pdf.js (dung de render PDF
// trong trang HIS) can Promise.try (Chrome ~128, giua 2024) va
// Promise.withResolvers (Chrome 119, cuoi 2023) - ca hai deu chua co trong
// Chromium 108. Da xac nhan bang loi thuc te tu DevTools cua nguoi dung:
// "Promise.withResolvers is not a function" (UnknownErrorException tu
// main.<hash>.js cua pdf.js).
const POLYFILL_SOURCE = `
(function () {
  if (typeof Promise.try !== 'function') {
    Promise.try = function (fn) {
      var args = Array.prototype.slice.call(arguments, 1);
      return new Promise(function (resolve) {
        resolve(fn.apply(this, args));
      });
    };
  }
  if (typeof Promise.withResolvers !== 'function') {
    Promise.withResolvers = function () {
      var resolve, reject;
      var promise = new Promise(function (res, rej) {
        resolve = res;
        reject = rej;
      });
      return { promise: promise, resolve: resolve, reject: reject };
    };
  }
})();
`;

let mainWindow;

// Danh sach tab dang mo: [{ id, view, title }]. Toi da MAX_TABS phan tu.
let tabs = [];
let activeTabId = null;
let tabIdCounter = 0;

function normalizeUrl(input) {
  let value = String(input || '').trim();
  if (!/^https?:\/\//i.test(value)) {
    value = 'https://' + value;
  }
  return value;
}

function getActiveTab() {
  return tabs.find((t) => t.id === activeTabId) || null;
}

function updateBrowserViewBounds() {
  const tab = getActiveTab();
  if (!mainWindow || mainWindow.isDestroyed() || !tab) return;
  const { width, height } = mainWindow.getContentBounds();
  tab.view.setBounds({
    x: 0,
    y: TOP_OFFSET,
    width,
    height: Math.max(0, height - TOP_OFFSET),
  });
}

// Loi da biet cua BrowserView trong Electron: co luc noi dung da tai xong
// (JS chay binh thuong) nhung KHONG duoc ve (paint) len man hinh cho toi khi
// co mot thao tac ep no ve lai. Cach khac phuc pho bien: "nhun" kich thuoc
// view di 1px roi tra ve ngay, buoc trinh compositor phai ve lai toan bo.
function nudgeRepaint(view) {
  if (!mainWindow || mainWindow.isDestroyed() || !view) return;
  const b = view.getBounds();
  if (b.height <= 1) return;
  view.setBounds({ ...b, height: b.height - 1 });
  setTimeout(() => {
    view.setBounds(b);
  }, 30);
}

function sendNavState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const tab = getActiveTab();
  if (!tab) return;
  const wc = tab.view.webContents;
  mainWindow.webContents.send('nav:state', {
    url: wc.getURL(),
    title: wc.getTitle(),
    canGoBack: wc.canGoBack(),
    canGoForward: wc.canGoForward(),
    loading: wc.isLoading(),
  });
}

function sendTabsState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(
    'tabs:state',
    tabs.map((t) => ({
      id: t.id,
      title: t.title || t.view.webContents.getTitle() || 'Tab moi',
      url: t.view.webContents.getURL(),
      active: t.id === activeTabId,
    }))
  );
}

function toggleContentDevTools(view) {
  const wc = view.webContents;
  if (wc.isDevToolsOpened()) wc.closeDevTools();
  else wc.openDevTools({ mode: 'detach' });
}

const devToolsShortcut = (event, input) => {
  const isF12 = input.key === 'F12';
  const isCtrlShiftI = input.control && input.shift && (input.key === 'I' || input.key === 'i');
  if ((isF12 || isCtrlShiftI) && input.type === 'keyDown') {
    const tab = getActiveTab();
    if (tab) toggleContentDevTools(tab.view);
  }
};

// Dang ky polyfill bang CDP (Page.addScriptToEvaluateOnNewDocument) TRUOC KHI
// dieu huong toi trang that. Da kiem chung: neu dung <webview> thay vi
// BrowserView, dang ky nay bi "roi mat" khi trang chuyen sang origin khac
// (vd tu about:blank sang trang HIS that) - do do phai dung BrowserView.
// Co che nay ap dung cho CA cac <iframe> con trong trang (khung xem PDF cua
// he thong HIS thuong nam trong iframe rieng), khong chi frame chinh.
//
// Ngoai ra, nhieu thu vien render PDF (vd pdf.js) chay phan xu ly nang trong
// mot Web Worker rieng - Worker co global scope tach biet, KHONG duoc
// Page.addScriptToEvaluateOnNewDocument vuot toi. Phai dung Target
// domain (setAutoAttach + waitForDebuggerOnStart) de bat moi worker duoc
// trang tao ra, tiem polyfill vao ngay truoc khi no kip chay dong code nao,
// roi moi cho no chay tiep (Runtime.runIfWaitingForDebugger). Da kiem chung
// bang test rieng truoc khi ap dung.
async function attachPolyfillAndLoad(view, initialUrl) {
  const wc = view.webContents;
  await wc.loadURL('about:blank');
  try {
    wc.debugger.attach();

    wc.debugger.on('message', (event, method, params) => {
      if (method === 'Target.attachedToTarget') {
        const sid = params.sessionId;
        // Tiem polyfill cho MOI loai target (worker, iframe, service_worker,
        // page...) - vo hai voi cac loai khong can no, nhung bat buoc voi
        // worker/shared_worker (Page domain khong voi toi duoc).
        wc.debugger
          .sendCommand('Runtime.evaluate', { expression: POLYFILL_SOURCE }, sid)
          .catch(() => {});
        // QUAN TRONG: phai "cho chay tiep" MOI target duoc auto-attach, bat
        // ke loai gi - neu khong se bi treo vinh vien (xem giai thich chi
        // tiet trong README).
        wc.debugger.sendCommand('Runtime.runIfWaitingForDebugger', {}, sid).catch(() => {});
      }
    });

    await wc.debugger.sendCommand('Page.enable');
    await wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
      source: POLYFILL_SOURCE,
    });
    await wc.debugger.sendCommand('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
    });
  } catch (err) {
    console.error('[polyfill] Khong the dang ky script qua CDP:', err);
  }
  wc.loadURL(initialUrl);
}

// Mo mot URL trong tab moi neu chua dat toi gioi han MAX_TABS, nguoc lai
// (vd link muon mo tab moi tu ben ngoai) mo bang trinh duyet he thong.
function openInNewTabOrExternal(url) {
  if (tabs.length < MAX_TABS) {
    createTab(url);
  } else {
    shell.openExternal(url);
  }
}

function createTab(url) {
  if (tabs.length >= MAX_TABS) return null;

  const view = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // BrowserView moi tao KHONG tu dong nhan focus. Electron mac dinh
      // "tiet giam" (throttle) rAF/timer cua mot webContents khong co
      // focus - cac framework JS hien dai (React/Angular...) thuong dung
      // rAF/timer cho vong lap khoi tao/render dau tien, nen co the bi
      // "ket" o man hinh trang cho toi khi webContents nhan duoc focus.
      backgroundThrottling: false,
    },
  });
  view.setBackgroundColor('#ffffff');

  const tabId = ++tabIdCounter;
  const tab = { id: tabId, view, title: 'Dang tai...' };
  tabs.push(tab);

  const wc = view.webContents;
  wc.on('did-start-loading', () => {
    if (tabId === activeTabId) sendNavState();
    sendTabsState();
  });
  wc.on('did-stop-loading', () => {
    if (tabId === activeTabId) {
      sendNavState();
      nudgeRepaint(view);
    }
    sendTabsState();
  });
  wc.on('did-navigate', () => {
    if (tabId === activeTabId) sendNavState();
    sendTabsState();
  });
  wc.on('did-navigate-in-page', () => {
    if (tabId === activeTabId) sendNavState();
    sendTabsState();
  });
  wc.on('page-title-updated', () => {
    tab.title = wc.getTitle();
    sendTabsState();
    if (tabId === activeTabId) {
      sendNavState();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setTitle(tab.title ? `${tab.title} - HTHV4 Browser` : 'HTHV4 Browser');
      }
    }
  });

  // Chu dong dua focus vao view ngay khi trang tai xong lan dau (xem giai
  // thich o backgroundThrottling ben tren).
  wc.once('did-finish-load', () => {
    if (tabId === activeTabId) {
      wc.focus();
      nudgeRepaint(view);
    }
  });

  wc.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    console.error('[nav] did-fail-load:', { errorCode, errorDescription, validatedURL, isMainFrame });
  });
  wc.on('render-process-gone', (event, details) => {
    console.error('[nav] render-process-gone:', details);
  });
  wc.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[content console] ${sourceId}:${line} -`, message);
  });

  wc.on('before-input-event', devToolsShortcut);

  // Click phai chuot: them muc "Mo lien ket trong tab moi" khi bam vao mot
  // the <a>. Bi vo hieu hoa (mau xam) neu da dat toi gioi han MAX_TABS.
  wc.on('context-menu', (event, params) => {
    const items = [];
    if (params.linkURL) {
      items.push({
        label:
          tabs.length < MAX_TABS
            ? 'Mo lien ket trong tab moi'
            : `Mo lien ket trong tab moi (da dat toi da ${MAX_TABS} tab)`,
        enabled: tabs.length < MAX_TABS,
        click: () => createTab(params.linkURL),
      });
      items.push({
        label: 'Sao chep dia chi lien ket',
        click: () => clipboard.writeText(params.linkURL),
      });
    }
    if (params.selectionText) {
      if (items.length) items.push({ type: 'separator' });
      items.push({ label: 'Sao chep', role: 'copy' });
    }
    if (params.isEditable) {
      if (items.length) items.push({ type: 'separator' });
      items.push({ label: 'Dan', role: 'paste' });
    }
    if (items.length === 0) {
      items.push({ label: 'Tai lai trang', click: () => wc.reload() });
    }
    Menu.buildFromTemplate(items).popup({ window: mainWindow });
  });

  // target="_blank" hoac window.open() tu JS -> mo tab moi trong chinh app
  // (thay vi mo trinh duyet he thong nhu truoc), neu chua dat gioi han;
  // nguoc lai fallback ra trinh duyet he thong.
  //
  // Rieng Ctrl+Click (va middle-click) vao link duoc Chromium bao ve day la
  // disposition "background-tab" - CHU DONG CHAN (khong lam gi ca) thay vi
  // mo tab/trinh duyet ngoai, vi trang HIS co the dung to hop Ctrl+Click cho
  // muc dich rieng cua no (vd chon nhieu dong trong bang), va viec tu dong
  // mo tab moi/trinh duyet ngoai moi khi nguoi dung lo giu Ctrl luc bam
  // chuot se gay phien/mo tab rac ngoai y muon.
  wc.setWindowOpenHandler(({ url, disposition }) => {
    if (disposition === 'background-tab') {
      return { action: 'deny' };
    }
    openInNewTabOrExternal(url);
    return { action: 'deny' };
  });

  switchToTab(tabId);
  attachPolyfillAndLoad(view, url || store.get('url'));
  sendTabsState();
  return tabId;
}

function switchToTab(tabId) {
  const target = tabs.find((t) => t.id === tabId);
  if (!target || !mainWindow || mainWindow.isDestroyed()) return;

  // Go tat ca cac view dang gan (thuong chi co 1) truoc khi gan view moi -
  // dung addBrowserView/removeBrowserView (khac setBrowserView) de webContents
  // cua cac tab khac khong bi huy, giu nguyen trang thai khi quay lai.
  mainWindow.getBrowserViews().forEach((v) => mainWindow.removeBrowserView(v));
  mainWindow.addBrowserView(target.view);
  activeTabId = tabId;
  updateBrowserViewBounds();
  target.view.webContents.focus();
  sendNavState();
  sendTabsState();
}

function closeTab(tabId) {
  if (tabs.length <= 1) return; // luon giu lai it nhat 1 tab
  const index = tabs.findIndex((t) => t.id === tabId);
  if (index === -1) return;
  const [closed] = tabs.splice(index, 1);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.removeBrowserView(closed.view);
  }

  if (activeTabId === tabId) {
    const next = tabs[index] || tabs[index - 1] || tabs[0];
    if (next) switchToTab(next.id);
  } else {
    sendTabsState();
  }
}

// Chon 1 man hinh KHONG PHAI man hinh chinh (primary) trong danh sach man
// hinh dang co. Tach thanh ham thuan (nhan vao danh sach + id man hinh
// chinh) de de kiem thu doc lap voi phan cung that.
function pickSecondDisplay(displays, primaryId) {
  return displays.find((d) => d.id !== primaryId) || null;
}

// Click phai vao 1 tab tren thanh tab -> hien menu chuot phai voi lua chon
// "Mo tab nay o man hinh thu 2". Neu may chi co 1 man hinh, muc nay bi mo/
// vo hieu hoa kem ghi chu.
function showTabContextMenu(tabId) {
  const tab = tabs.find((t) => t.id === tabId);
  if (!tab) return;

  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const secondDisplay = pickSecondDisplay(displays, primary.id);

  const items = [
    {
      label: secondDisplay
        ? 'Mo tab nay o man hinh thu 2 (toan man hinh)'
        : 'Mo tab nay o man hinh thu 2 (khong tim thay man hinh thu 2)',
      enabled: !!secondDisplay,
      click: () => openTabOnSecondDisplay(tabId),
    },
  ];

  Menu.buildFromTemplate(items).popup({ window: mainWindow });
}

// "Dua" mot tab ra khoi cua so chinh, hien thi toan man hinh (fullscreen)
// tren man hinh vat ly thu 2. Day la CHUYEN (khong phai sao chep): BrowserView
// cua tab do duoc go khoi cua so chinh va gan sang cua so moi, giu nguyen
// toan bo trang thai (dang dang nhap, vi tri cuon, form dang nhap do...),
// khong tai lai trang. Khi nguoi dung dong cua so man hinh thu 2 (Alt+F4,
// hoac phim Esc - xem popoutEscHandler ben duoi), tab duoc tra lai vao danh
// sach tab cua cua so chinh, KHONG bi mat.
function openTabOnSecondDisplay(tabId) {
  const index = tabs.findIndex((t) => t.id === tabId);
  if (index === -1) return;

  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const target = pickSecondDisplay(displays, primary.id);
  if (!target) {
    dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Khong tim thay man hinh thu 2',
      message: 'May tinh hien chi phat hien duoc 1 man hinh.',
      detail: 'Hay ket noi them mot man hinh (mo rong desktop, khong phai che do nhan ban) roi thu lai.',
    });
    return;
  }

  const [tab] = tabs.splice(index, 1);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.removeBrowserView(tab.view);
  }
  if (activeTabId === tabId) {
    activeTabId = null;
    const next = tabs[index] || tabs[index - 1] || tabs[0];
    if (next) switchToTab(next.id);
    else sendTabsState();
  } else {
    sendTabsState();
  }

  const popoutWin = new BrowserWindow({
    x: target.bounds.x,
    y: target.bounds.y,
    width: target.bounds.width,
    height: target.bounds.height,
    frame: false,
    fullscreen: true,
    autoHideMenuBar: true,
    show: false,
  });

  function fitViewToPopout() {
    if (popoutWin.isDestroyed()) return;
    const { width, height } = popoutWin.getContentBounds();
    tab.view.setBounds({ x: 0, y: 0, width, height });
  }

  // Bam Esc khi dang o man hinh thu 2 se dong cua so nay va tra tab ve lai
  // cua so chinh - de nguoi dung khong bi "ket" trong 1 cua so fullscreen
  // khong co vien/khong co nut dong. (Alt+F4 cua he dieu hanh van luon dung
  // duoc du sao di nua.)
  function popoutEscHandler(event, input) {
    if (input.type === 'keyDown' && input.key === 'Escape' && !popoutWin.isDestroyed()) {
      popoutWin.close();
    }
  }
  tab.view.webContents.on('before-input-event', popoutEscHandler);

  popoutWin.addBrowserView(tab.view);
  fitViewToPopout();
  popoutWin.on('resize', fitViewToPopout);
  popoutWin.on('enter-full-screen', fitViewToPopout);

  popoutWin.once('ready-to-show', () => {
    popoutWin.show();
    fitViewToPopout();
    tab.view.webContents.focus();
  });

  popoutWin.on('closed', () => {
    tab.view.webContents.removeListener('before-input-event', popoutEscHandler);
    if (mainWindow && !mainWindow.isDestroyed()) {
      tabs.push(tab);
      switchToTab(tab.id);
    }
  });
}

// ---- Tu dong cap nhat qua GitHub Releases (electron-updater) ----
// Repo release: https://github.com/trongdqtgg/trinhduyet_release (public,
// khong nhung token nao vao app - xem package.json "build.publish" va
// README muc "Tu dong cap nhat" de biet cach dong goi + phat hanh 1 ban moi).
function sendUpdateStatus(status, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update:status', { status, ...data });
  }
}

function setupAutoUpdater() {
  // Trong che do dev (npm start, chua dong goi thanh .exe) khong co
  // latest.yml/dev-app-update.yml phu hop nen check se luon loi - bo qua
  // hoan toan de khong lam nhieu log/UI luc dang phat trien.
  if (!app.isPackaged) {
    console.log('[update] Bo qua tu dong cap nhat vi dang chay o che do dev.');
    return;
  }

  autoUpdater.autoDownload = true;
  // Khong ep khoi dong lai ngay khi tai xong - chi tu cai khi nguoi dung
  // chu dong thoat app (hoac bam "Khoi dong lai ngay" o hop thoai/nut trong
  // Settings), tranh lam gian doan ca truc dang lam viec.
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('[update] Dang kiem tra cap nhat...');
    sendUpdateStatus('checking');
  });
  autoUpdater.on('update-available', (info) => {
    console.log('[update] Co ban cap nhat moi:', info.version);
    sendUpdateStatus('available', { version: info.version });
  });
  autoUpdater.on('update-not-available', () => {
    console.log('[update] Dang dung ban moi nhat.');
    sendUpdateStatus('not-available');
  });
  autoUpdater.on('error', (err) => {
    console.error('[update] Loi kiem tra/tai cap nhat:', (err && (err.stack || err.message)) || err);
    sendUpdateStatus('error', { message: (err && err.message) || String(err) });
  });
  autoUpdater.on('download-progress', (progress) => {
    sendUpdateStatus('downloading', { percent: Math.round(progress.percent) });
  });
  autoUpdater.on('update-downloaded', (info) => {
    console.log('[update] Da tai xong ban cap nhat:', info.version);
    sendUpdateStatus('downloaded', { version: info.version });
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog
        .showMessageBox(mainWindow, {
          type: 'info',
          buttons: ['Khoi dong lai ngay', 'De sau'],
          defaultId: 0,
          cancelId: 1,
          title: 'Co ban cap nhat moi',
          message: `Da tai xong phien ban ${info.version}.`,
          detail: 'Khoi dong lai app de ap dung ban cap nhat. Ban co the chon "De sau" - ban cap nhat se tu cai vao lan ke tiep app duoc dong hoan toan.',
        })
        .then((result) => {
          if (result.response === 0) autoUpdater.quitAndInstall();
        });
    }
  });

  // Kiem tra ngay sau khi khoi dong (tre 5 giay de khong lam cham qua trinh
  // mo trang chinh), sau do kiem tra dinh ky moi 4 tieng.
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[update] Khong the kiem tra cap nhat luc khoi dong:', err);
    });
  }, 5000);
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 4 * 60 * 60 * 1000);
}

function sendWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('win:state', { maximized: mainWindow.isMaximized() });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    title: 'HTHV4 Browser',
    // Bo thanh tieu de mac dinh cua he dieu hanh - toolbar tu ve trong
    // index.html (voi -webkit-app-region:drag) dong vai tro thanh tieu de,
    // kem 3 nut Thu nho/Phong to/Dong tu lam (xem #window-controls va cac
    // IPC "win:*" ben duoi). Giup giao diện gon nhu mot trinh duyet that
    // (tab + toolbar nam chung 1 khoi, khong bi thua 1 thanh tieu de rieng
    // phia tren).
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // An menu mac dinh cua Electron de giao dien gon nhu mot trinh duyet rieng.
  // Toolbar (back/forward/reload/settings) duoc ve trong index.html.
  Menu.setApplicationMenu(null);

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.webContents.on('before-input-event', devToolsShortcut);
  // Bao trang thai maximize ban dau ngay khi toolbar da san sang, de icon
  // nut Phong to/Khoi phuc hien dung tu dau (vd neu cua so duoc mo lai o
  // trang thai da maximize tu lan truoc).
  mainWindow.webContents.once('did-finish-load', sendWindowState);

  mainWindow.on('resize', updateBrowserViewBounds);
  // Khong chi dua vao 'resize': tren mot so window manager (da phat hien
  // luc kiem thu tren Linux/fluxbox), goi maximize()/unmaximize() khong
  // luon luon phat sinh su kien 'resize' kem theo - phai tu goi lai
  // updateBrowserViewBounds() rieng o day de BrowserView khong bi "ket" o
  // kich thuoc cu sau khi phong to/khoi phuc cua so.
  mainWindow.on('maximize', () => {
    sendWindowState();
    updateBrowserViewBounds();
  });
  mainWindow.on('unmaximize', () => {
    sendWindowState();
    updateBrowserViewBounds();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
    tabs = [];
    activeTabId = null;
  });

  createTab(store.get('url'));
}

app.whenReady().then(() => {
  createWindow();
  setupAutoUpdater();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ---- IPC: dieu khien cua so chinh (thu nho / phong to-khoi phuc / dong) ----
// Thay the cho thanh tieu de mac dinh cua he dieu hanh, vi cua so chay o
// che do frame:false (xem createWindow).
ipcMain.on('win:minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
});
ipcMain.on('win:toggle-maximize', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('win:close', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
});

// ---- IPC: an/hien BrowserView khi mo/dong overlay Settings ----
// BrowserView la thanh phan native, luon duoc ve DE LEN TREN toan bo noi
// dung HTML cua cua so (khong tuan theo z-index cua CSS). Vi vay overlay
// Settings (mot lop <div> HTML thuong) se bi che khuat/vo hinh phia sau
// BrowserView neu khong go no ra truoc. Dung addBrowserView/removeBrowserView
// (khong huy webContents) de an/hien tam thoi.
ipcMain.on('overlay:open', () => {
  const tab = getActiveTab();
  if (tab && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.removeBrowserView(tab.view);
  }
});
ipcMain.on('overlay:close', () => {
  const tab = getActiveTab();
  if (tab && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.addBrowserView(tab.view);
    updateBrowserViewBounds();
  }
});

// ---- IPC: doc/ghi URL cau hinh (goi tu man hinh Settings trong renderer) ----
ipcMain.handle('config:get-url', () => store.get('url'));

ipcMain.handle('config:set-url', (event, newUrl) => {
  const normalized = normalizeUrl(newUrl);
  store.set('url', normalized);
  const tab = getActiveTab();
  if (tab) tab.view.webContents.loadURL(normalized);
  return normalized;
});

// ---- IPC: dieu khien dieu huong cua tab dang active ----
ipcMain.handle('nav:get-state', () => {
  const tab = getActiveTab();
  if (!tab) return null;
  const wc = tab.view.webContents;
  return {
    url: wc.getURL(),
    title: wc.getTitle(),
    canGoBack: wc.canGoBack(),
    canGoForward: wc.canGoForward(),
    loading: wc.isLoading(),
  };
});

ipcMain.on('nav:back', () => {
  const tab = getActiveTab();
  if (tab && tab.view.webContents.canGoBack()) tab.view.webContents.goBack();
});
ipcMain.on('nav:forward', () => {
  const tab = getActiveTab();
  if (tab && tab.view.webContents.canGoForward()) tab.view.webContents.goForward();
});
ipcMain.on('nav:reload', () => {
  const tab = getActiveTab();
  if (tab) tab.view.webContents.reload();
});
ipcMain.on('nav:home', () => {
  const tab = getActiveTab();
  if (tab) tab.view.webContents.loadURL(store.get('url'));
});
ipcMain.on('nav:go-to', (event, url) => {
  const tab = getActiveTab();
  if (tab && url) tab.view.webContents.loadURL(normalizeUrl(url));
});

// ---- IPC: quan ly tab (toi da MAX_TABS) ----
ipcMain.handle('tabs:get-max', () => MAX_TABS);
ipcMain.on('tabs:new', () => {
  if (tabs.length < MAX_TABS) createTab(store.get('url'));
});
ipcMain.on('tabs:switch', (event, tabId) => switchToTab(tabId));
ipcMain.on('tabs:close', (event, tabId) => closeTab(tabId));
ipcMain.on('tabs:context-menu', (event, tabId) => showTabContextMenu(tabId));

// ---- Chi dung de kiem thu tu dong (khong bat trong ban build binh thuong):
// cho phep script test truy cap truc tiep cac ham noi bo qua Node inspector
// (--inspect) de gia lap co/khong co man hinh thu 2 ma khong can phan cung
// that. Nguoi dung binh thuong khong bao gio bat co HTHV4_TEST_HOOKS. ----
if (process.env.HTHV4_TEST_HOOKS === '1') {
  global.__hthv4TestHooks = {
    getTabsSnapshot: () => tabs.map((t) => ({ id: t.id })),
    getActiveTabId: () => activeTabId,
    getMainWindowBrowserViewCount: () => (mainWindow ? mainWindow.getBrowserViews().length : 0),
    openTabOnSecondDisplay,
    pickSecondDisplay,
    autoUpdater,
    sendUpdateStatus,
    forceSetupAutoUpdater: () => {
      // Ban that cua setupAutoUpdater() bi chan boi app.isPackaged khi chay
      // qua `electron .`; ham nay chi dang ky lai cac listener (khong dung
      // guard) de script test co the gia lap su kien autoUpdater.emit(...).
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.on('checking-for-update', () => sendUpdateStatus('checking'));
      autoUpdater.on('update-available', (info) => sendUpdateStatus('available', { version: info.version }));
      autoUpdater.on('update-not-available', () => sendUpdateStatus('not-available'));
      autoUpdater.on('error', (err) => sendUpdateStatus('error', { message: (err && err.message) || String(err) }));
      autoUpdater.on('download-progress', (p) => sendUpdateStatus('downloading', { percent: Math.round(p.percent) }));
      autoUpdater.on('update-downloaded', (info) => {
        sendUpdateStatus('downloaded', { version: info.version });
      });
    },
  };
}

// ---- IPC: mo DevTools cho NOI DUNG trang web (tab dang active) ----
// Quan trong: moi tab la mot webContents rieng voi mainWindow, nen
// Ctrl+Shift+I/F12 mac dinh (neu co) chi debug duoc thanh toolbar, KHONG
// debug duoc noi dung trang - phai mo devtools rieng cho webContents cua tab.
ipcMain.on('devtools:open', () => {
  const tab = getActiveTab();
  if (tab) toggleContentDevTools(tab.view);
});

// ---- IPC: tu dong cap nhat (goi tu man hinh Settings) ----
ipcMain.handle('update:get-version', () => app.getVersion());

ipcMain.handle('update:check-now', async () => {
  if (!app.isPackaged) {
    return { status: 'dev-mode' };
  }
  try {
    await autoUpdater.checkForUpdates();
    return { status: 'checked' };
  } catch (err) {
    return { status: 'error', message: (err && err.message) || String(err) };
  }
});

ipcMain.on('update:install-now', () => {
  if (app.isPackaged) autoUpdater.quitAndInstall();
});

// ---- IPC: xoa cache trinh duyet (goi tu man hinh Settings) ----
// Xoa cache HTTP, Service Worker va Cache Storage - day la nhung noi hay
// giu lai ban JS/PDF-viewer cu sau khi trang da cap nhat, gay ra cac loi
// kho hieu (vd van bao thieu ham dau khi code moi tren server da co san).
// CO Y giu lai cookie/localStorage de khong lam mat phien dang nhap. Tat ca
// cac tab dung chung 1 session mac dinh nen chi can xoa 1 lan.
ipcMain.handle('cache:clear', async () => {
  const ses = session.defaultSession;
  await ses.clearCache();
  await ses.clearStorageData({
    storages: ['serviceworkers', 'cachestorage', 'shadercache', 'filesystem'],
  });
  tabs.forEach((t) => t.view.webContents.reloadIgnoringCache());
  return true;
});
