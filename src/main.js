const { app, BrowserWindow, BrowserView, ipcMain, Menu, shell, clipboard, session, screen, dialog, safeStorage, webContents } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { autoUpdater } = require('electron-updater');

const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3.0;

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

// ---- Luu mat khau da dang nhap (tuong tu trinh quan ly mat khau cua Chrome) ----
// Luu rieng file config.json (khong chung voi URL), moi ban ghi gom:
// { id, origin, username, secret: {enc, data}, createdAt, updatedAt }.
// Mat khau KHONG BAO GIO duoc luu o dang van ban thuong - luon di qua
// encryptSecret() truoc khi ghi xuong dia (xem chi tiet trong README).
const credentialStore = new Store({
  name: 'credentials',
  defaults: { entries: [] },
});

// Ma hoa bang co che bao mat cua he dieu hanh (Windows: DPAPI rang buoc vao
// tai khoan Windows dang dang nhap; macOS: Keychain; Linux: libsecret/kwallet
// neu co). Neu may khong ho tro (rat hiem tren Windows, doi khi xay ra tren
// mot so ban Linux thieu keyring), fallback ve base64 THO (KHONG ma hoa that
// su) de tinh nang van hoat dong thay vi loi cung - nhung day la fallback
// kem an toan hon, duoc ghi ro trong README de nguoi dung biet.
function encryptSecret(plain) {
  if (safeStorage.isEncryptionAvailable()) {
    return { enc: true, data: safeStorage.encryptString(plain).toString('base64') };
  }
  return { enc: false, data: Buffer.from(plain, 'utf8').toString('base64') };
}
function decryptSecret(secret) {
  if (!secret) return '';
  if (secret.enc && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(secret.data, 'base64'));
    } catch (err) {
      return '';
    }
  }
  try {
    return Buffer.from(secret.data, 'base64').toString('utf8');
  } catch (err) {
    return '';
  }
}
function findCredential(origin, username) {
  return credentialStore.get('entries').find((e) => e.origin === origin && e.username === username) || null;
}
function getCredentialsForOrigin(origin) {
  return credentialStore.get('entries').filter((e) => e.origin === origin);
}
function upsertCredential({ origin, username, password }) {
  if (!origin || !username || !password) return;
  const entries = credentialStore.get('entries');
  const existing = entries.find((e) => e.origin === origin && e.username === username);
  const secret = encryptSecret(password);
  if (existing) {
    existing.secret = secret;
    existing.updatedAt = Date.now();
  } else {
    entries.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      origin,
      username,
      secret,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
  credentialStore.set('entries', entries);
}
function deleteCredentialById(id) {
  credentialStore.set(
    'entries',
    credentialStore.get('entries').filter((e) => e.id !== id)
  );
}

// Script duoc tiem vao MOI trang (qua attachPolyfillAndLoad) de bat cap tai
// khoan/mat khau nguoi dung vua nhap, neu co. Chi gui du lieu ve tien trinh
// main qua kenh console.log co tien to dac biet (xem giai thich trong
// console-message handler ben duoi) - trang web KHONG co ipcRenderer (dung,
// vi ly do bao mat), nen day la cach duy nhat de "noi chuyen nguoc" ve
// main.js ma khong can lam yeu contextIsolation.
//
// Dung 3 "chien luoc" bat song song, vi khong phai trang nao cung dung the
// <form> that su voi su kien "submit" thuc su xay ra (vd form dang nhap
// dat trong modal/drawer cua cac SPA hien dai thuong tu xu ly bang JS +
// fetch/XHR, khong co <form>/submit that): (1) submit event tren <form>
// (cach pho bien nhat, form web truyen thong nhu he thong HIS cu), (2) click
// vao nut co ve la nut dang nhap/xac nhan (bat ca truong hop KHONG co form),
// (3) phim Enter trong o mat khau/ten dang nhap khi KHONG nam trong form.
const CREDENTIAL_CAPTURE_SOURCE = `
(function () {
  if (window.__hthv4PwHooked) return;
  window.__hthv4PwHooked = true;

  // Ghi log CHAN DOAN vao console cua TRANG (xem duoc bang F12) de tra cuu
  // khi 1 form/modal/drawer thuc te nao do khong hoi luu mat khau ma khong
  // ro vi sao - KHONG BAO GIO ghi mat khau that ra day (chi ghi ten dang
  // nhap, hoac cac gia tri boolean/mo ta), an toan de nguoi dung tu bat F12
  // xem va gui lai cho nha phat trien khi can debug.
  function dbg(msg) {
    try { console.log('[HTHV4-DEBUG] ' + msg); } catch (err) {}
  }
  dbg('Da nap script theo doi dang nhap cho khung (frame): ' + location.href + ' - neu form dang nhap nam trong 1 <iframe> rieng, nho mo dung frame do trong DevTools (goc tren cua tab Console co the chon "top" hay ten frame khac) moi thay duoc cac dong debug cua DUNG frame chua form.');

  // Nhieu bo UI hien dai (Angular Material, ng-zorro, PrimeNG, cac thu vien
  // "oh-input-group" cua he thong HIS thuc te...) co san nut "con mat" de
  // NGUOI DUNG bam xem lai mat khau vua go truoc khi dang nhap - luc do
  // thuoc tinh type cua CHINH o input do bi DOI tu "password" sang "text"
  // (khong tao phan tu moi). Neu nguoi dung bam nut nay TRUOC khi bam dang
  // nhap, moi truy van dua vao input[type="password"] deu KHONG con tim
  // thay o do nua -> extractPayload tra ve null -> KHONG BAT DUOC gi ca,
  // du dang nhap thanh cong that su - day chinh la nguyen nhan 1 so
  // modal/drawer/form thuc te khong bao gio hoi luu mat khau.
  // Cach khac phuc: NGAY KHI phat hien 1 o co type="password" (du chi thoang
  // qua), danh dau no bang thuoc tinh data-hthv4-pwtag=1 - thuoc tinh nay
  // KHONG bi mat di khi type doi sang "text" sau do (van la CUNG 1 phan tu
  // DOM). Moi truy van tim "o mat khau" trong toan bo file nay deu dung
  // PW_SELECTOR (ca type="password" LAN da danh dau) thay vi chi
  // input[type="password"] don thuan.
  var PW_SELECTOR = 'input[type="password"], input[data-hthv4-pwtag]';
  function tagPasswordFields() {
    try {
      var fields = document.querySelectorAll('input[type="password"]:not([data-hthv4-pwtag])');
      for (var i = 0; i < fields.length; i++) fields[i].setAttribute('data-hthv4-pwtag', '1');
    } catch (err) {}
  }
  tagPasswordFields();

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    var r = el.getBoundingClientRect();
    if (r.width <= 0 && r.height <= 0) return false;
    // Kiem tra CA display:none, visibility:hidden VA opacity:0 tren chinh
    // phan tu LAN toan bo cha - chi check getBoundingClientRect (nhu truoc
    // day) khong du, vi nhieu thu vien modal/drawer/tab hien dai (Vue v-show,
    // Angular *ngIf voi class an, Bootstrap, cac component tu build...) an
    // noi dung bang visibility:hidden hoac opacity:0 thay vi display:none/go
    // hoan toan khoi DOM - luc do getBoundingClientRect VAN tra ve kich thuoc
    // > 0 (phan tu van chiem cho trong layout), khien app tuong nham la "van
    // con hien" du mat thuong khong nhin thay gi ca.
    var node = el;
    while (node && node.nodeType === 1) {
      var cs = window.getComputedStyle(node);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
      node = node.parentElement;
    }
    return true;
  }

  // Tim vung "boi canh" chua form dang nhap: uu tien the <form> that su bao
  // quanh; neu khong co (modal/drawer dung div/JS thuan, khong dung <form>)
  // thi lui ve khung dialog/modal/drawer gan nhat theo cac dau hieu pho
  // bien (role, class thuong gap); cuoi cung moi lui ve toan bo trang.
  function findContainer(el) {
    if (!el) return document;
    var form = el.closest && el.closest('form');
    if (form) return form;
    var dialogLike = el.closest && el.closest(
      '[role="dialog"], [role="alertdialog"], [aria-modal="true"], .modal, .Modal, .dialog, .Dialog, .drawer, .Drawer, .popup, .Popup, .overlay, .Overlay'
    );
    return dialogLike || document;
  }

  function findUsernameFor(pwInput, scope) {
    var candidates = Array.prototype.filter.call(scope.querySelectorAll('input'), function (i) {
      var t = (i.type || 'text').toLowerCase();
      return i !== pwInput && (t === 'text' || t === 'email' || t === 'tel') && i.value;
    });
    var userInput = null;
    for (var i = 0; i < candidates.length; i++) {
      if (pwInput.compareDocumentPosition(candidates[i]) & Node.DOCUMENT_POSITION_PRECEDING) userInput = candidates[i];
    }
    if (!userInput && candidates.length) userInput = candidates[candidates.length - 1];
    return userInput;
  }

  function extractPayload(container) {
    if (!container || !container.querySelectorAll) { dbg('extractPayload: container khong hop le'); return null; }
    var pwInputs = Array.prototype.filter.call(container.querySelectorAll(PW_SELECTOR), function (i) {
      return i.value && isVisible(i);
    });
    if (!pwInputs.length) {
      dbg('extractPayload: KHONG tim thay o mat khau nao dang hien+co gia tri trong vung tim (co the do o mat khau nam NGOAI form/modal duoc dung de tim, hoac o dang bi an theo cach khac).');
      return null;
    }
    var pwInput = pwInputs[0];
    var userInput = findUsernameFor(pwInput, container);
    if (!userInput) {
      dbg('extractPayload: tim thay o mat khau (co gia tri) NHUNG khong tim thay o ten dang nhap nao dung truoc no trong cung vung - kiem tra lai o ten dang nhap co dung type="text"/"email"/"tel" va co gia tri hay khong.');
      return null;
    }
    dbg('extractPayload: OK - se gui capture cho ten dang nhap "' + userInput.value + '"');
    return { origin: location.origin, username: userInput.value, password: pwInput.value };
  }

  var lastSentKey = null;
  var lastSentAt = 0;
  function sendCapture(payload) {
    if (!payload) return;
    var key = JSON.stringify([payload.username, payload.password]);
    var now = Date.now();
    // Chong gui trung: 1 hanh dong dang nhap co the bi ca 2-3 chien luoc
    // ben duoi cung bat trong cung 1 luc (vd click nut submit tren 1 <form>
    // that se kich hoat CA click-handler LAN submit-handler) - bo qua ban
    // sao trung trong vong 1.5 giay de khong xu ly lai vo ich.
    if (key === lastSentKey && now - lastSentAt < 1500) { dbg('sendCapture: trung voi lan gui truoc trong 1.5s, bo qua (binh thuong, khong phai loi).'); return; }
    lastSentKey = key;
    lastSentAt = now;
    dbg('sendCapture: DA GUI ve tien trinh chinh de xep hang hoi luu.');
    console.log('__HTHV4_PWCAP__' + JSON.stringify(payload));
  }

  // (1) Form dang nhap kieu truyen thong.
  document.addEventListener('submit', function (e) {
    try {
      dbg('Su kien "submit" tren the <form> (chien luoc 1) - dang thu trich xuat...');
      sendCapture(extractPayload(e.target));
    } catch (err) { dbg('Loi o chien luoc (1): ' + (err && err.message)); }
  }, true);

  // (2) Bam nut "Dang nhap"/"Xac nhan"/... du KHONG co <form> that (SPA tu
  // xu ly bang JS). TRUOC DAY chi coi la nut dang nhap neu no la 1 trong cac
  // tag/role CHUAN (button, a, input[type=submit/button], [role="button"]) -
  // nhung rat nhieu bo giao dien Angular/React thuc te (vd cac thu vien UI
  // tu build nhu "oh-form"/"oh-input-group" cua chinh he thong HIS) dung
  // CUSTOM ELEMENT rieng cho nut bam (vd <oh-button>) ma KHONG gan role/tag
  // chuan nao ca - khien .closest('button, ...') khong bao gio khop, bo lo
  // HOAN TOAN buoc dang nhap (da xac nhan qua log debug thuc te: nguoi dung
  // dang nhap thanh cong nhung khong co dong log nao cua chien luoc (1)/(2)/
  // (3) duoc kich hoat ca). Sua lai: KHONG con doi hoi tag/role cu the nua -
  // di nguoc len toi da 6 cap cha tu diem bam, tim phan tu GAN NHAT co van
  // ban NGAN (<=40 ky tu, tranh khop nham ca mot khoi noi dung dai chi vi no
  // chua chu "dang nhap" o dau do) khop voi LOGIN_WORDS, bat ke no la tag
  // hay custom-element gi.
  var LOGIN_WORDS = /dang\\s*nhap|log\\s*-?\\s*in|sign\\s*-?\\s*in|submit|continue|tiep\\s*tuc|xac\\s*nhan|confirm/i;
  document.addEventListener('click', function (e) {
    try {
      var el = e.target;
      var target = null;
      for (var depth = 0; el && el.nodeType === 1 && depth < 6; depth++, el = el.parentElement) {
        var txt = (el.textContent || '').trim();
        var aria = (el.getAttribute && el.getAttribute('aria-label')) || '';
        var val = el.value || '';
        if ((txt && txt.length <= 40 && LOGIN_WORDS.test(txt)) || LOGIN_WORDS.test(aria) || LOGIN_WORDS.test(val)) {
          target = el;
          break;
        }
      }
      if (!target) return;
      dbg('Bam vao phan tu co ve la nut dang nhap: "' + (target.textContent || '').trim().slice(0, 40) + '" <' + target.tagName.toLowerCase() + '> (chien luoc 2) - dang thu trich xuat...');
      sendCapture(extractPayload(findContainer(target)));
    } catch (err) { dbg('Loi o chien luoc (2): ' + (err && err.message)); }
  }, true);

  // (3) Phim Enter trong o mat khau/ten dang nhap KHI KHONG nam trong the
  // <form> (modal/drawer dung div thuong, JS tu lang nghe Enter thay vi de
  // trinh duyet tu submit form that).
  document.addEventListener('keydown', function (e) {
    try {
      if (e.key !== 'Enter') return;
      var el = e.target;
      if (!el || !el.tagName || el.tagName !== 'INPUT') return;
      var t = (el.type || 'text').toLowerCase();
      if (t !== 'password' && t !== 'text' && t !== 'email' && t !== 'tel') return;
      if (el.closest && el.closest('form')) return; // co form that -> de chien luoc (1) lo
      dbg('Bam Enter trong o input (khong nam trong form) (chien luoc 3) - dang thu trich xuat...');
      sendCapture(extractPayload(findContainer(el)));
    } catch (err) { dbg('Loi o chien luoc (3): ' + (err && err.message)); }
  }, true);

  // (4) Theo doi DOM de phat hien o mat khau xuat hien SAU KHI trang da tai
  // xong (vd modal/drawer dang nhap chi duoc dung len khi nguoi dung bam nut
  // "Dang nhap" de mo popup, luc trang moi tai xong thi form nay chua ton
  // tai) - bao cho main process biet de no thu tu dong dien lai (main
  // process moi la noi giu mat khau da giai ma, xem tryAutofill).
  var notifiedFields = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
  var notifyTimer = null;
  function scheduleFieldCheck() {
    if (notifyTimer) return;
    notifyTimer = setTimeout(function () {
      notifyTimer = null;
      try {
        var pwFields = document.querySelectorAll('input[type="password"]');
        for (var i = 0; i < pwFields.length; i++) {
          var f = pwFields[i];
          if (notifiedFields && notifiedFields.has(f)) continue;
          if (notifiedFields) notifiedFields.add(f);
          console.log('__HTHV4_PWFIELD_DETECTED__' + JSON.stringify({ origin: location.origin }));
          break;
        }
      } catch (err) {}
    }, 400);
  }
  if (typeof MutationObserver !== 'undefined') {
    // Danh dau (tagPasswordFields) chay NGAY, KHONG debounce, moi lan DOM co
    // thay doi - phai nhanh hon thoi gian nguoi dung bam nut "con mat" de lo
    // mat khau (xem giai thich PW_SELECTOR o dau file). Rieng viec BAO CHO
    // main process biet de tu dong dien (scheduleFieldCheck) van giu debounce
    // 400ms nhu cu vi khong yeu cau gap, tranh goi lai qua nhieu lan vo ich
    // khi trang co nhieu thay doi DOM lien tuc.
    var observer = new MutationObserver(function () {
      tagPasswordFields();
      scheduleFieldCheck();
    });
    var startObserving = function () {
      // Danh dau NGAY nhung o mat khau da co san TRONG HTML tinh cua trang
      // (khong phai do JS chen vao sau) - script nay chay qua
      // Page.addScriptToEvaluateOnNewDocument, tuc TRUOC KHI trang bat dau
      // parse, nen lan goi tagPasswordFields() dau tien o dau file (ngay khi
      // IIFE chay) luon khong thay gi ca (DOM con rong). Voi cac SPA thuc su
      // (Angular/React/Vue...), form dang nhap hau het duoc dung len bang JS
      // SAU thoi diem nay (sau khi bundle JS tai xong va component render) -
      // luc do MutationObserver ben duoi se tu bat duoc. Nhung de an toan ca
      // voi truong hop form nam san trong HTML tinh (server-render, khong
      // qua JS), phai quet lai 1 lan NGAY LUC bat dau observe (dung thoi
      // diem DOMContentLoaded/luc co document.body) chu khong the chi cho
      // MutationObserver, vi no chi bao cac thay doi XAY RA SAU khi da
      // observe() - noi dung co san TRUOC do se khong duoc bao lai.
      tagPasswordFields();
      observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
    };
    if (document.body) startObserving();
    else document.addEventListener('DOMContentLoaded', startObserving);
  }
})();
`;

// Dung native setter cua thuoc tinh "value" (thay vi el.value = ...) vi
// nhieu framework hien dai (React/Angular/Vue) ghi de setter mac dinh de
// tu quan ly state noi bo - gan truc tiep el.value se hien dung TREN MAN
// HINH nhung framework khong "biet" gia tri da doi, dan toi form van coi la
// rong khi submit. Sau khi gan, phai ban them event input/change de
// framework nhan biet thay doi.
function buildAutofillScript(username, password, opts) {
  const force = !!(opts && opts.force);
  return `
(function () {
  try {
    // Tim ca o type="password" LAN o da tung la password nhung bi doi sang
    // "text" boi nut "con mat" hien/an mat khau cua chinh trang (xem giai
    // thich PW_SELECTOR/tagPasswordFields trong CREDENTIAL_CAPTURE_SOURCE) -
    // du field dang o trang thai nao, van la DUNG o mat khau can dien.
    var pw = document.querySelector('input[type="password"], input[data-hthv4-pwtag]');
    // Neu o mat khau da co san gia tri (nguoi dung dang tu go, hoac da duoc
    // dien tu truoc) thi KHONG ghi de - tranh xoa mat noi dung nguoi dung
    // dang nhap thu cong. Rieng khi nguoi dung CHU DONG chon 1 tai khoan tu
    // dropdown (xem buildAccountPickerScript), luon ghi de (force = true) vi
    // do la y muon ro rang cua nguoi dung, du field dang co gia tri gi khac.
    if (!pw${force ? '' : ' || pw.value'}) return;
    function findContainer(el) {
      if (!el) return document;
      var form = el.closest && el.closest('form');
      if (form) return form;
      var dialogLike = el.closest && el.closest(
        '[role="dialog"], [role="alertdialog"], [aria-modal="true"], .modal, .Modal, .dialog, .Dialog, .drawer, .Drawer, .popup, .Popup, .overlay, .Overlay'
      );
      return dialogLike || document;
    }
    var scope = findContainer(pw);
    var candidates = Array.prototype.filter.call(scope.querySelectorAll('input'), function (i) {
      var t = (i.type || 'text').toLowerCase();
      return i !== pw && (t === 'text' || t === 'email' || t === 'tel');
    });
    var userInput = null;
    for (var i = 0; i < candidates.length; i++) {
      if (pw.compareDocumentPosition(candidates[i]) & Node.DOCUMENT_POSITION_PRECEDING) userInput = candidates[i];
    }
    if (!userInput && candidates.length) userInput = candidates[candidates.length - 1];
    function setVal(el, val) {
      if (!el) return;
      var proto = Object.getPrototypeOf(el);
      var desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(el, val); else el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    setVal(userInput, ${JSON.stringify(username)});
    setVal(pw, ${JSON.stringify(password)});
  } catch (err) {}
})();
`;
}

function tryAutofill(tab) {
  try {
    const wc = tab.view.webContents;
    const url = wc.getURL();
    if (!url || !/^https?:/i.test(url)) return;
    const origin = new URL(url).origin;
    const creds = getCredentialsForOrigin(origin);
    if (!creds.length) return;
    // Neu co nhieu tai khoan luu cho cung 1 trang, tu dong dien SAN tai
    // khoan duoc dung/luu GAN DAY NHAT (de nguoi dung khong phai lam gi ca
    // trong truong hop dung lai);nguoi dung van co the doi sang tai khoan
    // khac bat ky luc nao bang dropdown chon tai khoan (xem
    // trySetupAccountPicker/buildAccountPickerScript ben duoi).
    const best = creds.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const password = decryptSecret(best.secret);
    if (!password) return;
    wc.executeJavaScript(buildAutofillScript(best.username, password)).catch(() => {});
  } catch (err) {
    console.error('[passwords] Loi tu dong dien:', err);
  }
}

// Xay dung script tiem vao trang, gan san sang cho o mat khau (va o ten dang
// nhap di kem) 1 dropdown BAM CHUOT PHAI (khong phai bam trai/focus nhu ban
// dau) voi HAI cong dung:
//   1. "Luu tai khoan/mat khau hien tai" - luu NGAY tai khoan/mat khau nguoi
//      dung VUA GO trong o (doc truc tiep tai thoi diem bam chuot phai), TRUOC
//      khi ho bam nut dang nhap. Day la yeu cau cua nguoi dung: voi 1 so he
//      thong (form khong chuyen trang, khong dong lai, hoac cac chien luoc bat
//      tu dong khac deu khong khop), doan chac tu dong khong con dang tin cay -
//      nen can 1 cach LUU THU CONG, chu dong, khong phu thuoc vao viec dang
//      nhap co thanh cong/co chuyen trang hay khong.
//   2. "Chon tai khoan da luu" - hien danh sach cac tai khoan da luu cho DUNG
//      trang nay (chi hien ten dang nhap, KHONG hien mat khau that trong danh
//      sach), bam chon 1 muc se dien lai CA HAI o bang dung tai khoan/mat khau
//      cua muc do.
// Ca hai muc co the cung xuat hien trong 1 dropdown (vd: dang go 1 tai khoan
// MOI trong khi trang da co san tai khoan KHAC tu truoc).
//
// LY DO dung chuot phai thay vi bam trai/focus (nhu ban dau): bam trai/focus
// khien dropdown tu hien MOI LAN nguoi dung bam vao o de go, gay vuong (nguoi
// dung phai bam thêm 1 lan nua de tat dropdown moi go tiep duoc) va co the
// lam lech thao tac dang nhap binh thuong. Dung chuot phai giong 1 "menu goi
// y" chu dong - khong anh huong gi den bam trai/go binh thuong vao o.
//
// Mat khau THAT SU chi duoc gui di dung 1 LAN, dung luc nguoi dung CHU DONG
// bam vao 1 muc trong dropdown (chon tai khoan co san -> gui __HTHV4_PWPICK__
// chi voi id, main process moi giai ma; hoac luu tai khoan hien tai -> gui
// __HTHV4_PWSAVE_NOW__ voi mat khau THAT vua go) - danh sach hien trong
// dropdown khong bao gio hien thi mat khau, chi co id/ten dang nhap.
function buildAccountPickerScript(candidates) {
  const safeCandidates = JSON.stringify(candidates);
  return `
(function () {
  try {
    // Ghi de danh sach ung vien MOI NHAT vao 1 bien global dung chung - moi
    // lan ham nay chay lai (vd sau khi trang tai lai, hoac phat hien o mat
    // khau moi) deu cap nhat danh sach nay, con cac listener chuot phai da gan
    // tren tung o thi CHI gan 1 LAN (xem dataset.hthv4PickerSetup ben duoi)
    // va luon doc gia tri MOI NHAT cua bien nay tai thoi diem hien dropdown.
    window.__hthv4PwCandidates = ${safeCandidates};

    function removeDropdown() {
      var old = document.getElementById('__hthv4_pw_picker__');
      if (old) old.remove();
    }

    // Hien dropdown NGAY TAI VI TRI BAM CHUOT PHAI (giong context-menu that
    // su cua trinh duyet) thay vi neo theo o input - dung toa do x/y cua su
    // kien contextmenu, co gioi han lai trong khung nhin de khong bi trang.
    //
    // "current" (neu co) la {username, password} nguoi dung dang GO DO (tai
    // thoi diem bam chuot phai, doc truc tiep tu o input, KHONG phai tu du
    // lieu da luu) - dung de hien muc "Luu tai khoan/mat khau hien tai" cho
    // phep luu NGAY LAP TUC ma khong can doi form chuyen trang/dong lai (xem
    // yeu cau cua nguoi dung: "sau khi nhap xong, click phai de luu truoc khi
    // bam dang nhap").
    function showDropdownAt(x, y, current) {
      var candidates = window.__hthv4PwCandidates || [];
      var hasCurrent = !!(current && current.username && current.password);
      if (!candidates.length && !hasCurrent) return;
      removeDropdown();
      var box = document.createElement('div');
      box.id = '__hthv4_pw_picker__';
      box.style.cssText = 'position:fixed;z-index:2147483647;background:#2a2f3d;color:#e8eaf0;border:1px solid #3a4051;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.3);font-family:Arial,sans-serif;font-size:13px;overflow:hidden;min-width:220px;visibility:hidden;';
      if (hasCurrent) {
        // Muc nay LUON doc gia tri MOI NHAT cua o (bien "current" duoc chup
        // lai ngay tai thoi diem contextmenu xay ra, xem onContextMenu ben
        // duoi) - bam vao day se gui mat khau THAT ve main process de luu
        // ngay, khong qua bat ky co che doan/hang doi nao ca.
        var saveRow = document.createElement('div');
        saveRow.textContent = 'Luu tai khoan/mat khau hien tai (' + current.username + ')';
        saveRow.title = 'Luu ngay tai khoan va mat khau ban vua go, khong can doi dang nhap xong';
        saveRow.style.cssText = 'padding:8px 12px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#7CFC9A;font-weight:bold;border-bottom:1px solid #3a4051;';
        saveRow.addEventListener('mouseenter', function () { saveRow.style.background = '#363c4d'; });
        saveRow.addEventListener('mouseleave', function () { saveRow.style.background = 'transparent'; });
        saveRow.addEventListener('mousedown', function (e) {
          e.preventDefault();
          console.log('__HTHV4_PWSAVE_NOW__' + JSON.stringify({
            origin: location.origin,
            username: current.username,
            password: current.password,
          }));
          removeDropdown();
        });
        box.appendChild(saveRow);
      }
      if (candidates.length) {
        var header = document.createElement('div');
        header.textContent = 'Chon tai khoan da luu';
        header.style.cssText = 'padding:6px 12px;color:#9aa1b1;font-size:11px;border-bottom:1px solid #3a4051;';
        box.appendChild(header);
        candidates.forEach(function (c) {
          var row = document.createElement('div');
          row.textContent = c.username;
          row.style.cssText = 'padding:8px 12px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
          row.addEventListener('mouseenter', function () { row.style.background = '#363c4d'; });
          row.addEventListener('mouseleave', function () { row.style.background = 'transparent'; });
          // Dung "mousedown" (khong phai "click") va preventDefault de dropdown
          // khong bi dong truoc do do input bi mat focus (blur) truoc khi kip
          // dang ky lua chon.
          row.addEventListener('mousedown', function (e) {
            e.preventDefault();
            console.log('__HTHV4_PWPICK__' + JSON.stringify({ id: c.id }));
            removeDropdown();
          });
          box.appendChild(row);
        });
      }
      document.body.appendChild(box);
      // Dat vi tri SAU KHI da gan vao DOM de biet kich thuoc thuc te, tranh
      // dropdown bi trang man hinh (dac biet o gan canh phai/duoi).
      var vw = window.innerWidth, vh = window.innerHeight;
      var bw = box.offsetWidth, bh = box.offsetHeight;
      var left = Math.min(x, vw - bw - 4);
      var top = Math.min(y, vh - bh - 4);
      box.style.left = Math.max(4, left) + 'px';
      box.style.top = Math.max(4, top) + 'px';
      box.style.visibility = 'visible';
    }

    function setupPicker(pw) {
      if (!pw || pw.dataset.hthv4PickerSetup) return;
      pw.dataset.hthv4PickerSetup = '1';
      function findContainer(el) {
        if (!el) return document;
        var form = el.closest && el.closest('form');
        if (form) return form;
        var dialogLike = el.closest && el.closest(
          '[role="dialog"], [role="alertdialog"], [aria-modal="true"], .modal, .Modal, .dialog, .Dialog, .drawer, .Drawer, .popup, .Popup, .overlay, .Overlay'
        );
        return dialogLike || document;
      }
      var scope = findContainer(pw);
      var textInputs = Array.prototype.filter.call(scope.querySelectorAll('input'), function (i) {
        var t = (i.type || 'text').toLowerCase();
        return i !== pw && (t === 'text' || t === 'email' || t === 'tel');
      });
      var userInput = null;
      for (var i = 0; i < textInputs.length; i++) {
        if (pw.compareDocumentPosition(textInputs[i]) & Node.DOCUMENT_POSITION_PRECEDING) userInput = textInputs[i];
      }
      if (!userInput && textInputs.length) userInput = textInputs[textInputs.length - 1];

      function onContextMenu(e) {
        // Doc gia tri MOI NHAT cua 2 o ngay tai thoi diem bam chuot phai (KHONG
        // phai luc gan listener) - cho phep nguoi dung go xong roi bam chuot
        // phai bat cu luc nao de luu ngay, truoc khi bam nut dang nhap.
        var current = { username: (userInput ? userInput.value : '').trim(), password: pw.value };
        var candidates = window.__hthv4PwCandidates || [];
        var hasCurrent = !!(current.username && current.password);
        if (!candidates.length && !hasCurrent) {
          // Khong co gi de goi y (chua go gi, chua luu tai khoan nao cho
          // trang nay) - de trinh duyet hien menu chuot phai mac dinh nhu
          // binh thuong (vd "Dan") thay vi chan mat menu do vo ich.
          return;
        }
        e.preventDefault();
        showDropdownAt(e.clientX, e.clientY, current);
      }
      pw.addEventListener('contextmenu', onContextMenu);
      if (userInput) userInput.addEventListener('contextmenu', onContextMenu);
    }

    // Tim ca o type="password" LAN o da bi doi sang "text" boi nut "con mat"
    // hien/an mat khau cua chinh trang - xem giai thich PW_SELECTOR trong
    // CREDENTIAL_CAPTURE_SOURCE.
    setupPicker(document.querySelector('input[type="password"], input[data-hthv4-pwtag]'));

    if (!window.__hthv4PwPickerGlobalHooked) {
      window.__hthv4PwPickerGlobalHooked = true;
      document.addEventListener('mousedown', function (e) {
        if (e.target && e.target.closest && e.target.closest('#__hthv4_pw_picker__')) return;
        removeDropdown();
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') removeDropdown();
      });
    }
  } catch (err) {}
})();
`;
}

// Mot thong bao nho, tam thoi (tu bien mat sau ~2.5 giay, khong can nguoi
// dung bam gi ca) de xac nhan cho nguoi dung biet thao tac "Luu tai khoan/mat
// khau hien tai" (chuot phai) da luu THANH CONG - vi thao tac nay khong co
// phan hoi nao khac tren giao dien (khac voi banner hoi luu binh thuong, luon
// can nguoi dung bam "Co"/"Khong").
function buildSaveNowToastScript(username) {
  return `
(function () {
  try {
    var old = document.getElementById('__hthv4_pw_savenow_toast__');
    if (old) old.remove();
    var toast = document.createElement('div');
    toast.id = '__hthv4_pw_savenow_toast__';
    toast.textContent = 'Da luu tai khoan "' + ${JSON.stringify(username)} + '"';
    toast.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;background:#1f7a3f;color:#fff;padding:10px 16px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.3);font-family:Arial,sans-serif;font-size:13px;font-weight:bold;';
    document.body.appendChild(toast);
    setTimeout(function () { if (toast && toast.parentNode) toast.remove(); }, 2500);
  } catch (err) {}
})();
`;
}

// Thiet lap moc chuot-phai tren o tai khoan/mat khau cho tab. LUON thiet lap
// (khong con doi phai co tu 2 tai khoan da luu tro len nhu truoc) vi chuot
// phai gio con dung de "Luu tai khoan/mat khau hien tai NGAY" (xem
// buildAccountPickerScript/showDropdownAt) - tinh nang nay can dung duoc ke
// ca khi trang chua co tai khoan nao duoc luu ca. Danh sach "cac tai khoan da
// luu" ben trong dropdown van chi hien khi co it nhat 1 tai khoan.
function trySetupAccountPicker(tab) {
  try {
    const wc = tab.view.webContents;
    const url = wc.getURL();
    if (!url || !/^https?:/i.test(url)) return;
    const origin = new URL(url).origin;
    const creds = getCredentialsForOrigin(origin);
    const candidates = creds
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((c) => ({ id: c.id, username: c.username }));
    wc.executeJavaScript(buildAccountPickerScript(candidates)).catch(() => {});
  } catch (err) {
    console.error('[passwords] Loi thiet lap danh sach chon tai khoan:', err);
  }
}

// Ve mot thanh thong bao nho (giong banner "Luu mat khau?" cua Chrome) o goc
// tren-phai trang, hoi nguoi dung co muon luu tai khoan vua dang nhap khong.
// Tu bien mat sau 15 giay neu khong ai bam gi (tranh de banner "dinh" mai
// tren man hinh lam viec cua HIS) - luc do cung bao ve main process biet de
// chuyen sang cap tiep theo dang cho trong hang doi (neu co).
//
// QUAN TRONG: toan bo payload (origin/username/password) duoc "dong goi"
// NGAY TRONG closure cua banner nay va gui lai NGUYEN VEN khi nguoi dung bam
// nut - main process khong con doc lai tu 1 o nho dung chung
// (tab.pendingCredentialCapture) nua. Ly do: neu 2 lan dang nhap xay ra gan
// nhau (vd dang nhap he thong chinh xong, ngay sau do dang nhap tiep vao 1
// widget/he thong ben thu 3 nhung trong CUNG 1 trang), o nho dung chung se bi
// GHI DE boi lan bat thu 2 truoc khi banner cua lan thu nhat kip duoc xu ly -
// dan toi bam "Luu" tren banner (hien dang hoi ve tai khoan A) nhung lai vo
// tinh luu NHAM tai khoan B (cai dang nam trong o nho luc do). Gan payload
// vao chinh banner tranh hoan toan loi nay.
function buildSaveBannerScript(payload) {
  const safe = JSON.stringify(payload);
  return `
(function () {
  try {
    var old = document.getElementById('__hthv4_pw_banner__');
    if (old) old.remove();
    var payload = ${safe};
    var bar = document.createElement('div');
    bar.id = '__hthv4_pw_banner__';
    bar.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;background:#2a2f3d;color:#e8eaf0;border:1px solid #3a4051;border-radius:8px;padding:12px 14px;font-family:Arial,sans-serif;font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,.3);max-width:300px;';
    var msg = document.createElement('div');
    msg.style.cssText = 'margin-bottom:10px;';
    msg.textContent = 'Luu mat khau cho tai khoan "' + payload.username + '" tren trang nay?';
    bar.appendChild(msg);
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';
    function mkBtn(label, primary) {
      var b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = 'padding:6px 12px;border-radius:5px;border:1px solid #3a4051;cursor:pointer;font-size:12px;' + (primary ? 'background:#3b82f6;color:#fff;border-color:#3b82f6;' : 'background:transparent;color:#e8eaf0;');
      return b;
    }
    var closed = false;
    function reportAndClose(action) {
      if (closed) return;
      closed = true;
      console.log('__HTHV4_PWSAVE_ACTION__' + JSON.stringify({
        action: action,
        origin: payload.origin,
        username: payload.username,
        password: payload.password,
      }));
      if (bar.parentNode) bar.remove();
    }
    var saveBtn = mkBtn('Luu mat khau', true);
    var noBtn = mkBtn('Khong, cam on', false);
    saveBtn.addEventListener('click', function () { reportAndClose('save'); });
    noBtn.addEventListener('click', function () { reportAndClose('dismiss'); });
    row.appendChild(noBtn);
    row.appendChild(saveBtn);
    bar.appendChild(row);
    document.body.appendChild(bar);
    setTimeout(function () { reportAndClose('timeout'); }, 15000);
  } catch (err) {}
})();
`;
}

// Hien banner cho MUC DAU TIEN dang cho trong hang doi cua tab (tab.credentialQueue),
// neu hien khong co banner nao khac dang mo (tab.bannerActivePayload). Duoc
// goi tu nhieu noi: ngay sau khi trang moi tai xong (did-finish-load), sau
// khi 1 banner truoc do vua duoc dong (save/dismiss/timeout), hoac tu hen
// gio du phong cua tung muc trong hang doi (xem queueCredentialCapture).
function offerNextInQueue(tab) {
  if (tab.bannerActivePayload) return; // dang co 1 banner khac mo, doi no xong da
  while (tab.credentialQueue.length) {
    const entry = tab.credentialQueue[0];
    const { payload } = entry;
    const existing = findCredential(payload.origin, payload.username);
    if (existing) {
      const currentPw = decryptSecret(existing.secret);
      if (currentPw === payload.password) {
        // Da luu dung mat khau nay roi - bo qua muc nay, thu muc ke tiep.
        if (entry.fallbackTimer) clearTimeout(entry.fallbackTimer);
        tab.credentialQueue.shift();
        continue;
      }
    }
    tab.bannerActivePayload = payload;
    tab.view.webContents.executeJavaScript(buildSaveBannerScript(payload)).catch(() => {});
    return;
  }
}

// Them 1 cap tai khoan/mat khau vua bat duoc vao HANG DOI cho tab (thay vi
// ghi de 1 o nho duy nhat) - dam bao KHONG lan nao bi "mat" neu nguoi dung
// dang nhap nhieu lan gan nhau (vd he thong chinh + 1 widget/he thong ben
// thu 3 nhung trong cung 1 trang). Moi muc trong hang doi co hen gio rieng
// (khong dung chung 1 bien nhu truoc) de kiem tra form cua DUNG muc do con
// hien thi hay khong (xem giai thich chi tiet trong nhanh PWCAP ben duoi).
function queueCredentialCapture(tab, payload) {
  const dupIndex = tab.credentialQueue.findIndex(
    (q) =>
      q.payload.origin === payload.origin &&
      q.payload.username === payload.username &&
      q.payload.password === payload.password
  );
  let entry;
  if (dupIndex !== -1) {
    entry = tab.credentialQueue[dupIndex];
    if (entry.fallbackTimer) clearTimeout(entry.fallbackTimer);
  } else if (tab.bannerActivePayload && tab.bannerActivePayload.username === payload.username && tab.bannerActivePayload.password === payload.password && tab.bannerActivePayload.origin === payload.origin) {
    return; // dang hoi dung cap nay roi, khong can xep hang lai
  } else {
    entry = { payload };
    tab.credentialQueue.push(entry);
  }
  entry.fallbackTimer = setTimeout(async () => {
    entry.fallbackTimer = null;
    // Truong hop binh thuong (form dang nhap kieu cu, co dieu huong sang
    // trang khac sau khi dang nhap): banner duoc hien qua did-finish-load
    // (goi offerNextInQueue). NHUNG voi modal/drawer xu ly bang JS/AJAX,
    // trang co the KHONG dieu huong di dau ca - did-finish-load se khong
    // bao gio bat lai. Vi vay dat them hen gio du phong nay: neu sau ~1.8
    // giay ma o mat khau tren trang VAN con HIEN THI (khong bi an/go bo) va
    // VAN con dung nguyen gia tri vua bat duoc, nhieu kha nang dang nhap
    // that bai/form van con mo - bo qua muc nay; nguoc lai moi dua vao
    // hang doi de hoi (offerNextInQueue tu quyet dinh co hien ngay khong
    // tuy con banner nao khac dang mo hay khong).
    try {
      const stillSameForm = await tab.view.webContents
        .executeJavaScript(
          `(function(){
            // Kiem tra "con hien" chinh xac hon f.offsetParent !== null: nhieu
            // thu vien modal/drawer/tab hien dai an noi dung bang
            // visibility:hidden hoac opacity:0 (Vue v-show, cac component tu
            // build...) thay vi display:none/go khoi DOM - luc do offsetParent
            // VAN khac null (phan tu van chiem cho trong layout) du mat thuong
            // khong thay gi, khien app tuong nham form van con mo va bo qua
            // khong hoi luu mat khau du dang nhap da thanh cong. Ham nay leo
            // len toan bo cha de bat ca 3 kieu an: display:none, visibility:
            // hidden, opacity:0, va ca truong hop phan tu bi go hoan toan
            // khoi DOM (isConnected = false).
            function isReallyVisible(el) {
              if (!el || !el.isConnected) return false;
              var rect = el.getBoundingClientRect();
              if (rect.width <= 0 && rect.height <= 0) return false;
              var node = el;
              while (node && node.nodeType === 1) {
                var cs = window.getComputedStyle(node);
                if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
                node = node.parentElement;
              }
              return true;
            }
            // Tim ca o type="password" LAN o da tung la password nhung bi
            // doi sang "text" boi nut "con mat" hien/an mat khau cua chinh
            // trang (data-hthv4-pwtag do CREDENTIAL_CAPTURE_SOURCE danh dau) -
            // neu chi tim type="password" thi ngay khi nguoi dung bam "con
            // mat" de xem lai mat khau vua go, o do bien mat khoi truy van
            // nay, form bi tuong nham la "da dong" du van con mo nguyen.
            var fields = document.querySelectorAll('input[type="password"], input[data-hthv4-pwtag]');
            var dbg = function(msg) { try { console.log('[HTHV4-DEBUG] (kiem tra hoi luu, ~1.8s sau khi bat duoc) ' + msg); } catch (e) {} };
            if (!fields.length) {
              dbg('KHONG con tim thay o mat khau nao tren trang nua (co the do container/iframe chua no da bi go bo) => coi nhu form da dong, SE tien hanh hoi luu.');
              return false;
            }
            for (var i=0;i<fields.length;i++){
              var f = fields[i];
              var vis = isReallyVisible(f);
              var sameVal = f.value === ${JSON.stringify(payload.password)};
              if (vis && sameVal) {
                dbg('1 o mat khau VAN con hien thi tren man hinh VA gia tri KHONG doi so voi luc bat duoc => cho la dang nhap that bai/form van con mo, SE KHONG hoi luu. Neu ban chac chan da dang nhap thanh cong va form/modal nay van o nguyen tai cho (khong tu dong dong/an di), day chinh la nguyen nhan.');
                return true;
              }
            }
            dbg('O mat khau da an di hoac gia tri da doi khac luc bat duoc => coi nhu form da dong/dang nhap xong, SE tien hanh hoi luu.');
            return false;
          })();`
        )
        .catch(() => false);
      if (stillSameForm) {
        const idx = tab.credentialQueue.indexOf(entry);
        if (idx !== -1) tab.credentialQueue.splice(idx, 1);
        return;
      }
    } catch (err) {}
    offerNextInQueue(tab);
  }, 1800);
  // LUU Y: KHONG goi offerNextInQueue(tab) ngay tai day. Banner chi duoc
  // hien qua 1 trong 2 con duong: (1) did-finish-load, khi trang THAT SU
  // dieu huong sang trang khac sau khi dang nhap (form kieu cu); hoac (2)
  // hen gio du phong ~1.8 giay o tren, SAU KHI da kiem tra "form co con hien
  // thi hay khong" (modal/drawer/SPA khong dieu huong). Neu goi ngay o day,
  // banner se hien LAP TUC ngay luc vua bat duoc, bo qua hoan toan buoc
  // kiem tra dang nhap that bai/thanh cong o tren - day chinh la loi da gap
  // truoc do (banner van hien du dang nhap that bai trong modal/drawer).
}

// ==== Ho tro NHIEU cua so trinh duyet cung luc: cua so CHINH (session mac
// dinh, luu ben vung nhu tu truoc gio) VA bat ky so luong "Cua so an danh"
// nao nguoi dung tu mo them (xem createBrowserWindowContext, openIncognito
// window action, o cuoi file). Moi cua so co bo tab/BrowserView, danh sach
// tab, tab dang active... HOAN TOAN RIENG - khong con la bien global dung
// chung nhu truoc (chi phu hop khi app luon co dung 1 cua so). ====

// "ctx" (window context) la 1 object gom toan bo trang thai + ham quan ly
// cho DUNG 1 cua so: { win, incognito, partition, tabs, activeTabId,
// tabIdCounter, getActiveTab, createTab, switchToTab, closeTab, ... }.
// windowContexts anh xa webContents.id CUA CHINH TRANG index.html dang chay
// trong 1 cua so -> ctx tuong ung - dung de 1 IPC handler DUY NHAT (dang ky 1
// lan o muc module) biet chinh xac IPC do den tu cua so nao, tra ve dung
// ctx cua cua so do (xem ctxForEvent ben duoi).
const windowContexts = new Map();
function ctxForEvent(event) {
  return windowContexts.get(event.sender.id) || null;
}

// Cua so CHINH (session mac dinh, luu ben vung) - LUON chi co 1 cai, dung cho
// cac hanh dong toan app khong gan voi 1 cua so cu the (dialog tu dong cap
// nhat...). Cac "Cua so an danh" KHONG bao gio duoc gan vao 2 bien nay.
let mainWindow;
let primaryCtx = null;

function normalizeUrl(input) {
  let value = String(input || '').trim();
  if (!/^https?:\/\//i.test(value)) {
    value = 'https://' + value;
  }
  return value;
}

// Chuan hoa 1 chuoi nguoi dung nhap (co the la ca URL day du, hoac chi ten
// mien) thanh dung "origin" (vd "https://hthv4.vnpthis.vn") de luu/tim mat
// khau - dung khi nguoi dung TU TAY them 1 muc mat khau moi trong Settings.
// Tra ve null neu khong dung duoc thanh URL hop le.
function normalizeOrigin(input) {
  try {
    return new URL(normalizeUrl(input)).origin;
  } catch (err) {
    return null;
  }
}

function toggleContentDevTools(view) {
  const wc = view.webContents;
  if (wc.isDevToolsOpened()) wc.closeDevTools();
  else wc.openDevTools({ mode: 'detach' });
}

// Chon 1 man hinh KHONG PHAI man hinh chinh (primary) trong danh sach man
// hinh dang co. Tach thanh ham thuan (nhan vao danh sach + id man hinh
// chinh) de de kiem thu doc lap voi phan cung that.
function pickSecondDisplay(displays, primaryId) {
  return displays.find((d) => d.id !== primaryId) || null;
}

// Tao 1 "ngu canh cua so" MOI - either cua so CHINH (incognito=false, goi 1
// lan duy nhat luc app khoi dong) hoac 1 "Cua so an danh" MOI (incognito=
// true, goi moi lan nguoi dung bam nut/menu tuong ung, khong gioi han so
// luong). Tra ve ctx (dung cho cac IPC test-hook, va de createWindow() gan
// vao mainWindow/primaryCtx khi la cua so chinh).
function createBrowserWindowContext({ incognito }) {
  // "partition" quyet dinh session nao duoc dung cho MOI BrowserView (tab)
  // tao ra trong cua so nay:
  //  - Cua so CHINH: KHONG dat "partition" (giu nguyen undefined) -> BrowserView
  //    dung session MAC DINH cua Electron (session.defaultSession) nhu tu
  //    truoc gio - luu ben vung xuong dia, hanh vi KHONG doi so voi truoc.
  //  - Cua so AN DANH: moi cua so duoc cap 1 ten partition NGAU NHIEN/DUY
  //    NHAT rieng (vd "incognito-1234-ab12cd"), KHONG mang tien to "persist:"
  //    - day chinh la dieu kien de Electron coi day la 1 session "in-memory":
  //    Cookie/LocalStorage/SessionStorage/Cache/IndexedDB cua session nay CHI
  //    ton tai trong bo nho (RAM), khong bao gio ghi xuong dia. Vi MOI cua so
  //    an danh co 1 ten partition khac nhau, dung mo bao nhieu cua so an danh
  //    cung luc (5, 10, hay nhieu hon) thi tung cua so van co 1 "ngan" du
  //    lieu rieng, khong dung chung/de len nhau, va cung khong dung chung voi
  //    cua so chinh.
  const partition = incognito
    ? `incognito-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    : null;

  const ctx = {
    win: null,
    incognito: !!incognito,
    partition,
    tabs: [], // [{ id, view, title, credentialQueue, bannerActivePayload }]
    activeTabId: null,
    tabIdCounter: 0,
  };

  function getActiveTab() {
    return ctx.tabs.find((t) => t.id === ctx.activeTabId) || null;
  }

  function updateBrowserViewBounds() {
    const tab = getActiveTab();
    if (!ctx.win || ctx.win.isDestroyed() || !tab) return;
    const { width, height } = ctx.win.getContentBounds();
    tab.view.setBounds({
      x: 0,
      y: TOP_OFFSET,
      width,
      height: Math.max(0, height - TOP_OFFSET),
    });
  }

  // Loi da biet cua BrowserView trong Electron: co luc noi dung da tai xong
  // (JS chay binh thuong) nhung KHONG duoc ve (paint) len man hinh cho toi
  // khi co mot thao tac ep no ve lai. Cach khac phuc pho bien: "nhun" kich
  // thuoc view di 1px roi tra ve ngay, buoc trinh compositor phai ve lai
  // toan bo.
  function nudgeRepaint(view) {
    if (!ctx.win || ctx.win.isDestroyed() || !view) return;
    const b = view.getBounds();
    if (b.height <= 1) return;
    view.setBounds({ ...b, height: b.height - 1 });
    setTimeout(() => {
      view.setBounds(b);
    }, 30);
  }

  function sendNavState() {
    if (!ctx.win || ctx.win.isDestroyed()) return;
    const tab = getActiveTab();
    if (!tab) return;
    const wc = tab.view.webContents;
    ctx.win.webContents.send('nav:state', {
      url: wc.getURL(),
      title: wc.getTitle(),
      canGoBack: wc.canGoBack(),
      canGoForward: wc.canGoForward(),
      loading: wc.isLoading(),
    });
  }

  function sendTabsState() {
    if (!ctx.win || ctx.win.isDestroyed()) return;
    ctx.win.webContents.send(
      'tabs:state',
      ctx.tabs.map((t) => ({
        id: t.id,
        title: t.title || t.view.webContents.getTitle() || 'Tab moi',
        url: t.view.webContents.getURL(),
        active: t.id === ctx.activeTabId,
      }))
    );
  }

  // Xu ly cac phim tat lien quan toi noi dung trang: F12/Ctrl+Shift+I (mo
  // DevTools cua tab) va Ctrl+=/Ctrl+-/Ctrl+0 (zoom in/out/reset) - giong quy
  // uoc pho bien cua cac trinh duyet (Chrome, Edge, Firefox).
  const contentShortcuts = (event, input) => {
    const isF12 = input.key === 'F12';
    const isCtrlShiftI = input.control && input.shift && (input.key === 'I' || input.key === 'i');
    if ((isF12 || isCtrlShiftI) && input.type === 'keyDown') {
      const tab = getActiveTab();
      if (tab) toggleContentDevTools(tab.view);
      return;
    }
    if (input.control && input.type === 'keyDown') {
      if (input.key === '+' || input.key === '=') {
        zoomIn();
      } else if (input.key === '-') {
        zoomOut();
      } else if (input.key === '0') {
        zoomReset();
      }
    }
  };

  // ---- Phong to/thu nho noi dung trang (zoom) - zoom rieng cho tung tab, ----
  // giong hanh vi cua Chrome (moi tab/website nho muc zoom cua rieng no).
  function sendZoomState() {
    if (!ctx.win || ctx.win.isDestroyed()) return;
    const tab = getActiveTab();
    if (!tab) return;
    const percent = Math.round(tab.view.webContents.getZoomFactor() * 100);
    ctx.win.webContents.send('zoom:state', { percent });
  }
  function zoomIn() {
    const tab = getActiveTab();
    if (!tab) return;
    const wc = tab.view.webContents;
    wc.setZoomFactor(Math.min(ZOOM_MAX, wc.getZoomFactor() + ZOOM_STEP));
    sendZoomState();
  }
  function zoomOut() {
    const tab = getActiveTab();
    if (!tab) return;
    const wc = tab.view.webContents;
    wc.setZoomFactor(Math.max(ZOOM_MIN, wc.getZoomFactor() - ZOOM_STEP));
    sendZoomState();
  }
  function zoomReset() {
    const tab = getActiveTab();
    if (!tab) return;
    tab.view.webContents.setZoomFactor(1.0);
    sendZoomState();
  }

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
    // CREDENTIAL_CAPTURE_SOURCE chi can cho trang/iframe (co DOM/form), khong
    // can tiem vao Worker (khong co form) - nen CHI ghep vao nhanh Page o day,
    // khong ghep vao Runtime.evaluate cua nhanh Target.attachedToTarget ben tren.
    await wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
      source: POLYFILL_SOURCE + '\n' + CREDENTIAL_CAPTURE_SOURCE,
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
    if (ctx.tabs.length < MAX_TABS) {
      createTab(url);
    } else {
      shell.openExternal(url);
    }
  }

  function createTab(url) {
    if (ctx.tabs.length >= MAX_TABS) return null;

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
        // Cua so AN DANH: gan MOI BrowserView vao dung 1 session rieng (bien
        // "partition" cua ctx nay, xem giai thich o createBrowserWindowContext)
        // - day la nguon goc THAT SU cua viec cach ly Cookie/LocalStorage/
        // SessionStorage/Cache/IndexedDB, khong phai chi UI. Cua so CHINH:
        // khong dat gi ca, giu nguyen hanh vi cu (session mac dinh, dung
        // chung cho moi tab, luu ben vung).
        ...(ctx.partition ? { partition: ctx.partition } : {}),
      },
    });
    view.setBackgroundColor('#ffffff');

    const tabId = ++ctx.tabIdCounter;
    const tab = { id: tabId, view, title: 'Dang tai...', credentialQueue: [], bannerActivePayload: null };
    ctx.tabs.push(tab);

    const wc = view.webContents;
    wc.on('did-start-loading', () => {
      if (tabId === ctx.activeTabId) sendNavState();
      sendTabsState();
    });
    wc.on('did-stop-loading', () => {
      if (tabId === ctx.activeTabId) {
        sendNavState();
        nudgeRepaint(view);
      }
      sendTabsState();
    });
    wc.on('did-navigate', () => {
      if (tabId === ctx.activeTabId) sendNavState();
      sendTabsState();
      // Dieu huong SANG TRANG KHAC (khac voi did-navigate-in-page, chi doi
      // hash/pushState) se pha huy toan bo DOM/JS cua trang cu - neu dang co
      // 1 banner "Luu mat khau?" hien tren trang cu ma nguoi dung CHUA kip
      // bam gi (chua Luu, chua "Khong, cam on"), banner do coi nhu da "chet"
      // theo trang cu, se KHONG BAO GIO gui duoc tin nhan phan hoi ve main
      // process nua. Neu khong giai phong o day, "khoa" tab.bannerActivePayload
      // se bi ket VINH VIEN (khong bao gio co gia tri null tro lai), khien MOI
      // lan dang nhap tiep theo tren tab nay - du la trang nao, tai khoan
      // nao - deu khong bao gio duoc hoi luu nua. Giai phong khoa o day de
      // offerNextInQueue (goi ngay sau, tu did-finish-load) co the thu hien
      // lai dung muc dang cho do (hoac muc tiep theo trong hang doi) tren
      // trang MOI.
      tab.bannerActivePayload = null;
    });
    wc.on('did-navigate-in-page', () => {
      if (tabId === ctx.activeTabId) sendNavState();
      sendTabsState();
    });
    wc.on('page-title-updated', () => {
      tab.title = wc.getTitle();
      sendTabsState();
      if (tabId === ctx.activeTabId) {
        sendNavState();
        if (ctx.win && !ctx.win.isDestroyed()) {
          const base = tab.title ? `${tab.title} - HTHV4 Browser` : 'HTHV4 Browser';
          // Them hau to "(An danh)" vao tieu de cua so an danh de nguoi dung
          // luon nhan ra ngay minh dang o cua so nao (giong Chrome/Edge).
          ctx.win.setTitle(ctx.incognito ? `${base} (An danh)` : base);
        }
      }
    });

    // Chu dong dua focus vao view ngay khi trang tai xong lan dau (xem giai
    // thich o backgroundThrottling ben tren).
    wc.once('did-finish-load', () => {
      if (tabId === ctx.activeTabId) {
        wc.focus();
        nudgeRepaint(view);
      }
    });

    // Sau MOI lan trang tai xong (khac voi .once o tren): thu tu dong dien
    // tai khoan/mat khau da luu cho trang nay, va neu dang co cap tai khoan
    // nao dang cho trong hang doi (vd trang dang nhap redirect sang trang
    // chinh sau khi dang nhap thanh cong) thi thu hien banner hoi luu.
    wc.on('did-finish-load', () => {
      tryAutofill(tab);
      trySetupAccountPicker(tab);
      offerNextInQueue(tab);
    });

    wc.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      console.error('[nav] did-fail-load:', { errorCode, errorDescription, validatedURL, isMainFrame });
    });
    wc.on('render-process-gone', (event, details) => {
      console.error('[nav] render-process-gone:', details);
    });
    wc.on('console-message', (event, level, message, line, sourceId) => {
    if (typeof message === 'string' && message.indexOf('__HTHV4_PWCAP__') === 0) {
      // Ket qua bat duoc tu CREDENTIAL_CAPTURE_SOURCE (submit form / click nut
      // dang nhap / phim Enter) - CHI xep vao hang doi trong bo nho (khong
      // ghi xuong dia ngay, khong in ra console cua app de tranh lo mat khau
      // vao log). Chi ghi xuong dia that su khi nguoi dung bam "Luu mat
      // khau" tren banner tuong ung (xem nhanh PWSAVE_ACTION ben duoi).
      try {
        const payload = JSON.parse(message.slice('__HTHV4_PWCAP__'.length));
        queueCredentialCapture(tab, payload);
      } catch (err) {}
      return;
    }
    if (typeof message === 'string' && message.indexOf('__HTHV4_PWFIELD_DETECTED__') === 0) {
      // O mat khau moi xuat hien tren trang SAU KHI da tai xong (vd modal/
      // drawer dang nhap chi duoc dung len khi nguoi dung bam nut mo popup) -
      // thu tu dong dien lai ngay (idempotent, vo hai neu khong co gi de dien)
      // va thiet lap lai dropdown chon tai khoan cho o moi xuat hien do.
      tryAutofill(tab);
      trySetupAccountPicker(tab);
      return;
    }
    if (typeof message === 'string' && message.indexOf('__HTHV4_PWPICK__') === 0) {
      // Nguoi dung bam chon 1 tai khoan tu dropdown - giai ma DUNG mat khau
      // cua tai khoan do va dien de (force = true, ghi de ca khi o dang co
      // gia tri khac). Cham nhe vao updatedAt (qua upsertCredential) de lan
      // tu dong dien tiep theo tren trang nay uu tien dung tai khoan vua
      // chon - giong hanh vi "tai khoan dung gan day nhat" da co san.
      try {
        const { id } = JSON.parse(message.slice('__HTHV4_PWPICK__'.length));
        const entry = credentialStore.get('entries').find((e) => e.id === id);
        if (entry) {
          const password = decryptSecret(entry.secret);
          if (password) {
            tab.view.webContents
              .executeJavaScript(buildAutofillScript(entry.username, password, { force: true }))
              .catch(() => {});
            upsertCredential({ origin: entry.origin, username: entry.username, password });
          }
        }
      } catch (err) {}
      return;
    }
    if (typeof message === 'string' && message.indexOf('__HTHV4_PWSAVE_NOW__') === 0) {
      // Nguoi dung bam CHUOT PHAI -> "Luu tai khoan/mat khau hien tai" khi
      // dang go dang nhap (xem buildAccountPickerScript) - luu THANG xuong
      // dia NGAY LAP TUC, KHONG qua hang doi/banner/heuristic "con hien thi
      // hay khong" nao ca, vi day la hanh dong chu dong, ro rang cua nguoi
      // dung (khong can doan). Sau khi luu, thiet lap lai dropdown chon tai
      // khoan (de danh sach "tai khoan da luu" duoc cap nhat ngay neu day la
      // tai khoan moi/thu 2 tro len) va bao cho trang biet da luu xong bang 1
      // thong bao nho, tam thoi.
      try {
        const action = JSON.parse(message.slice('__HTHV4_PWSAVE_NOW__'.length));
        if (action && action.origin && action.username && action.password) {
          upsertCredential({ origin: action.origin, username: action.username, password: action.password });
          trySetupAccountPicker(tab);
          tab.view.webContents.executeJavaScript(buildSaveNowToastScript(action.username)).catch(() => {});
        }
      } catch (err) {}
      return;
    }
    if (typeof message === 'string' && message.indexOf('__HTHV4_PWSAVE_ACTION__') === 0) {
      // Banner tu gui lai NGUYEN VEN payload cua chinh no (xem giai thich
      // trong buildSaveBannerScript) - luon ghi dung cap tai khoan nguoi
      // dung dang thay tren man hinh, du hang doi ben duoi co thay doi gi
      // giua luc banner hien va luc nguoi dung bam nut hay khong.
      try {
        const action = JSON.parse(message.slice('__HTHV4_PWSAVE_ACTION__'.length));
        if (action.action === 'save') {
          upsertCredential({ origin: action.origin, username: action.username, password: action.password });
        }
      } catch (err) {}
      // Bo entry vua duoc xu ly (neu con trong hang doi) va mo duong cho
      // banner tiep theo (neu co) duoc hien ra.
      const idx = tab.credentialQueue.findIndex((q) => q.payload === tab.bannerActivePayload);
      if (idx !== -1) {
        if (tab.credentialQueue[idx].fallbackTimer) clearTimeout(tab.credentialQueue[idx].fallbackTimer);
        tab.credentialQueue.splice(idx, 1);
      }
      tab.bannerActivePayload = null;
      offerNextInQueue(tab);
      return;
    }
    console.log(`[content console] ${sourceId}:${line} -`, message);
  });

    wc.on('before-input-event', contentShortcuts);
    wc.on('zoom-changed', () => {
      if (tabId === ctx.activeTabId) sendZoomState();
    });

    // Click phai chuot: them muc "Mo lien ket trong tab moi" khi bam vao mot
    // the <a>. Bi vo hieu hoa (mau xam) neu da dat toi gioi han MAX_TABS.
    wc.on('context-menu', (event, params) => {
      const items = [];
      if (params.linkURL) {
        items.push({
          label:
            ctx.tabs.length < MAX_TABS
              ? 'Mo lien ket trong tab moi'
              : `Mo lien ket trong tab moi (da dat toi da ${MAX_TABS} tab)`,
          enabled: ctx.tabs.length < MAX_TABS,
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
      Menu.buildFromTemplate(items).popup({ window: ctx.win });
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
    const target = ctx.tabs.find((t) => t.id === tabId);
    if (!target || !ctx.win || ctx.win.isDestroyed()) return;

    // Go tat ca cac view dang gan (thuong chi co 1) truoc khi gan view moi -
    // dung addBrowserView/removeBrowserView (khac setBrowserView) de webContents
    // cua cac tab khac khong bi huy, giu nguyen trang thai khi quay lai.
    ctx.win.getBrowserViews().forEach((v) => ctx.win.removeBrowserView(v));
    ctx.win.addBrowserView(target.view);
    ctx.activeTabId = tabId;
    updateBrowserViewBounds();
    target.view.webContents.focus();
    sendNavState();
    sendTabsState();
    sendZoomState();
  }

  function closeTab(tabId) {
    if (ctx.tabs.length <= 1) return; // luon giu lai it nhat 1 tab
    const index = ctx.tabs.findIndex((t) => t.id === tabId);
    if (index === -1) return;
    const [closed] = ctx.tabs.splice(index, 1);

    if (ctx.win && !ctx.win.isDestroyed()) {
      ctx.win.removeBrowserView(closed.view);
    }

    if (ctx.activeTabId === tabId) {
      const next = ctx.tabs[index] || ctx.tabs[index - 1] || ctx.tabs[0];
      if (next) switchToTab(next.id);
    } else {
      sendTabsState();
    }
  }

  // Click phai vao 1 tab tren thanh tab -> hien menu chuot phai voi lua chon
  // "Mo tab nay o man hinh thu 2". Neu may chi co 1 man hinh, muc nay bi mo/
  // vo hieu hoa kem ghi chu.
  function showTabContextMenu(tabId) {
    const tab = ctx.tabs.find((t) => t.id === tabId);
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

    Menu.buildFromTemplate(items).popup({ window: ctx.win });
  }

  // "Dua" mot tab ra khoi cua so nay, hien thi toan man hinh (fullscreen)
  // tren man hinh vat ly thu 2. Day la CHUYEN (khong phai sao chep): BrowserView
  // cua tab do duoc go khoi cua so nay va gan sang cua so moi, giu nguyen
  // toan bo trang thai (dang dang nhap, vi tri cuon, form dang nhap do...),
  // khong tai lai trang. Khi nguoi dung dong cua so man hinh thu 2 (Alt+F4,
  // hoac phim Esc - xem popoutEscHandler ben duoi), tab duoc tra lai vao danh
  // sach tab cua cua so nay, KHONG bi mat.
  function openTabOnSecondDisplay(tabId) {
    const index = ctx.tabs.findIndex((t) => t.id === tabId);
    if (index === -1) return;

    const displays = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay();
    const target = pickSecondDisplay(displays, primary.id);
    if (!target) {
      dialog.showMessageBox(ctx.win, {
        type: 'warning',
        title: 'Khong tim thay man hinh thu 2',
        message: 'May tinh hien chi phat hien duoc 1 man hinh.',
        detail: 'Hay ket noi them mot man hinh (mo rong desktop, khong phai che do nhan ban) roi thu lai.',
      });
      return;
    }

    const [tab] = ctx.tabs.splice(index, 1);
    if (ctx.win && !ctx.win.isDestroyed()) {
      ctx.win.removeBrowserView(tab.view);
    }
    if (ctx.activeTabId === tabId) {
      ctx.activeTabId = null;
      const next = ctx.tabs[index] || ctx.tabs[index - 1] || ctx.tabs[0];
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
    // cua so goc - de nguoi dung khong bi "ket" trong 1 cua so fullscreen
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
      if (ctx.win && !ctx.win.isDestroyed()) {
        ctx.tabs.push(tab);
        switchToTab(tab.id);
      }
    });
  }

  function sendWindowState() {
    if (!ctx.win || ctx.win.isDestroyed()) return;
    ctx.win.webContents.send('win:state', { maximized: ctx.win.isMaximized() });
  }

  // ---- Tao cua so that (frame:false - toolbar/tabbar tu ve trong index.html,
  // giong het cua so chinh, ke ca voi Cua so an danh) ----
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    title: incognito ? 'HTHV4 Browser (An danh)' : 'HTHV4 Browser',
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  ctx.win = win;
  // Luu san webContents.id vao ctx: sau khi cua so bi destroy(), doc lai
  // win.webContents.id co the nem "Object has been destroyed" (webContents
  // cua chinh cua so/UI cung da bi huy luc nay) - can gia tri nay o cac noi
  // don dep/tra ve trang thai (vd handler 'closed', listWindowContexts) thay
  // vi doc lai tu win.webContents luc do.
  ctx.webContentsId = win.webContents.id;
  windowContexts.set(ctx.webContentsId, ctx);

  win.loadFile(path.join(__dirname, 'index.html'));
  win.webContents.on('before-input-event', contentShortcuts);
  // Bao trang thai maximize ban dau ngay khi toolbar da san sang, de icon
  // nut Phong to/Khoi phuc hien dung tu dau.
  win.webContents.once('did-finish-load', sendWindowState);

  win.on('resize', updateBrowserViewBounds);
  // Khong chi dua vao 'resize': tren mot so window manager (da phat hien luc
  // kiem thu tren Linux/fluxbox), goi maximize()/unmaximize() khong luon luon
  // phat sinh su kien 'resize' kem theo - phai tu goi lai updateBrowserViewBounds()
  // rieng o day de BrowserView khong bi "ket" o kich thuoc cu sau khi phong
  // to/khoi phuc cua so.
  win.on('maximize', () => {
    sendWindowState();
    updateBrowserViewBounds();
  });
  win.on('unmaximize', () => {
    sendWindowState();
    updateBrowserViewBounds();
  });
  // 'close' xay ra TRUOC khi cua so thuc su bi pha huy (khac voi 'closed' o
  // duoi) - BAT BUOC phai go BrowserView khoi cua so VA ngat CDP debugger
  // (attachPolyfillAndLoad co goi wc.debugger.attach() cho MOI tab, dung de
  // tiem polyfill/theo doi dang nhap) cua TUNG tab NGAY TAI DAY, TRUOC KHI
  // Electron tiep tuc pha huy cua so. Da xac nhan qua kiem thu: neu con
  // BrowserView dang gan (addBrowserView) VAO cua so luc no bi dong, VA/hoac
  // webContents cua no van con CDP debugger gan san, qua trinh dong cua so co
  // the bi "treo" VINH VIEN (khong bao gio hoan tat, "dong bang" toan bo tien
  // trinh chinh) - phai lam CA HAI buoc (go BrowserView + detach debugger)
  // truoc, thi dong cua so moi luon an toan, du nguoi dung dong bang nut X
  // tren toolbar, bang phim tat cua he dieu hanh, hay bang bat ky cach nao
  // khac.
  win.on('close', (e) => {
    // Dong voi debugger CDP con dinh (attachPolyfillAndLoad) co the treo ca
    // app neu chi goi debugger.detach() thang: Target.setAutoAttach voi
    // waitForDebuggerOnStart:true co the de lai cac child target (worker/
    // iframe) dang cho lenh dieu khien; detach() dot ngot khien Chromium
    // phai doi cac child session do phan hoi trong luc go bo, gay treo toan
    // bo tien trinh (IO thread). Fix: TRUOC khi detach(), goi
    // Target.setAutoAttach({autoAttach:false}) de Chromium chu dong tra ve
    // quyen dieu khien cho tat ca child target/nha may cua chung, roi moi
    // detach() va go BrowserView.
    if (ctx.closing) return;
    ctx.closing = true;
    e.preventDefault();
    (async () => {
      for (const t of ctx.tabs) {
        const wc = t.view.webContents;
        try {
          if (!wc.isDestroyed() && wc.debugger && wc.debugger.isAttached()) {
            try {
              await wc.debugger.sendCommand('Target.setAutoAttach', {
                autoAttach: false,
                waitForDebuggerOnStart: false,
                flatten: true,
              });
            } catch (err) {
              /* co the target/session da mat, bo qua */
            }
            try {
              wc.debugger.removeAllListeners('message');
            } catch (err) {}
            try {
              wc.debugger.detach();
            } catch (err) {}
          }
        } catch (err) {
          console.error('[incognito close] loi khi go debugger:', err);
        }
        try {
          if (!win.isDestroyed()) win.removeBrowserView(t.view);
        } catch (err) {}
      }
      win.destroy();
    })();
  });

  win.on('closed', () => {
    windowContexts.delete(ctx.webContentsId);
    if (ctx.incognito && ctx.partition) {
      // Xoa SACH NGAY LAP TUC toan bo du lieu cua session an danh nay (cookie,
      // localStorage, sessionStorage, cache, service worker, IndexedDB...)
      // thay vi cho Electron tu don dep dan khi khong con webContents nao
      // tham chieu toi partition nay nua - dung dung yeu cau "dong cua so la
      // xoa sach du lieu ngay lap tuc", khong phai "roi se mat di som muon".
      try {
        const ses = session.fromPartition(ctx.partition);
        ses.clearStorageData().catch(() => {});
        ses.clearCache().catch(() => {});
      } catch (err) {}
    }
    // KHONG tu goi webContents.destroy() o day: cac tab nay co gan CDP
    // debugger (xem attachPolyfillAndLoad, dung de tiem polyfill/theo doi
    // dang nhap), va pha huy webContents dot ngot trong luc debugger van con
    // gan co the khien Electron "treo" (da gap khi kiem thu). Chi can bo tham
    // chieu JS toi cac tab nay (ctx.tabs = []) va de Electron tu don dep
    // BrowserView/webContents nhu van lam voi cua so chinh tu truoc gio - bao
    // dam THAT SU cho yeu cau "xoa sach du lieu ngay" la ses.clearStorageData/
    // clearCache o tren (du lieu that nam trong Session, khong nam trong
    // webContents), khong phai buoc destroy() nay.
    ctx.tabs = [];
    ctx.activeTabId = null;
    if (ctx === primaryCtx) {
      mainWindow = null;
      primaryCtx = null;
    }
  });

  createTab(store.get('url'));

  ctx.getActiveTab = getActiveTab;
  ctx.createTab = createTab;
  ctx.switchToTab = switchToTab;
  ctx.closeTab = closeTab;
  ctx.showTabContextMenu = showTabContextMenu;
  ctx.openTabOnSecondDisplay = openTabOnSecondDisplay;
  ctx.updateBrowserViewBounds = updateBrowserViewBounds;
  ctx.sendNavState = sendNavState;
  ctx.sendTabsState = sendTabsState;
  ctx.sendZoomState = sendZoomState;
  ctx.sendWindowState = sendWindowState;
  ctx.zoomIn = zoomIn;
  ctx.zoomOut = zoomOut;
  ctx.zoomReset = zoomReset;
  ctx.openInNewTabOrExternal = openInNewTabOrExternal;

  return ctx;
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

// An menu mac dinh cua Electron de giao dien gon nhu mot trinh duyet rieng
// (toolbar back/forward/reload/settings duoc ve trong index.html) - ap dung
// chung cho MOI cua so (chinh lan an danh), nen chi can goi 1 lan luc khoi
// dong app la du (Menu.setApplicationMenu la cai dat toan app, khong phai
// theo tung cua so).
function createWindow() {
  primaryCtx = createBrowserWindowContext({ incognito: false });
  mainWindow = primaryCtx.win;
}

// Mo 1 "Cua so an danh" MOI - xem giai thich day du ve co che cach ly session
// trong createBrowserWindowContext. Khong gioi han so luong cua so an danh co
// the mo cung luc (moi cua so 1 session rieng, khong dung chung).
function openIncognitoWindow() {
  return createBrowserWindowContext({ incognito: true });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  setupAutoUpdater();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  // Chi tao lai cua so CHINH neu no thuc su da dong/chua co - mot vai cua so
  // an danh con mo khong duoc tinh la "da co cua so chinh".
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
});

// ---- IPC: dieu khien cua so (thu nho / phong to-khoi phuc / dong) ----
// Thay the cho thanh tieu de mac dinh cua he dieu hanh, vi cua so chay o
// che do frame:false (xem createWindow/createBrowserWindowContext). Dung
// ctxForEvent(event) de biet DUNG cua so nao vua gui IPC nay - cua so chinh
// hay 1 trong cac cua so an danh - vi gio day co the co NHIEU cua so cung
// luc, khong con dung 1 "mainWindow" duy nhat cho tat ca nua.
ipcMain.on('win:minimize', (event) => {
  const ctx = ctxForEvent(event);
  if (ctx && ctx.win && !ctx.win.isDestroyed()) ctx.win.minimize();
});
ipcMain.on('win:toggle-maximize', (event) => {
  const ctx = ctxForEvent(event);
  if (!ctx || !ctx.win || ctx.win.isDestroyed()) return;
  if (ctx.win.isMaximized()) ctx.win.unmaximize();
  else ctx.win.maximize();
});
ipcMain.on('win:close', (event) => {
  const ctx = ctxForEvent(event);
  if (ctx && ctx.win && !ctx.win.isDestroyed()) ctx.win.close();
});

// ---- IPC: mo 1 "Cua so an danh" moi (goi tu nut tren toolbar) ----
ipcMain.on('window:new-incognito', () => {
  openIncognitoWindow();
});
// Cho renderer (index.html) tu hoi "cua so cua chinh minh co phai la an
// danh khong" ngay sau khi tai xong, de hien badge/theme rieng - vi CA cua
// so chinh LAN cua so an danh deu tai chung 1 file index.html/preload.js.
ipcMain.handle('window:is-incognito', (event) => {
  const ctx = ctxForEvent(event);
  return !!(ctx && ctx.incognito);
});

// ---- IPC: an/hien BrowserView khi mo/dong overlay Settings ----
// BrowserView la thanh phan native, luon duoc ve DE LEN TREN toan bo noi
// dung HTML cua cua so (khong tuan theo z-index cua CSS). Vi vay overlay
// Settings (mot lop <div> HTML thuong) se bi che khuat/vo hinh phia sau
// BrowserView neu khong go no ra truoc. Dung addBrowserView/removeBrowserView
// (khong huy webContents) de an/hien tam thoi.
ipcMain.on('overlay:open', (event) => {
  const ctx = ctxForEvent(event);
  const tab = ctx && ctx.getActiveTab();
  if (tab && ctx.win && !ctx.win.isDestroyed()) {
    ctx.win.removeBrowserView(tab.view);
  }
});
ipcMain.on('overlay:close', (event) => {
  const ctx = ctxForEvent(event);
  const tab = ctx && ctx.getActiveTab();
  if (tab && ctx.win && !ctx.win.isDestroyed()) {
    ctx.win.addBrowserView(tab.view);
    ctx.updateBrowserViewBounds();
  }
});

// ---- IPC: doc/ghi URL cau hinh (goi tu man hinh Settings trong renderer) ----
// La 1 cai dat CHUNG cho toan app (khong theo tung cua so) - ke ca cua so an
// danh cung doc/dung chung URL mac dinh nay, chi rieng du lieu duyet
// (cookie/cache...) cua no la khong dung chung voi ai ca.
ipcMain.handle('config:get-url', () => store.get('url'));

ipcMain.handle('config:set-url', (event, newUrl) => {
  const normalized = normalizeUrl(newUrl);
  store.set('url', normalized);
  const ctx = ctxForEvent(event);
  const tab = ctx && ctx.getActiveTab();
  if (tab) tab.view.webContents.loadURL(normalized);
  return normalized;
});

// ---- IPC: dieu khien dieu huong cua tab dang active (cua DUNG cua so vua
// goi IPC nay) ----
ipcMain.handle('nav:get-state', (event) => {
  const ctx = ctxForEvent(event);
  const tab = ctx && ctx.getActiveTab();
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

ipcMain.on('nav:back', (event) => {
  const ctx = ctxForEvent(event);
  const tab = ctx && ctx.getActiveTab();
  if (tab && tab.view.webContents.canGoBack()) tab.view.webContents.goBack();
});
ipcMain.on('nav:forward', (event) => {
  const ctx = ctxForEvent(event);
  const tab = ctx && ctx.getActiveTab();
  if (tab && tab.view.webContents.canGoForward()) tab.view.webContents.goForward();
});
ipcMain.on('nav:reload', (event) => {
  const ctx = ctxForEvent(event);
  const tab = ctx && ctx.getActiveTab();
  if (tab) tab.view.webContents.reload();
});
ipcMain.on('nav:home', (event) => {
  const ctx = ctxForEvent(event);
  const tab = ctx && ctx.getActiveTab();
  if (tab) tab.view.webContents.loadURL(store.get('url'));
});
ipcMain.on('nav:go-to', (event, url) => {
  const ctx = ctxForEvent(event);
  const tab = ctx && ctx.getActiveTab();
  if (tab && url) tab.view.webContents.loadURL(normalizeUrl(url));
});

// ---- IPC: quan ly tab (toi da MAX_TABS, tinh RIENG cho tung cua so) ----
ipcMain.handle('tabs:get-max', () => MAX_TABS);
ipcMain.on('tabs:new', (event) => {
  const ctx = ctxForEvent(event);
  if (ctx && ctx.tabs.length < MAX_TABS) ctx.createTab(store.get('url'));
});
ipcMain.on('tabs:switch', (event, tabId) => {
  const ctx = ctxForEvent(event);
  if (ctx) ctx.switchToTab(tabId);
});
ipcMain.on('tabs:close', (event, tabId) => {
  const ctx = ctxForEvent(event);
  if (ctx) ctx.closeTab(tabId);
});
ipcMain.on('tabs:context-menu', (event, tabId) => {
  const ctx = ctxForEvent(event);
  if (ctx) ctx.showTabContextMenu(tabId);
});

// ---- Chi dung de kiem thu tu dong (khong bat trong ban build binh thuong):
// cho phep script test truy cap truc tiep cac ham noi bo qua Node inspector
// (--inspect) de gia lap co/khong co man hinh thu 2 ma khong can phan cung
// that. Nguoi dung binh thuong khong bao gio bat co HTHV4_TEST_HOOKS.
//
// Cac ham/thuoc tinh KHONG co tien to rieng deu thao tac tren primaryCtx (cua
// so CHINH) - giu nguyen y nghia nhu truoc khi co tinh nang "Cua so an danh"
// de KHONG lam vo bo test hoi quy da co san. Cac hook MOI cho rieng tinh
// nang "Cua so an danh" nam trong nhom co tien to "incognito*"/"window*". ----
if (process.env.HTHV4_TEST_HOOKS === '1') {
  global.__hthv4TestHooks = {
    getTabsSnapshot: () => primaryCtx.tabs.map((t) => ({ id: t.id })),
    getActiveTabId: () => primaryCtx.activeTabId,
    getMainWindowBrowserViewCount: () => (mainWindow ? mainWindow.getBrowserViews().length : 0),
    openTabOnSecondDisplay: (tabId) => primaryCtx.openTabOnSecondDisplay(tabId),
    pickSecondDisplay,
    autoUpdater,
    sendUpdateStatus,
    zoomIn: () => primaryCtx.zoomIn(),
    zoomOut: () => primaryCtx.zoomOut(),
    zoomReset: () => primaryCtx.zoomReset(),
    getActiveZoomFactor: () => {
      const tab = primaryCtx.getActiveTab();
      return tab ? tab.view.webContents.getZoomFactor() : null;
    },
    getCredentialEntries: () => credentialStore.get('entries'),
    decryptSecret,
    upsertCredential,
    deleteCredentialById,
    queueCredentialCapture: (payload) => {
      const tab = primaryCtx.getActiveTab();
      if (tab) queueCredentialCapture(tab, payload);
    },
    getCredentialQueueLength: () => {
      const tab = primaryCtx.getActiveTab();
      return tab ? tab.credentialQueue.length : null;
    },
    triggerAutofill: () => {
      const tab = primaryCtx.getActiveTab();
      if (tab) tryAutofill(tab);
    },
    triggerAccountPicker: () => {
      const tab = primaryCtx.getActiveTab();
      if (tab) trySetupAccountPicker(tab);
    },
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

    // ---- Hook MOI: kiem thu rieng tinh nang "Cua so an danh" ----
    openIncognitoWindow: () => openIncognitoWindow().webContentsId,
    listWindowContexts: () =>
      Array.from(windowContexts.values()).map((c) => ({
        webContentsId: c.webContentsId,
        incognito: c.incognito,
        partition: c.partition,
        tabCount: c.tabs.length,
      })),
    getSessionPartitionForWindow: (webContentsId) => {
      const ctx = windowContexts.get(webContentsId);
      return ctx ? ctx.partition : undefined;
    },
    getActiveTabViewInfo: (webContentsId) => {
      const ctx = windowContexts.get(webContentsId);
      const tab = ctx && ctx.getActiveTab();
      if (!tab) return null;
      return { viewWebContentsId: tab.view.webContents.id, url: tab.view.webContents.getURL() };
    },
    navigateActiveTab: (webContentsId, url) => {
      const ctx = windowContexts.get(webContentsId);
      const tab = ctx && ctx.getActiveTab();
      if (tab && url) tab.view.webContents.loadURL(normalizeUrl(url));
    },
    closeWindowByWebContentsId: (webContentsId) => {
      const ctx = windowContexts.get(webContentsId);
      if (ctx && ctx.win && !ctx.win.isDestroyed()) ctx.win.close();
    },
    executeInTabView: (viewWebContentsId, code) => {
      // Chay truc tiep 1 doan JS trong DUNG webContents cua 1 BrowserView (tab)
      // bang chinh id noi bo cua Electron (KHAC voi id cua CDP targetId) - dung
      // de kiem thu doc/ghi localStorage/cookie/... cho DUNG 1 tab cu the (vd 1
      // trong nhieu cua so an danh dang cung tai chung 1 URL, khong the phan
      // biet duoc qua danh sach target CDP thong thuong vi trung URL).
      const wc = webContents.fromId(viewWebContentsId);
      if (!wc) return Promise.resolve(undefined);
      return wc.executeJavaScript(code);
    },
    isPartitionAlive: async (partition) => {
      // Dung de kiem tra session in-memory cua 1 cua so an danh DA DUOC DON
      // DEP hay chua sau khi dong cua so do (xem giai thich trong 'closed'
      // handler cua createBrowserWindowContext) - doc thu 1 gia tri cookie
      // vua ghi truoc do, ky vong KHONG con neu da xoa dung.
      try {
        const ses = session.fromPartition(partition);
        const cookies = await ses.cookies.get({});
        return cookies.length > 0;
      } catch (err) {
        return false;
      }
    },
  };
}

// ---- IPC: mo DevTools cho NOI DUNG trang web (tab dang active cua DUNG cua
// so vua goi) ----
// Quan trong: moi tab la mot webContents rieng voi cua so chua no, nen
// Ctrl+Shift+I/F12 mac dinh (neu co) chi debug duoc thanh toolbar, KHONG
// debug duoc noi dung trang - phai mo devtools rieng cho webContents cua tab.
ipcMain.on('devtools:open', (event) => {
  const ctx = ctxForEvent(event);
  const tab = ctx && ctx.getActiveTab();
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
// CO Y giu lai cookie/localStorage de khong lam mat phien dang nhap. Xoa
// DUNG session cua cua so vua goi IPC nay: cua so chinh (dung chung 1
// session mac dinh, luu ben vung) hoac 1 cua so an danh (session rieng, chi
// trong bo nho) - khong xoa nham sang session cua cua so khac.
ipcMain.handle('cache:clear', async (event) => {
  const ctx = ctxForEvent(event);
  const ses = ctx && ctx.partition ? session.fromPartition(ctx.partition) : session.defaultSession;
  await ses.clearCache();
  await ses.clearStorageData({
    storages: ['serviceworkers', 'cachestorage', 'shadercache', 'filesystem'],
  });
  if (ctx) ctx.tabs.forEach((t) => t.view.webContents.reloadIgnoringCache());
  return true;
});

// ---- IPC: phong to/thu nho noi dung trang (goi tu nut +/- tren toolbar,
// ap dung cho tab dang active cua DUNG cua so vua goi) ----
ipcMain.on('zoom:in', (event) => {
  const ctx = ctxForEvent(event);
  if (ctx) ctx.zoomIn();
});
ipcMain.on('zoom:out', (event) => {
  const ctx = ctxForEvent(event);
  if (ctx) ctx.zoomOut();
});
ipcMain.on('zoom:reset', (event) => {
  const ctx = ctxForEvent(event);
  if (ctx) ctx.zoomReset();
});

// ---- IPC: quan ly mat khau da luu (goi tu man hinh Settings) ----
// "passwords:list" CHU DICH KHONG bao gio tra ve mat khau that - chi tra ve
// origin/username de hien danh sach. Mat khau chi duoc giai ma va tra ve khi
// nguoi dung chu dong bam "Hien" cho TUNG dong rieng le (passwords:reveal).
ipcMain.handle('passwords:list', () => {
  return credentialStore
    .get('entries')
    .map((e) => ({ id: e.id, origin: e.origin, username: e.username, updatedAt: e.updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
});
ipcMain.handle('passwords:reveal', (event, id) => {
  const entry = credentialStore.get('entries').find((e) => e.id === id);
  if (!entry) return '';
  return decryptSecret(entry.secret);
});
ipcMain.on('passwords:delete', (event, id) => {
  deleteCredentialById(id);
});

// Them 1 muc mat khau THU CONG (goi tu nut "+ Them mat khau" trong Settings)
// - danh cho cac truong hop app khong tu bat duoc luc dang nhap (vd form
// dang nhap qua la, chia nhieu buoc...), hoac nguoi dung chi muon nhap san
// truoc mot tai khoan de dung sau. "url" nhan ca URL day du lan chi ten mien
// (chuan hoa ve dung "origin" bang normalizeOrigin).
ipcMain.handle('passwords:add', (event, { url, username, password }) => {
  const origin = normalizeOrigin(url);
  if (!origin) return { ok: false, message: 'Dia chi trang web khong hop le.' };
  if (!username || !String(username).trim()) return { ok: false, message: 'Vui long nhap ten dang nhap.' };
  if (!password) return { ok: false, message: 'Vui long nhap mat khau.' };
  upsertCredential({ origin, username: String(username).trim(), password });
  return { ok: true };
});

// Sao chep nhanh tai khoan/mat khau da luu vao clipboard (giong nut "Sao
// chep mat khau" cua Chrome). Mat khau CHI duoc giai ma o day, trong tien
// trinh main, ngay truoc khi ghi vao clipboard - khong di qua renderer.
// Rieng voi mat khau: tu dong xoa clipboard sau 30 giay NEU noi dung
// clipboard luc do van dung y het mat khau vua chep (tranh xoa nham thu
// khac nguoi dung da chep sau do) - giam thoi gian mat khau "troi noi" o
// dang van ban tho trong clipboard he thong.
const CLIPBOARD_CLEAR_MS = 30 * 1000;
ipcMain.on('passwords:copy-username', (event, id) => {
  const entry = credentialStore.get('entries').find((e) => e.id === id);
  if (entry) clipboard.writeText(entry.username);
});
ipcMain.on('passwords:copy-password', (event, id) => {
  const entry = credentialStore.get('entries').find((e) => e.id === id);
  if (!entry) return;
  const password = decryptSecret(entry.secret);
  if (!password) return;
  clipboard.writeText(password);
  setTimeout(() => {
    try {
      if (clipboard.readText() === password) clipboard.clear();
    } catch (err) {}
  }, CLIPBOARD_CLEAR_MS);
});
