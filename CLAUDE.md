# FarmX Counter — web-app đếm con giống (Tray v1)

## Dự án là gì
PWA chạy trên điện thoại, mở bằng link. Đếm tôm PL / tôm ương / cá giống trên khay 50×35 cm đặt trong thùng 90 L, camera điện thoại cách khay 40 cm. Chủ dự án: Hải Đăng, xưởng cơ khí Cà Mau. Ngôn ngữ giao tiếp: tiếng Việt. Người dùng: trại giống, tay ướt, ngoài trời → nút to, ít chữ.

## Kiến trúc (giữ nguyên)
- Static site, KHÔNG build step: `index.html` + `app.js` + `sw.js` + `manifest.json` + `icon.svg` ở gốc repo. Cloudflare Pages deploy thẳng (build command trống, output `/`).
- AI chạy trong trình duyệt, KHÔNG dùng OpenCV.js (đã bỏ ở v0.6, nó nặng 10 MB). Đọc mã ArUco bằng js-aruco2 tự host trong `lib/` (`cv.js` + `aruco.js` + `aruco_4x4_1000.js`, tổng 54 KB); homography và nắn khay tự viết thuần JS trong `app.js`. ONNX Runtime Web vẫn tải từ jsdelivr, chỉ khi có model. Model YOLO11n ONNX tự host trong `model/`: `dem_v01.onnx` (mặc định) và `dem_v0.onnx` (giữ để đối chiếu). Cùng kiến trúc: 10,6 MB, opset 12, input `[1,3,1280,1280]`, output `[1,5,33600]`, 1 class `shrimp`. Chọn bản nào trong Cài đặt > Nâng cao (`localStorage.modelChon`).
- Supabase project `farmx-web` (xofhpbfiuolkcbwbxume): bảng `counter_lo`, `counter_anh_gop`, `counter_model`; bucket `counter-anh` (riêng tư), `counter-model` (public). Anon key nằm trong `app.js`. Chỉ ghi lô + ảnh góp opt-in; không xử lý AI trên server.
- Lưu cục bộ: IndexedDB `farmx` store `lo`; nháp lô trong localStorage `loNhap`.
- Service worker: file cùng origin = mạng trước cache sau; thư viện CDN = cache trước. Đổi tên `CACHE` trong `sw.js` khi phát hành.

## Khay và mã ArUco
- 6 mã ArUco ID 0–5 (4 góc + 2 giữa cạnh dài), tự điển DICT_4X4_50.
- Cạnh mã in ra bao nhiêu mm **không còn quan trọng** (từ v1.0). Mọi kích thước tính theo *đơn vị mã*: `MA_DV = 25` là cạnh một mã, `LE_DEM = 30` (1,2 lần cạnh mã), `CHE_MA = 35` (1,4 lần). Bản in A4 25 mm hay sticker 17 mm đều chạy đúng như nhau, không phải chọn gì.
- js-aruco2 không có DICT_4X4_50; dùng `ARUCO_4X4_1000`, 50 mã đầu trùng OpenCV. `timMa()` lọc bỏ ID > 5.
- **Không còn `TAM_MA` và không còn hiệu chuẩn** (từ v1.0). `matPhang()` dựng lại mặt phẳng khay từ chính các mã trong từng tấm ảnh, mỗi lần chụp một lần, không lưu gì.

## Vùng đếm
- `vungDem()` suy từ tâm các mã **thấy được trong chính tấm ảnh đó**: hình chữ nhật nối các tâm, **thụt vào `LE_DEM` mỗi phía**.
- Trước khi đưa vào model, tô xám ô **35×35 mm** quanh mỗi mã (`CHE_MA`) để model không đếm nhầm mã. Với khay hiện tại các ô này nằm trọn ngoài vùng đếm nên chưa kích hoạt — giữ làm bảo hiểm khi mã dán lệch vào trong.
- Ảnh nắn có kích thước `vùng đếm × PX_DV`, PX_DV = 2. Không hardcode kích thước ảnh nắn.
- Cần **≥ 3 mã**; dưới đó báo "Không thấy khay — chỉnh lại điện thoại". Lưu ý: thiếu mã thì hình chữ nhật nối tâm nhỏ đi, nên **vùng đếm co lại** và số đếm giữa các lần chụp không so sánh được. Muốn số ổn định thì phải thấy đủ 6 mã.

