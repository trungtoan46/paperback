# TruyenQQ cho Paperback 0.8

Nguồn đọc truyện [TruyenQQ](https://truyenqqno.com) cho app Paperback (iOS), API 0.8.

Chức năng: trang chủ (Mới cập nhật, Yêu thích), tìm theo tên, lọc theo một thể loại,
chi tiết truyện, danh sách chương, đọc chương, Cloudflare bypass.

## Cấu trúc

| Đường dẫn | Nội dung |
|---|---|
| `src/TruyenQQ/TruyenQQ.ts` | Lớp nguồn: request, trang chủ, tìm kiếm, Cloudflare |
| `src/TruyenQQ/TruyenQQParser.ts` | Đọc HTML của TruyenQQ |
| `src/TruyenQQ/includes/icon.png` | Icon nguồn |
| `0.8/` | **Bản build** mà Paperback tải về; sinh bằng `npm run build`, không sửa tay |
| `scripts/smoke-test.js` | Chạy bản build trong môi trường giả lập app với HTML mẫu ở `scripts/fixtures/` |

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

## Khi TruyenQQ đổi tên miền

1. Sửa `DOMAIN` trong `src/TruyenQQ/TruyenQQ.ts`.
2. Tăng `version` trong `TruyenQQInfo` (app chỉ cập nhật khi version tăng).
3. `npm test`, rồi commit cả thư mục `0.8`.

Id truyện và id chương chỉ lưu đường dẫn (không lưu domain), nên thư viện đã lưu vẫn đọc được sau khi đổi domain.
