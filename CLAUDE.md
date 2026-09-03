# FarmX Counter — web-app đếm con giống (Tray v1)

## Dự án là gì
PWA chạy trên điện thoại, mở bằng link. Đếm tôm PL / tôm ương / cá giống trên khay 50×35 cm đặt trong thùng 90 L, camera điện thoại cách khay 40 cm. Chủ dự án: Hải Đăng, xưởng cơ khí Cà Mau. Ngôn ngữ giao tiếp: tiếng Việt. Người dùng: trại giống, tay ướt, ngoài trời → nút to, ít chữ.

## Kiến trúc (giữ nguyên)
- Static site, KHÔNG build step: `index.html` + `app.js` + `sw.js` + `manifest.json` + `icon.svg` ở gốc repo. Cloudflare Pages deploy thẳng (build command trống, output `/`).
- AI chạy trong trình duyệt: OpenCV.js (ArUco, nắn khay) từ `https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js`, ONNX Runtime Web từ jsdelivr. Model YOLO11n ONNX tải từ Supabase bucket `counter-model/dem_v1.onnx` (chưa có → app báo "chưa có model", vẫn nắn khay được).
- Supabase project `farmx-web` (xofhpbfiuolkcbwbxume): bảng `counter_lo`, `counter_anh_gop`, `counter_model`; bucket `counter-anh` (riêng tư), `counter-model` (public). Anon key nằm trong `app.js`. Chỉ ghi lô + ảnh góp opt-in; không xử lý AI trên server.
- Lưu cục bộ: IndexedDB `farmx` store `lo`; nháp lô trong localStorage `loNhap`.
- Service worker: file cùng origin = mạng trước cache sau; thư viện CDN = cache trước. Đổi tên `CACHE` trong `sw.js` khi phát hành.

## Bẫy đã gặp — đừng lặp
- KHÔNG `await window.cv`: Emscripten Module có `.then` trả về chính nó → treo trình duyệt. Poll `cv.Mat` như trong `taiOpenCV()`.
- `cv.aruco_ArucoDetector` cần 3 tham số (dict, params, RefineParameters). Dictionary lấy bằng `cv.getPredefinedDictionary(cv.DICT_4X4_50)`.
- docs.opencv.org hay 503 → dùng jsdelivr techstark.
- Khay: 6 mã ArUco ID 0–5 (4 góc + 2 giữa cạnh dài), cạnh mã 17 mm. `TAM_MA` trong `app.js` và `dem_khay.py` phải khớp nhau.

## Việc tiếp theo (theo tools/farmx-tray-v1-viec-ky-thuat.md)
1. Hiệu chuẩn từ ảnh khay trống: tự tính vị trí 6 mã từ kích thước mã 17 mm, lưu localStorage, thay cho `TAM_MA` cố định.
2. Sửa tay kết quả đếm (chạm thêm/bỏ box).
3. PDF 1 trang + chia sẻ Zalo (jsPDF hoặc canvas → ảnh).
4. Gắn model khi có `dem_v1.onnx`; hậu xử lý YOLO đã có trong `demYolo()`.

## Quy ước
- Tiếng Việt có dấu trong UI, biến/hàm tiếng Việt không dấu như code hiện tại.
- Không thêm framework/build; giữ 1 file JS.
- Test nhanh: mở `index.html` qua http server local; camera cần https hoặc localhost.
- Sau khi push, Cloudflare tự deploy; kiểm tra trên điện thoại thật, mở link 2 lần để SW cập nhật.
