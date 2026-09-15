# HTHV4 Browser

Trình duyệt Electron tối giản, mặc định mở `https://hthv4.vnpthis.vn/`, có thanh
công cụ gọn (back / forward / reload / home / thanh địa chỉ), **nhiều tab (tối
đa 10)**, nút **thu nhỏ / phóng to / đóng** cửa sổ riêng, **tự động cập nhật
qua GitHub Releases**, và màn hình **Settings** để đổi URL mặc định bất cứ lúc
nào — không cần build lại app.

## Chạy thử (chế độ dev)

```bash
npm install
npm start
```

## Xem lỗi thật của trang web (DevTools)

Bấm nút **`</>`** trên toolbar (hoặc phím **F12** / **Ctrl+Shift+I**) để mở
DevTools cho **nội dung trang web đang xem** (khác với DevTools của bản thân
app). Dùng cái này để xem:

- Tab **Console**: lỗi JavaScript thật (kể cả lỗi không liên quan đến
  `Promise.try`/PDF — ví dụ lỗi mạng, lỗi xác thực, CSP chặn...).
- Tab **Network**: request nào thất bại, mã lỗi HTTP, response trả về gì.

Nếu gặp lỗi (trang trắng, không hiển thị phiếu, v.v.), hãy mở DevTools ngay
lúc lỗi xảy ra và chụp lại nội dung tab Console/Network — đây là cách nhanh
nhất để xác định đúng nguyên nhân thay vì đoán mò.

## Đổi trang mặc định

Bấm biểu tượng bánh răng (⚙) ở góc phải thanh công cụ → nhập URL mới → **Lưu &
áp dụng**. URL được lưu lại bằng `electron-store`, nằm tại:

- Windows: `%APPDATA%\HTHV4 Browser\config.json`
- Linux: `~/.config/HTHV4 Browser/config.json`
- macOS: `~/Library/Application Support/HTHV4 Browser/config.json`

Sửa trực tiếp file này (khi app đang đóng) cũng có tác dụng tương đương — tiện
cho việc triển khai hàng loạt (đẩy sẵn file config vào nhiều máy).

## Đóng gói file cài đặt (.exe cho Windows)

```bash
npm run dist:win     # tạo installer NSIS trong thư mục release/
npm run dist:linux   # AppImage cho Linux
npm run dist:mac     # dmg cho macOS (phải build trên máy Mac)
```

Nếu build trên máy Windows thật thì không cần cài thêm gì. Nếu build **từ
Linux** (cross-build sang Windows) thì máy cần cài Wine (bản đầy đủ 32+64 bit):

```bash
sudo dpkg --add-architecture i386
sudo apt-get update
sudo apt-get install --no-install-recommends wine wine32:i386 wine64
```

File cài đặt cuối cùng nằm ở `release/HTHV4 Browser Setup <version>.exe`. Với cấu
hình hiện tại, đây là **1 file installer duy nhất chạy được cả trên Windows
32-bit lẫn 64-bit** (NSIS tự nhận diện đúng bản khi cài).

## Tự động cập nhật (GitHub Releases)

App tự kiểm tra bản mới từ repo Release công khai
**https://github.com/trongdqtgg/trinhduyet_release** bằng thư viện
`electron-updater`, và tự tải + cài khi có bản mới — **không cần người dùng
tải lại file cài đặt thủ công**.

### Người dùng thấy gì

- App tự kiểm tra cập nhật 5 giây sau khi khởi động, và lặp lại mỗi 4 tiếng.
- Nếu có bản mới: tự tải ngầm (không làm gián đoạn công việc). Tải xong sẽ
  hiện hộp thoại hỏi **"Khởi động lại ngay"** hoặc **"Để sau"**. Nếu chọn
  "Để sau", bản cập nhật vẫn được tự cài vào lần kế tiếp app được **đóng hoàn
  toàn** (không phải thoát bằng nút X thông thường nếu app chạy nền... trong
  bản hiện tại app thoát hẳn khi đóng cửa sổ chính, nên chỉ cần đóng app rồi
  mở lại là được cập nhật).
- Trong màn hình **Settings** có mục **"Kiểm tra cập nhật"** để chủ động bấm
  kiểm tra ngay (hữu ích khi vừa phát hành bản mới, không muốn đợi 4 tiếng),
  hiện phiên bản đang chạy, và nút **"Cài đặt & khởi động lại"** xuất hiện khi
  đã tải xong bản mới.
- Vì repo release là **Public**, app **không cần nhúng bất kỳ token/API key**
  nào để kiểm tra/tải bản cập nhật — an toàn, không có gì để lộ nếu ai đó dịch
  ngược file cài đặt.
- Chạy bằng `npm start` (chế độ dev, chưa đóng gói) sẽ **tự bỏ qua** toàn bộ
  bước kiểm tra cập nhật (Settings sẽ ghi rõ "đang chạy ở chế độ dev").

### Cách phát hành 1 bản cập nhật mới

**Cách nhanh — chỉ cần click (Windows):**

1. Sửa code xong, **tăng số phiên bản** trong `package.json` (trường
   `"version"`, vd `1.0.0` → `1.0.1`). Đây là bước bắt buộc — GitHub Releases
   và electron-updater xác định "có bản mới hay không" dựa vào số này.
2. Double-click file **`build-and-publish.bat`** (ở ngay thư mục gốc dự án)
   trên máy Windows đã cài sẵn Node.js. Script sẽ tự hiện số phiên bản sắp
   phát hành để bạn kiểm tra, tự `npm install`, tự build, và tự đăng bản mới
   lên GitHub Releases — không cần gõ lệnh nào.

File `.bat` này đã có sẵn 1 GitHub token (dùng để đăng bài lên
`trinhduyet_release`) nhúng bên trong theo yêu cầu, để không phải nhập lại
mỗi lần build. **Vài lưu ý an toàn quan trọng:**
- **Không chia sẻ file `build-and-publish.bat` này cho người khác**, không
  đính kèm email, không đưa lên bất kỳ repo/kho lưu trữ công khai nào — ai
  có file này đều dùng được token để đăng bài (ghi) vào tài khoản GitHub của
  bạn.
- Chỉ giữ file này trên (các) máy dùng để build/phát hành, không cần thiết
  thì xoá khỏi các máy khác.
- Nếu nghi ngờ token bị lộ, vào https://github.com/settings/tokens (hoặc
  Settings → Developer settings → Personal access tokens nếu dùng fine-grained
  token) để **thu hồi (revoke)** và tạo token mới, rồi cập nhật lại vào file
  `.bat`.

**Cách thủ công (Linux/Mac, hoặc khi cần dùng token khác):**