## Bẫy đã gặp — đừng lặp
- KHÔNG hardcode `TAM_MA`/kích thước ảnh nắn. Mọi thứ suy từ `tam` của bản hiệu chuẩn.
- Sai số khớp homography tính trên 6 **tâm** mã luôn ra ~0 và **vô nghĩa** — tâm mm sinh ra từ chính homography đó. Chỉ số thật là sai số tái chiếu trên **24 góc** mà `hieuChuan()` trả về (`saiSo.rms`).
- `matPhang()` khử phối cảnh bằng ràng buộc "mỗi mã là hình vuông bằng nhau" (hàm `epVuong`); nếu chỉ chiếu tâm theo tỉ lệ thì góc chụp nghiêng sẽ méo thẳng vào ảnh nắn.
- Ảnh iPhone 3024×4032 dò mã mất ~1,2 s. `timMa()`/`nanTuDong()`/`matPhang()` tự thu nhỏ về cạnh dài 1600 px (`CANH_DAI_DO`) trước khi xử lý → còn ~270 ms; giữ ảnh gốc cho model.

## Việc tiếp theo
1. ~~Hiệu chuẩn~~ — bỏ hẳn ở v1.0, thay bằng nắn tự động trong từng tấm ảnh (sai số tái chiếu 1,22 px RMS trên `tools/mau/khay-trong.jpg`, bằng đúng bản hiệu chuẩn cũ).
2. Sửa tay kết quả đếm (chạm thêm/bỏ box).
3. PDF 1 trang + chia sẻ Zalo (jsPDF hoặc canvas → ảnh).
4. Gắn model khi có `dem_v1.onnx`; hậu xử lý YOLO đã có trong `demYolo()`.
5. Cân nhắc: dán mã sát mép khay hơn. Hiện 6 mã chỉ trải 363×288 mm nên vùng đếm còn 303×228 mm — nếu khay đúng 50×35 cm thì chỉ đếm được ~39% diện tích.

## Ảnh mẫu
`tools/mau/khay-trong.jpg` (chuẩn) và `khay-trong-2.jpg` (có phản chiếu) — khay trống, iPhone 3024×4032, đủ 6 mã. Dùng để chạy lại test đọc mã + hiệu chuẩn sau mỗi lần sửa.

## Quy ước
- Tiếng Việt có dấu trong UI, biến/hàm tiếng Việt không dấu như code hiện tại.
- Không thêm framework/build; giữ 1 file JS.
- Test nhanh: mở `index.html` qua http server local; camera cần https hoặc localhost.
- Sau khi push, Cloudflare tự deploy; kiểm tra trên điện thoại thật, mở link 2 lần để SW cập nhật.
- Mỗi lần sửa: tăng `PHIEN_BAN` trong `app.js` và tên `CACHE` trong `sw.js` trong cùng commit.

## Luồng người dùng (v1.0) — đúng 4 bước, không hơn
1. `man-loai`: "Đếm con gì?" 3 nút to. Nhớ ở `localStorage.loaiCon`; lần sau vào thẳng bước 2, đổi bằng chip góc trên video.
2. `man-dem`: camera tự bật, một nút tròn đỏ giữa dưới. iOS lần đầu cần một chạm → hiện nút "Bật camera" dự phòng.
3. Bấm → nút xoay, chữ "Đang đếm…", tự chụp 3 khung cách nhau 600 ms (tổng ~1,5 s), lấy trung vị. Đừng rút ngắn: 3 khung sát nhau gần như giống hệt thì trung vị mất tác dụng lọc.
4. `man-kq`: số to + ảnh khoanh, hai nút [Chụp tiếp] [Lưu vào lô].
   - Chưa có model: số hiện "—", dòng "Model đang cập nhật", nút Lưu mờ.
   - Dưới 3 mã: thay số bằng "Không thấy khay — chỉnh lại điện thoại", chỉ còn nút [Chụp lại].

Không thêm bước, không thêm nút vào luồng này. Thông số kỹ thuật nằm trong Cài đặt > Nâng cao (đóng sẵn).

