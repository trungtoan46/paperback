# Nguồn tiếng Việt cho Paperback 0.8

Nguồn đọc truyện cho app Paperback (iOS), API 0.8:

| Nguồn | Web | Version |
|---|---|---|
| TruyenQQ | https://truyenqqno.com | 1.2.0 |
| NetTruyen | https://nettruyen.gg | 1.0.0 |

Mỗi nguồn có: trang chủ, tìm theo tên, lọc theo một thể loại, chi tiết truyện,
danh sách chương, đọc chương, Cloudflare bypass.

- TruyenQQ: trang chủ gồm Mới cập nhật, Yêu thích.
- NetTruyen: trang chủ gồm Mới cập nhật, Truyện hot, Hoàn thành. Nếu trang truyện
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

## Thêm vào Paperback

Thêm repo trỏ tới thư mục `0.8`, ví dụ khi bật GitHub Pages cho nhánh `main`:
`https://trungtoan46.github.io/paperback/0.8`.

## Khi web đổi tên miền

1. Sửa `DOMAIN` trong `src/<Nguồn>/<Nguồn>.ts`.
2. Tăng `version` trong `<Nguồn>Info` (app chỉ cập nhật khi version tăng).
3. `npm test`, rồi commit cả thư mục `0.8`.

Id truyện và id chương chỉ lưu đường dẫn (không lưu domain), nên thư viện đã lưu vẫn đọc được sau khi đổi domain.
