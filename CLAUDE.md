# FarmX Counter — web-app đếm con giống (Tray v1)

## Dự án là gì
PWA chạy trên điện thoại, mở bằng link. Đếm tôm PL / tôm ương / cá giống trên khay 50×35 cm đặt trong thùng 90 L, camera điện thoại cách khay 40 cm. Chủ dự án: Hải Đăng, xưởng cơ khí Cà Mau. Ngôn ngữ giao tiếp: tiếng Việt. Người dùng: trại giống, tay ướt, ngoài trời → nút to, ít chữ.

## Kiến trúc (giữ nguyên)
- Static site, KHÔNG build step: `index.html` + `app.js` + `sw.js` + `manifest.json` + `icon.svg` ở gốc repo. Cloudflare Pages deploy thẳng (build command trống, output `/`).
- AI chạy trong trình duyệt, KHÔNG dùng OpenCV.js (đã bỏ ở v0.6, nó nặng 10 MB). Đọc mã ArUco bằng js-aruco2 tự host trong `lib/` (`cv.js` + `aruco.js` + `aruco_4x4_1000.js`, tổng 54 KB); homography và nắn khay tự viết thuần JS trong `app.js`. ONNX Runtime Web vẫn tải từ jsdelivr, chỉ khi có model. Model YOLO11n ONNX tải từ Supabase bucket `counter-model/dem_v1.onnx` (chưa có → app báo "chưa có model", vẫn nắn khay được).
- Supabase project `farmx-web` (xofhpbfiuolkcbwbxume): bảng `counter_lo`, `counter_anh_gop`, `counter_model`; bucket `counter-anh` (riêng tư), `counter-model` (public). Anon key nằm trong `app.js`. Chỉ ghi lô + ảnh góp opt-in; không xử lý AI trên server.
- Lưu cục bộ: IndexedDB `farmx` store `lo`; nháp lô trong localStorage `loNhap`.
- Service worker: file cùng origin = mạng trước cache sau; thư viện CDN = cache trước. Đổi tên `CACHE` trong `sw.js` khi phát hành.

## Khay và mã ArUco
- 6 mã ArUco ID 0–5 (4 góc + 2 giữa cạnh dài), tự điển DICT_4X4_50.
- **Cạnh mã (viền đen ngoài cùng) = 25 mm** với bản in A4 đang dùng. Sticker in sau này 17 mm — không sửa code, chọn trong màn Cài đặt (`#cd-ma-mm`, lưu ở `localStorage.maMM`).
- js-aruco2 không có DICT_4X4_50; dùng `ARUCO_4X4_1000`, 50 mã đầu trùng OpenCV. `timMa()` lọc bỏ ID > 5.
- `TAM_MA` mặc định trong `app.js` là số đo cũ và **không khớp khay thật** (sai tới 79 px khi khớp homography). Luôn bấm Hiệu chuẩn trước khi đếm thật; `TAM_MA` chỉ còn là giá trị dự phòng.

## Vùng đếm (từ v0.7)
- Nguồn sự thật duy nhất là `tam` (tâm 6 mã theo mm). `vungDem()` suy ra vùng đếm: hình chữ nhật nối các tâm mã, **thụt vào 30 mm mỗi phía** (`LE_DEM`).
- Trước khi đưa vào model, tô xám ô **35×35 mm** quanh mỗi mã (`CHE_MA`) để model không đếm nhầm mã. Với khay hiện tại các ô này nằm trọn ngoài vùng đếm nên chưa kích hoạt — giữ làm bảo hiểm khi mã dán lệch vào trong.
- Ảnh nắn có kích thước `vùng đếm (mm) × PX_MM`, PX_MM = 2. Không hardcode kích thước ảnh nắn.

## Bẫy đã gặp — đừng lặp
- KHÔNG hardcode `TAM_MA`/kích thước ảnh nắn. Mọi thứ suy từ `tam` của bản hiệu chuẩn.
- Sai số khớp homography tính trên 6 **tâm** mã luôn ra ~0 và **vô nghĩa** — tâm mm sinh ra từ chính homography đó. Chỉ số thật là sai số tái chiếu trên **24 góc** mà `hieuChuan()` trả về (`saiSo.rms`).
- `hieuChuan()` phải khử phối cảnh bằng ràng buộc "mỗi mã là hình vuông 25 mm" (hàm `epVuong`), nếu chỉ chiếu tâm theo tỉ lệ thì góc chụp nghiêng sẽ bị ghi thẳng vào bảng hiệu chuẩn.
- Ảnh iPhone 3024×4032 dò mã mất ~1,2 s. `timMa()`/`nanKhay()`/`hieuChuan()` tự thu nhỏ về cạnh dài 1600 px (`CANH_DAI_DO`) trước khi xử lý → còn ~270 ms; giữ ảnh gốc cho model.

## Việc tiếp theo
1. ~~Hiệu chuẩn từ ảnh khay trống~~ — xong ở v0.7, khử phối cảnh bằng 24 góc, sai số tái chiếu 1,21 px RMS trên `tools/mau/khay-trong.jpg`.
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
