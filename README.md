# HTHV4 Browser

Trình duyệt Electron tối giản, mặc định mở `https://hthv4.vnpthis.vn/`, có thanh
công cụ (back / forward / reload / home / thanh địa chỉ), **nhiều tab (tối đa
3)**, **tự động cập nhật qua GitHub Releases**, và màn hình **Settings** để
đổi URL mặc định bất cứ lúc nào — không cần build lại app.

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

1. Sửa code xong, **tăng số phiên bản** trong `package.json` (trường
   `"version"`, vd `1.0.0` → `1.0.1`). Đây là bước bắt buộc — GitHub Releases
   và electron-updater xác định "có bản mới hay không" dựa vào số này.
2. Tạo 1 **GitHub Personal Access Token** (Settings → Developer settings →
   Personal access tokens) có quyền ghi vào repo `trinhduyet_release` (repo
   Public thì chỉ cần quyền `public_repo`, hoặc fine-grained token với quyền
   "Contents: Read and write" cho riêng repo đó).
3. Chạy (trên máy đã cài Wine nếu build từ Linux, xem mục trên):
   ```bash
   GH_TOKEN=dan_token_vao_day npm run dist:win:publish
   ```
   Lệnh này build xong sẽ **tự động tạo 1 GitHub Release mới** (tag dạng
   `v1.0.1`) trong repo `trinhduyet_release` và tải lên đúng 3 file cần thiết:
   file `.exe`, file `.exe.blockmap` (dùng để tải bản vá nhỏ thay vì tải lại
   toàn bộ), và `latest.yml` (file mà `electron-updater` đọc để biết có bản
   mới).
4. Xong — các máy đang chạy bản cũ sẽ tự phát hiện và tải bản mới trong lần
   kiểm tra kế tiếp (tối đa 4 tiếng, hoặc ngay lập tức nếu người dùng bấm
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

## Nhiều tab (tối đa 3) & mở link trong tab mới

App hỗ trợ tối đa **3 tab** cùng lúc, hiển thị trên thanh tab nằm ngay dưới
toolbar:

- Bấm nút **`+`** ở cuối thanh tab để mở tab mới (chạy trang mặc định đã cấu
  hình trong Settings). Nút này tự động bị mờ/vô hiệu hoá khi đã mở đủ 3 tab.
- Bấm vào một tab để chuyển sang tab đó; các tab không hiển thị vẫn giữ
  nguyên trạng thái (không bị tải lại) khi quay lại.
- Bấm dấu **×** trên tab để đóng tab đó. Không thể đóng khi chỉ còn 1 tab
  (luôn phải còn ít nhất 1 tab mở).
- **Click phải vào một liên kết (link)** trong trang → chọn **"Mở liên kết
  trong tab mới"** để mở link đó ở tab mới mà không rời khỏi trang hiện tại.
  Mục này bị mờ/vô hiệu hoá kèm ghi chú khi đã đạt giới hạn 3 tab. Menu chuột
  phải cũng có sẵn "Sao chép địa chỉ liên kết", "Sao chép" (khi bôi đen chữ)
  và "Dán" (khi đang gõ vào ô nhập liệu).

**Thay đổi hành vi cần lưu ý:** trước đây, các liên kết mở ở "tab mới"
(`target="_blank"`, hoặc trang tự gọi `window.open()`) sẽ mở bằng trình
duyệt mặc định của hệ điều hành (Chrome/Edge...). Từ bản này, chúng sẽ mở
**ngay trong app** dưới dạng một tab mới, để giữ người dùng trong luồng làm
việc của trang HIS. Nếu đã mở đủ 3 tab thì mới rơi về mở bằng trình duyệt hệ
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
  ngay trong app (xem mục "Nhiều tab" ở trên), trừ khi đã đạt giới hạn 3 tab —
  lúc đó mới rơi về mở bằng trình duyệt mặc định của hệ điều hành.
- Muốn đổi icon app: thay `build.win.icon` / `build.mac.icon` / `build.linux.icon`
  trong `package.json` trỏ tới file `.ico` / `.icns` / `.png` của bạn.
- Nếu bạn tự mở DevTools trong app (Ctrl+Shift+I) để debug, lưu ý app cũng tự
  gắn một CDP debugger vào `BrowserView` để tiêm polyfill — trên lý thuyết có
  thể xung đột với DevTools thủ công trong vài trường hợp hiếm; nếu gặp lỗi khi
  mở DevTools, thử tắt/mở lại app.