1. Tăng số phiên bản trong `package.json` như trên.
2. Tạo 1 **GitHub Personal Access Token** (Settings → Developer settings →
   Personal access tokens) có quyền ghi vào repo `trinhduyet_release` (repo
   Public thì chỉ cần quyền `public_repo`, hoặc fine-grained token với quyền
   "Contents: Read and write" cho riêng repo đó).
3. Chạy (trên máy đã cài Wine nếu build từ Linux, xem mục trên):
   ```bash
   GH_TOKEN=dan_token_vao_day npm run dist:win:publish
   ```

Dù dùng cách nào, lệnh build đều **tự động tạo 1 GitHub Release mới** (tag
dạng `v1.0.1`) trong repo `trinhduyet_release` và tải lên đúng 3 file cần
thiết: file `.exe`, file `.exe.blockmap` (dùng để tải bản vá nhỏ thay vì tải
lại toàn bộ), và `latest.yml` (file mà `electron-updater` đọc để biết có bản
mới). Xong — các máy đang chạy bản cũ sẽ tự phát hiện và tải bản mới trong
lần kiểm tra kế tiếp (tối đa 4 tiếng, hoặc ngay lập tức nếu người dùng bấm
"Kiểm tra cập nhật").

**⚠️ Quan trọng — không tự tay kéo-thả file lên trang GitHub Releases:**
lúc build thử cục bộ (`--publish=never`), mình phát hiện file `.exe` được tạo
ra có tên chứa dấu cách (vd `HTHV4 Browser Setup 1.0.0.exe`), nhưng file
`latest.yml` mà electron-builder tạo ra lại trỏ tới tên **không có dấu cách**
(vd `HTHV4-Browser-Setup-1.0.0.exe`, dùng dấu gạch ngang) — đây là tên mà
electron-builder SẼ dùng khi tự upload qua lệnh `dist:win:publish` ở trên.
Nếu bạn tự tay kéo file gốc (có dấu cách) lên GitHub, tên file sẽ không khớp
với `latest.yml` và **app sẽ báo lỗi tải cập nhật không rõ nguyên nhân**. Vì
vậy luôn dùng lệnh `npm run dist:win:publish` ở bước 3 thay vì tải thủ công.
Nếu vì lý do nào đó bắt buộc phải tải tay, phải đổi tên file `.exe` cho khớp
chính xác với trường `path:` trong `release/latest.yml` trước khi tải lên,
và phải tải lên cả file `.blockmap` lẫn `latest.yml`.

### Giới hạn khi kiểm thử tính năng này

Mình đã kiểm thử kỹ phần xử lý sự kiện và giao diện (giả lập đầy đủ các
trạng thái: đang kiểm tra / có bản mới / đang tải / tải xong / lỗi mạng) và
xác nhận UI trong Settings phản ứng đúng ở từng bước, cũng như xác nhận
`electron-updater` được đóng gói đúng vào file cài đặt. Tuy nhiên, việc tải
thật + cài đặt thật + khởi động lại (`quitAndInstall`) chỉ có thể kiểm chứng
đầy đủ khi đã có ít nhất 1 bản Release thật trên GitHub và cài trên máy
Windows thật — chưa test được bước này trong môi trường dựng app. Sau khi
bạn phát hành bản Release đầu tiên (theo hướng dẫn ở trên), hãy thử cập nhật
lên 1 bản tiếp theo và báo lại nếu có lỗi.

## ⚠️ Hỗ trợ Windows 7 (32-bit)

Project này đã được **hạ (downgrade) xuống Electron 22.3.27** — đây là bản
Electron **cuối cùng** còn chạy được trên Windows 7/8/8.1. Từ Electron 23 trở
đi, Google Chromium (nhân bên trong Electron) đã bỏ hỗ trợ các bản Windows cũ
hơn Windows 10, nên bất kỳ Electron nào mới hơn 22 đều **không cài/chạy được
trên Windows 7**.

Cần lưu ý:

- Electron 22 dùng Chromium 108 (phát hành cuối 2022) và **đã ngừng nhận bản vá
  bảo mật từ 10/2023**. Có nghĩa là các lỗ hổng trình duyệt được phát hiện sau
  mốc đó sẽ không được vá trong app này.
- Bản thân Windows 7 cũng đã hết vòng đời hỗ trợ từ Microsoft (kể cả gói ESU mở
  rộng) từ đầu 2023, nên rủi ro bảo mật chủ yếu nằm ở tầng hệ điều hành, không
  riêng gì app này.
- Vì các lý do trên, chỉ nên dùng cấu hình này cho máy nội bộ, không có kết nối
  Internet rộng rãi, hoặc trong lúc chờ nâng cấp hệ điều hành.
- Nếu sau này không còn cần hỗ trợ Windows 7 nữa, nên nâng `electron` trong
  `package.json` lên bản mới nhất và bỏ `"ia32"` khỏi `build.win.target.arch`
  để có bản Chromium mới, an toàn hơn.
- **Về tự động cập nhật (mục trên):** tải cập nhật từ GitHub cần kết nối
  HTTPS/TLS 1.2. Bản Windows 7 cài đặt gốc (chưa cập nhật Windows Update lần
  nào) có thể **chưa bật TLS 1.2** theo mặc định, khiến việc kiểm tra cập
  nhật báo lỗi mạng dù máy vẫn có Internet. Nếu gặp tình huống này, cần bật
  TLS 1.2 cho Windows 7 (qua Windows Update hoặc chỉnh registry) — bản thân
  app không tự sửa được giới hạn này của hệ điều hành.

## Vá lỗi "Promise.try" / "Promise.withResolvers" / không hiển thị được PDF

Chromium 108 (đi kèm Electron 22, xem mục Windows 7 ở trên) **chưa có** hai hàm
mà thư viện **pdf.js** (dùng để render PDF trong trang HIS) cần:

- `Promise.try` — Chrome chỉ hỗ trợ từ ~giữa 2024
- `Promise.withResolvers` — Chrome chỉ hỗ trợ từ bản 119, cuối 2023 (đã xác
  nhận qua lỗi thực tế từ DevTools: `UnknownErrorException: Promise.withResolvers
  is not a function` trong `main.<hash>.js` của pdf.js)

Thiếu 1 trong 2 hàm này đều gây ra lỗi "Không thể hiển thị phiếu" khi xem PDF.

App tự động vá lỗi này bằng cách tiêm một đoạn polyfill nhỏ cho `Promise.try`
vào **3 lớp**, dùng Chrome DevTools Protocol (`main.js`, hàm
`attachPolyfillAndLoad`):

1. Trang chính — `Page.addScriptToEvaluateOnNewDocument`
2. Mọi `<iframe>` con — cùng cơ chế trên áp dụng cho toàn bộ document trong
   webContents, không riêng frame chính (khung xem PDF của HIS thường nằm
   trong iframe riêng)