## Quy tac giao dien (v1.1) — khong duoc pha
- **Khong bao gio de man den im lang.** Mọi trạng thái phải có chữ trên video trong 1 giây:
  `trangThai(chính, phụ, kiểu)` — "Đang bật camera…", "Không mở được camera — chạm để thử lại"
  (chạm vào `.khung` xin lại quyền), "Thấy n/6 mã", "Lỗi: …".
- **Mọi cú bấm phải có phản hồi.** Nút chụp xám + ghi lý do ngay dưới nút khi không chụp được.
  Bấm được thì rung + vòng xoay + "Đang đếm…" trước mọi việc nặng.
- **Không nuốt lỗi.** `vongKiemTra` và `demKhay` đều bọc try/catch và đẩy `Lỗi: …` ra màn hình.
- `nhuong()` chạy đua `requestAnimationFrame` với `setTimeout(50)`: rAF **không chạy khi tab ẩn
  hoặc màn hình tắt**, dùng rAF trần sẽ treo cứng cả luồng chụp.
- 3 ô kiểm `veKiem(n)`: Camera / Khay / Model. Ngưỡng mã (`MA_TOI_THIEU = 4`):
  6/6 xanh, 4–5 vàng "vẫn chụp được", dưới 4 đỏ và nút xám. `demKhay` cũng chỉ nhận
  khung ≥ 4 mã — khung ít mã hơn có vùng đếm nhỏ hơn, trộn vào trung vị sẽ làm lệch số.
  Lưu ý: chụp ở 4–5 mã thì vùng đếm nhỏ hơn lúc đủ 6 mã, **số giữa các lần chụp không
  so sánh trực tiếp được**. Muốn số ổn định thì phải thấy đủ 6 mã.
- Thanh 4 bước `moBuoc()`: mỗi bước hiện ít nhất 300 ms. Kết quả ghi "Xong 4/4" / "Dừng ở bước n/4".

## Model
- `model/dem_v01.onnx` (mặc định) và `model/dem_v0.onnx` — YOLO11n từ Ultralytics 8.4.142, train imgsz 640 trên patch, export imgsz 1280. Hai file trùng dung lượng nhưng khác trọng số (SHA-256 khác, export 03:05 vs 06:08 ngày 6/9/2026).
- Hậu xử lý trong `demYolo()` khớp `[1, 4+nc, N]`; không sửa gì khi đổi model cùng dạng.
- Suy luận **2,5–3,2 s mỗi khung** trên wasm (đo trên Mac). Ba khung ≈ 8–10 s. Trên iPhone có WebGPU
  sẽ nhanh hơn; `executionProviders` đã để `["webgpu","wasm"]`.
- Khay trống: 0 con ở cả conf 0,25 lẫn 0,05, trên cả hai ảnh mẫu → không có báo động giả.
- **Giấy phép: AGPL-3.0** (Ultralytics). Cân nhắc trước khi bán box kèm model này.

## Dòng nhắc kỹ thuật
"Nước sạch, mỏng ~5 mm — rác lắng đáy, tôm dễ thấy" — hiện 3 giây trên video, có nút X, tự ẩn.
Nhắc **một lần cho mỗi lô** (cờ `daNhacLo`, đặt lại khi xong lô hoặc hủy lô), không nhắc lại
sau mỗi lần "Chụp tiếp" — nhắc mọi lần vào màn Đếm sẽ thành phiền.
Tắt được ở Cài đặt > "Nhắc trước khi chụp" (`localStorage.nhac`, mặc định bật).

## Gộp cụm sau NMS (`gopCum`)
NMS chỉ bỏ khung **chồng nhau nhiều**. Hai khung tách rời cùng nằm trên một con (đầu và đuôi)
có IoU nhỏ nên NMS không dọn được — `gopCum()` mới dọn được.
- Hai khung có tâm cách nhau < `heSoGop × chiều dài trung vị` thì coi là một con, giữ khung điểm cao hơn.
- "Chiều dài" = cạnh dài của khung. Trung vị **ước từ chính lô khung của ảnh đó**, nên tự thích nghi
  với cỡ con giống và độ phóng đại của ảnh nắn — không phải chỉnh khi đổi loại con.
- Duyệt theo điểm giảm dần, giữ khung nếu nó không nằm trong ngưỡng của khung đã giữ. Nghĩa là
  một chuỗi khung sát nhau sẽ gộp hết về một.
