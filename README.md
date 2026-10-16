# Nguồn tiếng Việt cho Paperback 0.8

Nguồn đọc truyện cho app Paperback (iOS), API 0.8:

| Nguồn | Web | Version |
|---|---|---|
| TruyenQQ | https://truyenqqko.com | 1.2.2 |
| NetTruyen | https://nettruyen.gg | 1.0.2 |

Mỗi nguồn có: trang chủ, tìm theo tên, lọc theo một thể loại, chi tiết truyện,
danh sách chương, đọc chương, Cloudflare bypass.

- TruyenQQ: trang chủ gồm Mới cập nhật, Yêu thích.
- NetTruyen: trang chủ gồm Mới cập nhật, Top tháng, Hoàn thành (đều lấy từ `/tim-truyen`). Nếu trang truyện
  không có sẵn danh sách chương, nguồn gọi API `ComicService.asmx/ChapterList`.

## Cấu trúc

| Đường dẫn | Nội dung |
|---|---|
| `src/<Nguồn>/<Nguồn>.ts` | Lớp nguồn: request, trang chủ, tìm kiếm, Cloudflare |
| `src/<Nguồn>/<Nguồn>Parser.ts` | Đọc HTML của web |
| `src/<Nguồn>/includes/icon.png` | Icon nguồn |
| `shared/utils.ts` | Hàm dùng chung: URL, ảnh lazy-load, ngày giờ, số chương, phân trang |
| `0.8/` | **Bản build** mà Paperback tải về; sinh bằng `npm run build`, không sửa tay |
| `scripts/smoke-test.js` | Chạy bản build trong môi trường giả lập app với HTML mẫu ở `scripts/fixtures/` |

Mỗi thư mục trong `src/` phải là một nguồn (`src/X/X.ts`); code dùng chung để ở `shared/`.

## Build và kiểm tra

```bash
npm install
npm run build   # kiểm kiểu, đóng gói bằng @paperback/toolchain, chép bundles/0.8 -> 0.8
npm test        # build rồi chạy smoke test (không gọi mạng)
```

Thử trực tiếp trên máy: `npm run serve`, rồi trong Paperback thêm repo
`http://<IP-máy-tính>:8080` (cùng mạng Wi-Fi).

## Thêm vào Paperback (iPhone/iPad)

1. Paperback → **Settings** → **Extensions** → **Edit** (góc trên phải) → **+** (góc trên trái).
   Bản cũ hơn ghi là **External Sources**.
2. Dán URL: `https://raw.githubusercontent.com/trungtoan46/paperback/main/0.8`
   (hoặc dán link sau vào thanh địa chỉ Safari để mở thẳng app:
   `paperback://addRepo?displayName=Nguon%20Viet&url=https%3A%2F%2Fraw.githubusercontent.com%2Ftrungtoan46%2Fpaperback%2Fmain%2F0.8`)
3. Trở lại **Extensions**, mở repo vừa thêm, cài **TruyenQQ** và/hoặc **NetTruyen**.
4. Nếu báo lỗi Cloudflare: Settings → Sources → chọn nguồn → **Cloudflare Bypass**,
   đợi trang web tải xong rồi đóng lại.

Sau mỗi lần push, GitHub có thể cache file khoảng 5 phút; app chỉ cập nhật nguồn khi `version` tăng.

## Khi web đổi tên miền

1. Sửa `DOMAIN` trong `src/<Nguồn>/<Nguồn>.ts`.
2. Tăng `version` trong `<Nguồn>Info` (app chỉ cập nhật khi version tăng).
3. `npm test`, rồi commit cả thư mục `0.8`.

Id truyện và id chương chỉ lưu đường dẫn (không lưu domain), nên thư viện đã lưu vẫn đọc được sau khi đổi domain.