3. Mọi **Web Worker** mà trang tạo ra — dùng `Target.setAutoAttach` +
   `waitForDebuggerOnStart` để bắt worker trước khi nó kịp chạy dòng code
   nào, tiêm polyfill, rồi mới cho chạy tiếp. Nhiều thư viện render PDF
   (vd pdf.js) xử lý nặng bên trong Worker — nếu chỉ vá trang mà bỏ qua
   Worker thì lỗi `Promise.try` vẫn còn nguyên bên trong đó.

Cả 3 lớp đã được kiểm chứng bằng test mô phỏng (trang có iframe + Worker cùng
gọi `Promise.try`) chạy qua chính app đã build, không chỉ đoán.

**Đã sửa lỗi "trang trắng" (bug do chính cơ chế vá Worker gây ra):** phiên bản
trước bật `Target.setAutoAttach` với `waitForDebuggerOnStart: true` để bắt
Worker, nhưng chỉ gửi lệnh "cho chạy tiếp" cho đúng loại `worker`/`shared_worker`.
Nếu trang có bất kỳ target con nào khác (service worker, iframe khác tiến
trình...), nó bị tạm dừng chờ debugger và **không bao giờ được cho chạy tiếp**
→ cả trang bị treo/trắng xoá. Đã sửa: giờ MỌI target con được auto-attach đều
được "cho chạy tiếp" ngay lập tức, bất kể loại gì.

## Trang trắng lúc mới mở, bấm DevTools thì tự hiện ra

Đây là hạn chế khá phổ biến của `BrowserView`: nó **không tự động nhận focus**
khi mới tạo (focus mặc định vẫn ở thanh toolbar). Electron mặc định "tiết
giảm" (throttle) các animation/timer của một `webContents` không có focus —
mà các framework JS hiện đại (React/Angular, mà trang HIS rất có thể dùng)
thường dựa vào `requestAnimationFrame`/timer cho bước khởi tạo/render đầu
tiên, nên có thể bị "kẹt" ở màn hình trắng cho tới khi nhận được tương tác
(mở DevTools là một trong số đó, vì nó buộc phải focus vào view đó).

Đã sửa bằng 2 thay đổi trong `main.js`:
- Tắt `backgroundThrottling` cho `BrowserView`
- Chủ động gọi `.focus()` vào `BrowserView` ngay khi tải xong lần đầu

Nếu vẫn còn gặp trang trắng sau bản này, đây là trường hợp mình **không tái
hiện được** trong môi trường test (đã thử nhiều cách: chờ lâu hơn, resize cửa
sổ, gỡ/gắn lại view, bật/tắt DevTools tự động — không cái nào tái hiện đúng
lỗi) nên rất cần bạn mở DevTools (nút `</>`) ngay lúc màn hình còn trắng, xem
tab Console/Network có gì bất thường không, để xác định chính xác hơn.

**Lưu ý kỹ thuật khác:** ban đầu app dùng thẻ `<webview>` để hiển thị trang,
nhưng đã đổi sang **`BrowserView`** (component gốc của Electron) vì `<webview>`
bị lỗi "rơi mất" polyfill mỗi khi trang điều hướng sang origin khác — `BrowserView`
không gặp vấn đề này và cũng là cách Electron khuyến nghị.

Nếu sau này trang HIS dùng thêm API JS/Web mới khác mà Chromium 108 chưa có
(gặp lỗi tương tự `Promise.try`), chỉ cần bổ sung thêm đoạn polyfill tương ứng
vào biến `POLYFILL_SOURCE` trong `src/main.js`.

## Giao diện gọn + nút thu nhỏ / phóng to / đóng cửa sổ

Toolbar và thanh tab đã được thu nhỏ lại (toolbar 38px, thanh tab 28px —
trước đây là 49px và 36px) để dành nhiều diện tích hơn cho nội dung trang.

Cửa sổ app giờ chạy ở chế độ **không viền** (bỏ thanh tiêu đề mặc định của
Windows) để giao diện gọn liền khối như một trình duyệt thật, thay vào đó có
3 nút riêng ở góc phải toolbar:

- **─** Thu nhỏ xuống taskbar.
- **□** Phóng to toàn màn hình / bấm lại để khôi phục kích thước cũ (icon
  không đổi hình, chỉ đổi chữ gợi ý khi rê chuột — "Phóng to" ↔ "Khôi phục").
- **×** Đóng app (nền đỏ khi rê chuột qua, giống quy ước thường thấy).

Bấm đúp vào vùng trống của toolbar (không trúng nút/ô địa chỉ) cũng phóng
to/khôi phục cửa sổ, giống thao tác bấm đúp thanh tiêu đề thông thường.

Đã kiểm thử kỹ phần này bằng cách dựng thêm 1 window manager thật (fluxbox)
trong môi trường test — phát hiện và sửa luôn 1 lỗi thật trong lúc test: khi
phóng to/khôi phục cửa sổ, nội dung trang (`BrowserView`) đôi khi bị "kẹt" ở
kích thước cũ do sự kiện resize không phải lúc nào cũng tự phát sinh kèm
theo; đã sửa bằng cách chủ động tính lại kích thước ngay trong sự kiện
phóng to/khôi phục thay vì chỉ dựa vào sự kiện resize chung chung.

## Nhiều tab (tối đa 10) & mở link trong tab mới

App hỗ trợ tối đa **10 tab** cùng lúc, hiển thị trên thanh tab gọn nằm ngay
dưới toolbar:

- Bấm nút **`+`** ở cuối thanh tab để mở tab mới (chạy trang mặc định đã cấu
  hình trong Settings). Nút này tự động bị mờ/vô hiệu hoá khi đã mở đủ 10 tab,
  và luôn nằm cố định ở cuối thanh tab (không bị cuộn mất khi có nhiều tab).
- Bấm vào một tab để chuyển sang tab đó; các tab không hiển thị vẫn giữ
  nguyên trạng thái (không bị tải lại) khi quay lại.
- Khi số tab nhiều hơn chỗ hiển thị vừa, thanh tab sẽ **tự cuộn ngang**
  (cuộn chuột hoặc kéo) thay vì cắt mất tab — không tab nào bị "biến mất".
- Bấm dấu **×** trên tab để đóng tab đó. Không thể đóng khi chỉ còn 1 tab
  (luôn phải còn ít nhất 1 tab mở).
- **Click phải vào một liên kết (link)** trong trang → chọn **"Mở liên kết
  trong tab mới"** để mở link đó ở tab mới mà không rời khỏi trang hiện tại.
  Mục này bị mờ/vô hiệu hoá kèm ghi chú khi đã đạt giới hạn 10 tab. Menu
  chuột phải cũng có sẵn "Sao chép địa chỉ liên kết", "Sao chép" (khi bôi đen
  chữ) và "Dán" (khi đang gõ vào ô nhập liệu).