- Hệ số mặc định **riêng theo model** (`HE_SO_MD`): `dem_v01` = 1,2, `dem_v0` = 0,8. Model khác cho
  ra khung to nhỏ khác nhau nên ngưỡng gộp phải khác. Chỉnh tay thì lưu riêng theo model trong
  `localStorage.heSoGopTheoModel` (JSON `{model: hệ số}`); đổi model là lấy lại hệ số của model đó,
  không dính hệ số vừa chỉnh cho model kia.
- Màn kết quả hiện "Trước gộp X · sau gộp Y (hệ số Z)" chữ nhỏ xám dưới ảnh.

## onnxruntime-web tự host (v1.5)
`lib/ort/` host **hai bộ**, chọn theo `navigator.gpu` (bảng `ORT_BO`):
- có WebGPU → `ort.webgpu.min.js` + `ort-wasm-simd-threaded.jsep.{mjs,wasm}` (**21,3 MB**)
- không có → `ort.wasm.min.js` + `ort-wasm-simd-threaded.{mjs,wasm}` (**11,0 MB**)
Máy Android không WebGPU khỏi phải tải bản 21 MB. **Không còn CDN nào trong repo.**
`taiCoTienDo()` tải sẵn file .wasm bằng stream để báo tiến độ — ORT tự fetch thì không hook được;
tải sẵn xong ORT lấy lại từ cache. Timeout 90 s bằng AbortController + Promise.race.
Chạm vào ô Model để tải lại khi hỏng.
- `ort.env.wasm.wasmPaths` phải là **URL tuyệt đối** (`new URL("./lib/ort/", document.baseURI).href`).
  ORT giải wasmPaths tương đối với chính file `ort.webgpu.min.js`, đưa `"./lib/ort/"` vào sẽ thành
  `/lib/ort/lib/ort/…` rồi 404. Đây đúng là lỗi làm model chết trên máy khác.
- `numThreads = 1`, `proxy = false`: nhiều máy Android không có SharedArrayBuffer hoặc chặn worker.
- Thử `["webgpu"]` trước rồi mới `["wasm"]`, **tách riêng từng lần** — truyền cả mảng
  `["webgpu","wasm"]` thì ORT có thể tự rơi về wasm mà mình vẫn tưởng đang chạy webgpu.
- `_headers` bật COOP/COEP cho Cloudflare Pages. **Hệ quả: mọi tài nguyên cross-origin từ nay
  phải có CORP/CORS, thêm lại script từ CDN sẽ bị chặn.**
- `sw.js` cache-trước cho cả `/model/` và `/lib/ort/` — nếu để rơi vào nhánh mạng-trước thì mỗi
  lần mở app sẽ tải lại hơn 30 MB.
- Tốc độ đo được: webgpu ~290 ms/khung, wasm ~1.300–2.900 ms/khung.

## Sửa tay ở màn kết quả (v1.7)
`suaTay = { anhNan, hop:[{b,xoa,them}], lichSu, soMay }`. `#anh-kq` nay là **canvas**, không phải img.
- Chạm vào khung → `xoa = true` (đỏ mờ). Chạm lại khung đã xoá → phục hồi. Chạm chỗ trống → thêm
  khung xanh dương cỡ trung vị. "Hoàn tác" lần ngược `lichSu`.
- Khung xoá **không bị gỡ khỏi mảng**, chỉ đánh cờ → chỉ số ổn định, hoàn tác không lệch.
  Khung thêm luôn push cuối mảng nên `splice` khi hoàn tác luôn đúng phần tử.
- Chọn khung ảnh có số hộp **bằng đúng trung vị** để hiện, không lấy khung cuối — trước v1.7 số hiện
  là trung vị mà hộp vẽ ra lại của khung cuối, hai thứ có thể lệch nhau.
- Lô lưu **cả hai dãy**: `khay` (số chốt, dùng cộng tổng) và `khayMay` (số máy đếm). Bản ghi lô thêm
  `so_con_may` và `so_sua`. `counter_anh_gop` gửi đúng cặp `so_may_dem` / `so_sau_sua` — trước đây
  gửi cùng một số cho cả hai cột nên vô dụng cho việc train.
- **Ảnh góp là ảnh nắn SẠCH**, không vẽ khung sửa tay lên, để còn dùng làm dữ liệu train.