**Thay đổi hành vi cần lưu ý:** trước đây, các liên kết mở ở "tab mới"
(`target="_blank"`, hoặc trang tự gọi `window.open()`) sẽ mở bằng trình
duyệt mặc định của hệ điều hành (Chrome/Edge...). Từ bản này, chúng sẽ mở
**ngay trong app** dưới dạng một tab mới, để giữ người dùng trong luồng làm
việc của trang HIS. Nếu đã mở đủ 10 tab thì mới rơi về mở bằng trình duyệt hệ
điều hành như cũ. Nếu bạn muốn quay lại hành vi cũ (luôn mở bằng trình duyệt
ngoài), báo lại để mình chỉnh giúp.

Mỗi tab dùng chung 1 session/cookie của app (không phải mỗi tab một phiên
đăng nhập riêng), và cơ chế vá lỗi `Promise.try`/`Promise.withResolvers` (xem
mục bên dưới) được áp dụng cho từng tab độc lập.

### Click phải vào 1 tab → mở toàn màn hình trên màn hình thứ 2

Click phải vào một **tab** trên thanh tab (khác với click phải vào nội dung
trang) → chọn **"Mở tab này ở màn hình thứ 2 (toàn màn hình)"**. App sẽ:

1. Tự dò các màn hình vật lý đang cắm vào máy (chỉ hoạt động khi các màn
   hình được đặt ở chế độ **mở rộng desktop** — "Extend", không phải "Nhân
   bản/Duplicate").
2. Tạo một **cửa sổ mới**, không viền, không toolbar, đặt đúng vị trí màn
   hình thứ 2 và **tự động toàn màn hình (fullscreen)** ngay lập tức.
3. **Chuyển hẳn** (không phải sao chép) tab đó sang cửa sổ mới — giữ nguyên
   trạng thái đang có (đăng nhập, vị trí cuộn, dữ liệu đang nhập...), không
   tải lại trang. Tab đó biến mất khỏi thanh tab của cửa sổ chính trong lúc
   đang hiển thị ở màn hình thứ 2.

Nếu máy chỉ có 1 màn hình, mục này sẽ bị mờ đi kèm ghi chú, và nếu vẫn cố
chọn thì app báo hộp thoại "Không tìm thấy màn hình thứ 2" thay vì làm gì đó
sai lệch.

**Cách quay tab trở lại cửa sổ chính:** vì cửa sổ ở màn hình thứ 2 không có
viền/nút đóng, bấm phím **Esc** trong lúc đang xem cửa sổ đó — app sẽ tự
đóng cửa sổ và trả tab về lại thanh tab của cửa sổ chính. (Alt+F4 của Windows
vẫn luôn dùng được như một cách dự phòng.) Đây là một lựa chọn mình tự thêm
để đảm bảo không ai bị "kẹt" trong màn hình toàn màn hình không lối ra — nếu
bạn muốn tắt phím Esc này (vd để tránh nhân viên bấm nhầm khi màn hình đó
đang hiển thị công khai cho bệnh nhân xem), báo lại để mình gỡ.

Trường hợp đặc biệt: nếu bạn đưa **tab duy nhất còn lại** sang màn hình thứ
2, cửa sổ chính sẽ tạm thời không còn tab nào (vẫn dùng được nút `+` để mở
tab mới bình thường); bấm Esc ở cửa sổ màn hình 2 sẽ trả tab đó về như cũ.

### Đã chặn Ctrl+Click (và giữa-click) vào link

Trước đây, giữ **Ctrl rồi bấm chuột trái** vào một liên kết sẽ tự động mở nó
ở tab mới (hoặc trình duyệt ngoài) — đây là hành vi mặc định của Chromium.
Điều này có thể gây phiền khi trang HIS dùng tổ hợp Ctrl+Click cho mục đích
riêng của nó (vd chọn nhiều dòng trong bảng), hoặc khi người dùng lỡ giữ
phím Ctrl trong lúc thao tác khác và vô tình mở tràn lan tab rác.

Từ bản này, **Ctrl+Click bị chặn hoàn toàn** — không mở tab mới, không mở
trình duyệt ngoài, không điều hướng đi đâu cả (giống như không có chuyện gì
xảy ra). Cách duy nhất để chủ động mở một liên kết ở tab mới vẫn là **click
phải → "Mở liên kết trong tab mới"** (xem mục trên). Click chuột trái bình
thường (không giữ Ctrl) vẫn điều hướng như cũ trong tab hiện tại.

Lưu ý: do Chromium xếp **giữa-click (middle-click)** vào cùng nhóm hành vi
với Ctrl+Click (cùng gọi là mở "tab nền"), nên middle-click vào link cũng bị
chặn theo luôn. Nếu bạn cần bật lại một trong hai, báo lại để mình tách
riêng.

## Đã sửa: bấm nút Cài đặt (⚙) không có phản ứng

**Nguyên nhân:** nội dung trang web được vẽ bằng `BrowserView` — một thành
phần **native** của Electron, luôn được vẽ đè lên trên **toàn bộ** nội dung
HTML của cửa sổ, không tuân theo `z-index` của CSS. Màn hình Settings là một
lớp `<div>` HTML thông thường, nên dù nút bấm vẫn nhận sự kiện click và mở
overlay bình thường, overlay đó lại bị `BrowserView` che khuất phía sau —
người dùng thấy như "bấm không có phản ứng gì".

**Đã sửa:** khi mở màn hình Settings, app sẽ tạm thời gỡ `BrowserView` ra
khỏi cửa sổ (không tải lại trang, không mất trạng thái) để overlay hiện ra
đầy đủ và bấm được; khi đóng Settings (Hủy / Lưu / bấm ra ngoài / phím Esc),
`BrowserView` được gắn lại như cũ.

## Phóng to / thu nhỏ nội dung trang (Zoom)

Trên toolbar có cụm 3 nút **`− 100% +`** nằm giữa ô địa chỉ và nút DevTools:

- **`−`** / **`+`**: thu nhỏ / phóng to nội dung trang, mỗi lần bấm đổi 10%
  (giới hạn 50% – 300%).
- **`100%`** (nút ở giữa, hiện % hiện tại): bấm để đưa zoom về lại 100% ngay.
- Cũng dùng được phím tắt quen thuộc của trình duyệt: **Ctrl + `=`** (phóng
  to), **Ctrl + `-`** (thu nhỏ), **Ctrl + `0`** (đặt lại 100%) — hoạt động dù
  đang focus ở toolbar hay ở nội dung trang. Cuộn chuột giữ Ctrl (pinch-zoom)
  cũng được nhận diện, số % trên toolbar tự cập nhật theo.
- Mức zoom là **riêng cho từng tab** (giống cách Electron/Chrome quản lý zoom
  theo từng trang) — phóng to tab này không ảnh hưởng tab khác, và khi
  chuyển qua lại giữa các tab, số % trên toolbar tự đổi theo đúng tab đang
  xem. Khác với Chrome thật (Chrome nhớ zoom theo *website*, áp dụng lại cả
  khi mở tab mới tới cùng site đó), ở đây mở tab mới hoặc tải lại từ đầu sẽ
  về lại 100% — đơn giản hóa có chủ đích để không phải lưu thêm một cơ sở dữ
  liệu zoom-theo-site.

## Lưu tài khoản / mật khẩu (giống trình quản lý mật khẩu của Chrome)

Khi đăng nhập thành công trên một trang, app sẽ hiện một banner nhỏ ở góc
trên-phải nội dung trang, hỏi **"Lưu mật khẩu cho tài khoản "..." trên trang
này?"** với 2 lựa chọn **"Lưu mật khẩu"** / **"Không, cảm ơn"**. Banner tự
biến mất sau 15 giây nếu không bấm gì. Lần sau quay lại đúng trang đó, app
**tự động điền** tài khoản/mật khẩu đã lưu vào đúng ô trên form.

Quản lý các mật khẩu đã lưu tại ⚙ **Settings → mục "Mật khẩu đã lưu"**. Mỗi
mục hiện đầy đủ tên trang, tên đăng nhập và có 2 nút riêng:

- **"Hiện" / "Ẩn"**: xem/che mật khẩu thật — hiện **toàn bộ** nội dung mật
  khẩu (kể cả mật khẩu rất dài), không bị cắt bớt hay rút gọn bằng "...".
- **"Sao chép"** (có ở cả dòng tên đăng nhập lẫn dòng mật khẩu): chép nhanh
  giá trị đó vào clipboard mà không cần bấm "Hiện" trước — nút tạm đổi
  thành "Đã chép" trong 1.2 giây để xác nhận. Riêng **mật khẩu sẽ tự động bị
  xóa khỏi clipboard sau 30 giây** (nếu clipboard lúc đó vẫn đang chứa đúng
  mật khẩu đó, tức là chưa bị ghi đè bởi thứ khác) — giảm rủi ro mật khẩu bị
  dán nhầm vào chỗ khác hoặc bị người khác đọc được nếu máy tạm rời khỏi tầm
  mắt sau khi chép.
- **"Xóa"**: gỡ một mục khỏi danh sách.

Ngoài việc tự phát hiện lúc đăng nhập, có thể **chủ động thêm một mục mật
khẩu bất kỳ lúc nào** bằng nút **"+ Thêm mật khẩu"** phía trên danh sách —
hữu ích khi app không tự bắt được (vd form quá đặc biệt, hoặc muốn nhập sẵn
tài khoản trước khi dùng). Điền địa chỉ trang web (dán cả URL đầy đủ hay chỉ
tên miền đều được), tên đăng nhập và mật khẩu rồi bấm **"Lưu"**.

**Đăng nhập nhiều tài khoản liên tiếp (kể cả hệ thống bên thứ 3) — không bỏ
sót lượt hỏi lưu nào:**

Trước đây, nếu đăng nhập 2 tài khoản gần nhau về thời gian trên cùng một
trang (ví dụ: đăng nhập hệ thống chính bằng tài khoản A, rồi ngay sau đó
đăng nhập tiếp một widget/hệ thống liên kết của bên thứ 3 bằng tài khoản B),
lượt bắt thứ 2 có thể **ghi đè** lên lượt thứ nhất trước khi banner của A
kịp hiện ra, khiến A bị bỏ sót hoặc — tệ hơn — bấm "Lưu" trên banner đang
hỏi về A nhưng lại vô tình lưu nhầm dữ liệu của B. App giờ xếp các lượt đăng
nhập bắt được vào một **hàng đợi**: mỗi lượt giữ nguyên đúng dữ liệu của
riêng nó, banner nào cũng hỏi đúng tài khoản của lượt đó, và các banner hiện
**lần lượt** (xong lượt này mới tới lượt kế tiếp) — dù đăng nhập bao nhiêu
tài khoản liên tiếp trên cùng một trang, tài khoản nào cũng sẽ được hỏi lưu
đầy đủ, không tài khoản nào bị "trôi" mất.

**Nhận diện form đăng nhập — kể cả cấu trúc HTML "lạ" (modal/drawer/SPA):**

Nhiều trang hiện đại không dùng thẻ `<form>` với sự kiện "submit" truyền
thống nữa (vd hộp thoại đăng nhập dạng modal/drawer bật lên bằng JavaScript,
tự gửi dữ liệu bằng `fetch`/AJAX mà không điều hướng sang trang khác). Để
bắt được các trường hợp này, app dùng **đồng thời nhiều cách nhận diện**
thay vì chỉ dựa vào "submit":

1. **Submit form truyền thống** (cách phổ biến nhất, các hệ thống kiểu HIS
   cũ thường dùng cách này).
2. **Bấm nút có vẻ là nút đăng nhập/xác nhận** (chứa chữ như "Đăng nhập",
   "Login", "Sign in", "Xác nhận"...) — bắt được cả khi trang **không hề có
   thẻ `<form>`**, ví dụ modal/drawer tự dựng bằng `<div>` và xử lý bằng JS.
3. **Bấm phím Enter** trong ô mật khẩu/tên đăng nhập khi ô đó **không nằm
   trong `<form>`** nào cả (một số drawer/modal chỉ lắng nghe phím Enter
   bằng JavaScript thay vì để trình duyệt tự submit).
4. **Theo dõi DOM** để phát hiện ô mật khẩu **xuất hiện sau khi trang đã tải
   xong** (vd modal chỉ được dựng lên khi bấm nút "Đăng nhập" mở popup) —
   khi phát hiện, app tự thử điền lại tài khoản/mật khẩu đã lưu ngay khi ô
   đó vừa xuất hiện, không cần tải lại trang.

Khi tìm ô "tên đăng nhập" đi kèm ô mật khẩu, app ưu tiên tìm trong đúng thẻ
`<form>` bao quanh; nếu không có `<form>` thì lùi về khung modal/drawer/dialog
gần nhất (nhận diện qua `role="dialog"`, `aria-modal`, hoặc class thường gặp
như `.modal`, `.drawer`, `.popup`, `.overlay`...); nếu vẫn không thấy mới lùi
về toàn bộ trang.

Với các trang đăng nhập **không điều hướng sang trang khác** sau khi đăng
nhập (modal/drawer kiểu SPA), banner "Lưu mật khẩu?" không thể đợi tín hiệu
"trang đã tải xong" như cách thông thường — app dùng thêm một cơ chế dự
phòng: sau khi bắt được thao tác đăng nhập khoảng 1.8 giây, nếu ô mật khẩu
đó **không còn hiển thị** trên trang nữa (đã bị ẩn/đóng/gỡ khỏi DOM — dấu
hiệu đăng nhập có khả năng đã thành công) thì mới hỏi lưu; nếu ô đó **vẫn
còn hiển thị y nguyên** (nhiều khả năng đăng nhập thất bại, form vẫn còn mở)
thì bỏ qua, không hỏi. Việc kiểm tra "còn hiển thị hay không" xét CẢ 3 kiểu
ẩn phổ biến của modal/drawer hiện đại (`display:none`, `visibility:hidden`,
`opacity:0`) chứ không chỉ dựa vào việc phần tử còn chiếm chỗ trong layout
hay không — trước đây chỉ xét kiểu ẩn đầu tiên, khiến các modal/drawer dùng
`visibility:hidden` để đóng (cách rất phổ biến ở nhiều thư viện/site tự
build) bị hiểu lầm là "vẫn còn mở" nên **bỏ lỡ việc hỏi lưu** dù đăng nhập
tài khoản khác đã thành công; nay đã được nhận diện đúng.

**Đã sửa: form có nút "con mắt" hiện/ẩn mật khẩu khiến app bỏ lỡ HOÀN TOÀN
việc bắt tài khoản/mật khẩu:**

Rất nhiều form đăng nhập hiện đại (đặc biệt các hệ thống dùng Angular/React
với thư viện giao diện dựng sẵn) có nút hình con mắt bên trong ô mật khẩu để
người dùng bấm xem lại mật khẩu vừa gõ trước khi đăng nhập — bấm nút này chỉ
đổi thuộc tính `type` của CHÍNH ô đó từ `password` sang `text` (không tạo ô
mới). Trước đây, mọi bước nhận diện "đâu là ô mật khẩu" của app đều dựa
**hoàn toàn** vào bộ chọn `input[type="password"]` — nếu người dùng bấm xem
mật khẩu (chuyển ô sang `type="text"`) **trước khi** bấm đăng nhập, ô đó biến
mất khỏi mọi bộ chọn kiểu này, khiến app **không bắt được gì cả** dù đăng
nhập thành công, dù đăng nhập tài khoản mới hay tài khoản đã lưu. Đây là
nguyên nhân phổ biến khiến một số form/modal/drawer thực tế **không bao giờ**
hỏi lưu mật khẩu.

Đã sửa bằng cách đánh dấu (gắn thuộc tính `data-hthv4-pwtag`) MỌI ô ngay từ
lúc nó còn là `type="password"` — dấu này không mất đi dù sau đó ô bị đổi
sang `type="text"` (vẫn là cùng 1 phần tử) — và toàn bộ logic bắt/tự động
điền/kiểm tra của app đều nhận diện ô mật khẩu qua CẢ `type="password"` LẪN
dấu này, nên dù người dùng có xem lại mật khẩu trước khi đăng nhập hay không,
app vẫn nhận đúng ô cần theo dõi.

**Đã sửa: nút "Đăng nhập" dựng bằng thành phần giao diện riêng (custom
element) của hệ thống khiến app không nhận ra đó là nút đăng nhập:**

Chiến lược "bấm nút đăng nhập" (dùng cho modal/drawer không có `<form>` submit
thật) trước đây chỉ coi một phần tử là "nút đăng nhập" nếu nó là một trong
các thẻ/role chuẩn của HTML: `<button>`, `<a>`, `<input type="submit">`,
hoặc có `role="button"`. Nhiều hệ thống thực tế (đặc biệt các bộ giao diện
Angular tự build riêng, ví dụ các thẻ tuỳ biến kiểu `<oh-button>`) dựng nút
bấm bằng **thành phần giao diện riêng của họ**, không mang bất kỳ thẻ/role
chuẩn nào ở trên — khiến app **hoàn toàn không nhận ra** đó là một nút bấm,
bỏ lỡ việc bắt tài khoản/mật khẩu dù đăng nhập thành công. Đây chính là
nguyên nhân xác nhận được qua log chẩn đoán bạn gửi: không có bước nào trong
3 cách bắt (submit form / bấm nút đăng nhập / bấm Enter) được kích hoạt, dù
bạn đã đăng nhập thành công thật sự.

Đã sửa để **không còn giới hạn theo thẻ/role cụ thể nữa** — thay vào đó, app
dò ngược từ đúng điểm vừa bấm lên tối đa 6 cấp cha, tìm phần tử gần nhất có
đoạn chữ ngắn (tối đa 40 ký tự, tránh nhận nhầm cả một khối nội dung dài chỉ
vì nó chứa chữ "đăng nhập" ở đâu đó) khớp với các từ khoá đăng nhập quen
thuộc ("Đăng nhập", "Login", "Xác nhận"...) — bất kể phần tử đó là thẻ HTML
chuẩn hay một thành phần giao diện tự build riêng của hệ thống.

**Chế độ ghi log chẩn đoán (`[HTHV4-DEBUG]`)** mô tả ở mục "Debug" phía dưới
chính là công cụ giúp tìm ra 2 lỗi trên (nút "con mắt" và nút dạng tuỳ biến) —
nếu sau này gặp một trang/hệ thống khác vẫn không hỏi lưu mật khẩu, cứ dùng
lại cách đó (F12, xem console, gửi lại các dòng `[HTHV4-DEBUG]`) để xác định
chính xác nguyên nhân thay vì phải đoán.

**Dropdown chuột phải trên ô tài khoản/mật khẩu — vừa để LƯU NGAY, vừa để
CHỌN NHANH tài khoản đã lưu:**

**Bấm chuột phải** vào ô tên đăng nhập hoặc ô mật khẩu trên bất kỳ trang nào
sẽ hiện một **dropdown nhỏ** ngay tại vị trí vừa bấm (giống 1 menu gợi ý),
với tối đa 2 phần:

1. **"Lưu tài khoản/mật khẩu hiện tại"** — chỉ hiện khi **2 ô đang có sẵn
   nội dung** (đang gõ dở, chưa bấm đăng nhập). Bấm vào đây sẽ **lưu ngay
   lập tức** đúng tài khoản/mật khẩu đang gõ trong 2 ô, **không cần chờ**
   đăng nhập thành công, không cần trang chuyển hướng hay đóng lại — dùng
   cho đúng trường hợp một số hệ thống/trang không khớp với bất kỳ cách
   "đoán" tự động nào của app (xem mục "Debug" phía dưới). Sau khi lưu, một
   thông báo nhỏ màu xanh ở góc trên-phải trang sẽ hiện ra vài giây để xác
   nhận đã lưu xong, 2 ô vẫn giữ nguyên nội dung để bạn tiếp tục bấm đăng
   nhập bình thường.
2. **"Chọn tài khoản đã lưu"** — chỉ hiện khi trang này đã có **từ 1 tài
   khoản đã lưu trở lên**, liệt kê **tên đăng nhập** của các tài khoản đó
   (mật khẩu **không** hiện trong danh sách này). Bấm chọn một tên bất kỳ sẽ
   **điền lại ngay lập tức cả ô tên đăng nhập lẫn ô mật khẩu** bằng đúng cặp
   tài khoản/mật khẩu đó — kể cả khi 2 ô đang có sẵn nội dung khác thì nội
   dung cũ vẫn bị **ghi đè** vì đây là lựa chọn chủ động của người dùng. Tài
   khoản vừa chọn cũng trở thành tài khoản "dùng gần đây nhất" cho trang đó.

Cả hai phần có thể **cùng xuất hiện** trong 1 dropdown (ví dụ: đang gõ 1 tài
khoản mới trong khi trang đã có sẵn tài khoản khác từ trước). Nếu **cả hai ô
đang trống VÀ trang chưa lưu tài khoản nào**, bấm chuột phải sẽ **không** bị
app chặn lại — trình duyệt hiện menu chuột phải mặc định như bình thường
(ví dụ để "Dán").

Bấm **chuột trái** bình thường vào 2 ô này (để gõ, sửa nội dung...) **không**
làm dropdown hiện lên — dropdown chỉ xuất hiện khi chủ động bấm chuột phải,
không xen vào thao tác gõ/đăng nhập thông thường. Dropdown tự đóng khi bấm
ra ngoài, khi bấm phím **Esc**, hoặc ngay sau khi chọn xong một mục.

**Cơ chế bảo mật (quan trọng):**

- Mật khẩu **không bao giờ** được lưu ở dạng văn bản thường. Trước khi ghi
  xuống đĩa, app luôn mã hóa bằng `safeStorage` của chính Electron — trên
  Windows là **DPAPI** (Data Protection API), gắn liền với tài khoản Windows
  đang đăng nhập trên máy đó; trên macOS là Keychain; trên Linux là
  libsecret/kwallet nếu máy có cài. File mã hóa nằm tại:
  - Windows: `%APPDATA%\HTHV4 Browser\credentials.json`
  - Linux: `~/.config/HTHV4 Browser/credentials.json`
  - macOS: `~/Library/Application Support/HTHV4 Browser/credentials.json`
  Nếu copy file này sang máy khác hoặc đăng nhập Windows bằng tài khoản khác,
  DPAPI sẽ **không giải mã được** — đây là hành vi đúng, không phải lỗi.
- Nếu máy hiếm gặp trường hợp `safeStorage` báo "không hỗ trợ mã hóa" (vd một
  số bản Linux thiếu keyring), app vẫn lưu được (không báo lỗi) nhưng chỉ mã
  hóa bằng base64 thô — **không an toàn bằng** DPAPI thật. Trường hợp này
  gần như không xảy ra trên Windows.
- Mật khẩu **không gửi đi đâu cả** — không đồng bộ lên mạng/cloud, chỉ nằm
  trên đúng máy đang chạy app đó (khác với Chrome thật, vốn có thể đồng bộ
  qua tài khoản Google nếu người dùng bật).
- Toàn bộ thao tác đọc/ghi/tự động điền/sao chép clipboard chạy trong tiến
  trình **main** (Node), không đưa `ipcRenderer` hay bất kỳ API Node nào vào
  trang web đang xem — trang web (kể cả trang HIS thật) không có cách nào tự
  đọc được mật khẩu đã lưu. Mật khẩu chỉ được giải mã đúng lúc cần dùng
  (hiện trong Settings, tự động điền, hoặc sao chép), không giữ ở dạng giải
  mã lâu hơn mức cần thiết.

**Vài đơn giản hóa có chủ đích so với Chrome thật** (để giảm độ phức tạp,
không phải thiếu sót bị bỏ quên):

- Bấm "Không, cảm ơn" chỉ bỏ qua **một lần** cho lượt đăng nhập đó — lần
  đăng nhập tiếp theo (nếu mật khẩu khác lần đã lưu hoặc chưa từng lưu) vẫn
  sẽ hỏi lại, không có tùy chọn "không bao giờ hỏi lại cho trang này".
- Việc nhận diện "nút đăng nhập" (chiến lược #2 ở trên) dựa theo chữ hiển
  thị trên nút (tiếng Việt/Anh thông dụng) — nút đăng nhập chỉ có icon,
  không có chữ, hoặc dùng ngôn ngữ khác, có thể không được nhận ra.
- Với trang chia đăng nhập thành **nhiều bước/nhiều màn hình riêng** (vd nhập
  tên đăng nhập ở màn 1, bấm Tiếp tục mới sang màn 2 để nhập mật khẩu), app
  có thể không ghép đúng được cặp tài khoản/mật khẩu vì 2 ô không cùng xuất
  hiện một lúc.
- Cơ chế "đoán đăng nhập thành công hay thất bại" cho form không điều hướng
  trang (mục banner dự phòng ở trên) chỉ dựa vào việc ô mật khẩu còn hiển thị
  hay không — một số trang hiếm gặp có thể khiến app đoán sai (hỏi lưu dù
  đăng nhập thất bại, hoặc ngược lại); nếu lỡ lưu nhầm, vào Settings xóa lại
  mục đó là được.

**Debug: vì sao 1 trang cụ thể không hỏi lưu mật khẩu?**

Nếu gặp đúng 1 trang/modal/drawer thực tế nào đó vẫn không hỏi lưu dù đã thử
đăng nhập, app có ghi lại các bước xử lý (bắt được thao tác đăng nhập hay
không, vì sao có/không, có coi form là "đã đóng" hay "vẫn còn mở" hay
không...) vào **console của trang** — xem được bằng cách:

1. Mở đúng trang/modal/drawer đang gặp vấn đề, bấm **F12** để mở DevTools cho
   nội dung trang (xem mục "Xem lỗi thật của trang web" ở trên).
2. Chuyển sang tab **Console**.
3. Thực hiện lại thao tác đăng nhập như bình thường trên trang đó.
4. Tìm các dòng bắt đầu bằng `[HTHV4-DEBUG]` — các dòng này mô tả từng bước
   (có bắt được thao tác đăng nhập không, ở chiến lược nào, có tìm thấy ô
   tên đăng nhập tương ứng không, ~1.8 giây sau có coi form là "đã đóng" hay
   "vẫn còn mở" hay không...). **Các dòng này không bao giờ in ra mật khẩu
   thật** — chỉ in tên đăng nhập và mô tả trạng thái, an toàn để copy gửi cho
   nhà phát triển khi cần hỗ trợ thêm.
5. Nếu form đó nằm trong một `<iframe>` riêng (khung nhúng của bên thứ 3),
   DevTools có ô chọn frame ở góc trên tab Console/Sources — cần chọn đúng
   frame chứa form đó thì mới thấy log của đúng frame đó (dòng debug đầu tiên
   khi tải trang có ghi rõ đang chạy cho frame nào).
6. Nếu vẫn không tìm ra nguyên nhân (hoặc không muốn mất công debug thêm),
   **không cần đoán nữa** — gõ xong tài khoản/mật khẩu, **bấm chuột phải**
   vào 1 trong 2 ô rồi chọn **"Lưu tài khoản/mật khẩu hiện tại"** (xem mục
   dropdown chuột phải ở trên) để lưu ngay lập tức, trước khi bấm nút đăng
   nhập của trang. Cách này **không phụ thuộc** vào việc app có nhận diện
   đúng nút đăng nhập/form/điều hướng trang hay không, nên luôn hoạt động
   với mọi hệ thống.

## Cửa sổ Ẩn danh (mỗi cửa sổ = 1 session riêng biệt, không lưu gì xuống đĩa)

Nút hình mặt nạ tím (🕵) trên thanh công cụ — **"Mở cửa sổ ẩn danh"** — mở
thêm một **cửa sổ Electron hoàn toàn mới**, tách biệt với cửa sổ chính và với
mọi cửa sổ ẩn danh khác đang mở cùng lúc. Cửa sổ ẩn danh có viền/màu tím và
nhãn **"🕵 Ẩn danh"** ở góc trái thanh công cụ để dễ phân biệt.

**Cách ly tuyệt đối, mỗi cửa sổ một session riêng:**

- Mỗi lần bấm nút này, app tạo một **session Electron trong-bộ-nhớ hoàn toàn
  mới** (không dùng chung với cửa sổ chính hay với bất kỳ cửa sổ ẩn danh nào
  khác), định danh bằng một mã ngẫu nhiên duy nhất mỗi lần mở. Nhờ vậy,
  **Cookie, LocalStorage, SessionStorage, Cache, IndexedDB, Service Worker...**
  của một cửa sổ ẩn danh **không bao giờ** bị trộn lẫn, đọc được, hay ghi đè
  bởi bất kỳ cửa sổ nào khác (kể cả 2 cửa sổ ẩn danh cùng mở 1 trang HIS,
  cùng lúc đăng nhập 2 tài khoản khác nhau, vẫn hoàn toàn độc lập).
- Có thể mở **nhiều cửa sổ ẩn danh cùng lúc** (5, 10 hay nhiều hơn) — mỗi cửa
  sổ vẫn giữ session riêng của nó, không giới hạn số lượng.

**Không lưu gì xuống ổ cứng — đóng cửa sổ là xóa sạch ngay lập tức:**

- Toàn bộ dữ liệu phiên (cookie, localStorage, cache...) của một cửa sổ ẩn
  danh chỉ tồn tại **trong bộ nhớ RAM** khi cửa sổ đó còn mở — không ghi
  xuống đĩa như session của cửa sổ chính.
- Ngay khi **đóng cửa sổ ẩn danh đó** (bấm nút X của đúng cửa sổ đó, không
  ảnh hưởng các cửa sổ khác), app **xóa sạch ngay lập tức** toàn bộ dữ liệu
  phiên của nó. Đóng cả app cũng có tác dụng tương tự với mọi cửa sổ ẩn danh
  còn đang mở.

**Mật khẩu đã lưu vẫn dùng chung bình thường:**

- Khác với dữ liệu phiên đăng nhập (cookie/localStorage...), **danh sách
  tài khoản/mật khẩu đã lưu** (mục "Mật khẩu đã lưu" ở Settings) là **dùng
  chung** giữa cửa sổ chính và mọi cửa sổ ẩn danh — vì đây là dữ liệu của
  chính app (đã mã hóa, lưu riêng trong `credentials.json`), không phải dữ
  liệu của session trình duyệt. Nghĩa là: có thể lưu mật khẩu từ cửa sổ ẩn
  danh, rồi thấy/dùng lại được ở cửa sổ chính hoặc cửa sổ ẩn danh khác, và
  ngược lại — chỉ riêng phần "đang đăng nhập hay không" (cookie/session) là
  bị cách ly.

## Xóa cache (khi trang báo lỗi dù server đã sửa)

Bấm ⚙ Settings → **"Xóa cache & tải lại trang"**. Nút này xóa cache HTTP,
Service Worker và Cache Storage của khung xem trang (nơi hay giữ lại bản
JS/PDF-viewer cũ, gây ra các lỗi khó hiểu như "vẫn báo thiếu hàm dù code mới
trên server đã có sẵn"), rồi tải lại trang bằng `reloadIgnoringCache()`.
Cookie/đăng nhập được giữ nguyên, không bị đăng xuất.

## Cấu trúc project

```
src/
  main.js      - tien trinh chinh: tao cua so, quan ly nhieu BrowserView
                 (moi tab la 1 BrowserView), tiem polyfill qua CDP, menu
                 chuot phai, luu/doc URL
  preload.js   - cau noi an toan (contextBridge) giua renderer va main
  index.html   - giao dien: thanh cong cu + thanh tab (dieu khien BrowserView
                 qua IPC), overlay Settings
package.json   - script npm + cau hinh electron-builder (build .exe/.AppImage/.dmg)
```

## Ghi chú

- Nội dung trang web được Electron vẽ bằng `BrowserView` (native), không phải
  `<webview>`/`<iframe>` trong renderer — toolbar (`index.html`) chỉ gửi lệnh
  điều khiển (back/forward/reload/URL...) qua IPC tới main process, nơi thực
  sự điều hướng `BrowserView`.
- Link mở ở tab mới (target `_blank`, `window.open()`) sẽ mở thành một tab mới
  ngay trong app (xem mục "Nhiều tab" ở trên), trừ khi đã đạt giới hạn 10 tab —
  lúc đó mới rơi về mở bằng trình duyệt mặc định của hệ điều hành.
- Muốn đổi icon app: thay `build.win.icon` / `build.mac.icon` / `build.linux.icon`
  trong `package.json` trỏ tới file `.ico` / `.icns` / `.png` của bạn.
- File `credentials.json` (mật khẩu đã lưu, đã mã hóa) nằm cùng thư mục với
  `config.json` (URL mặc định) — xem mục "Lưu tài khoản / mật khẩu" ở trên
  để biết đường dẫn chính xác theo từng hệ điều hành.
- Nếu bạn tự mở DevTools trong app (Ctrl+Shift+I) để debug, lưu ý app cũng tự
  gắn một CDP debugger vào `BrowserView` để tiêm polyfill — trên lý thuyết có
  thể xung đột với DevTools thủ công trong vài trường hợp hiếm; nếu gặp lỗi khi
  mở DevTools, thử tắt/mở lại app.
