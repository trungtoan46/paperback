# Nguồn tiếng Việt cho Paperback 0.8

Nguồn đọc truyện cho app Paperback (iOS), API 0.8:

| Nguồn | Web | Version |
|---|---|---|
| TruyenQQ | https://truyenqqko.com | 1.3.1 |
| NetTruyen | https://nettruyen.gg | 1.1.1 |

Mỗi nguồn có: trang chủ, tìm theo tên, bộ lọc (thể loại, tình trạng, sắp xếp), chi tiết truyện,
danh sách chương, đọc chương, Cloudflare bypass, và trang cài đặt để đổi tên miền ngay trong app.

- TruyenQQ: trang chủ gồm Mới cập nhật, Yêu thích. Bộ lọc dùng trang tìm kiếm nâng cao,
  cho phép chọn nhiều thể loại và loại trừ thể loại.
- NetTruyen: trang chủ gồm Mới cập nhật, Top tháng, Hoàn thành (đều lấy từ `/tim-truyen`).
- Mục trang chủ nào lỗi hoặc trống sẽ ghi lý do trên tiêu đề, ví dụ "Top tháng (lỗi HTTP 404)".
- Truyện có thể loại Adult, Smut, Hentai, 18+ được đánh dấu 18+ trong Paperback. Nếu trang truyện
  không có sẵn danh sách chương, nguồn gọi API `ComicService.asmx/ChapterList`.

## Cấu trúc

| Đường dẫn | Nội dung |
|---|---|
| `src/<Nguồn>/<Nguồn>.ts` | Lớp nguồn: request, trang chủ, tìm kiếm, Cloudflare |
| `src/<Nguồn>/<Nguồn>Parser.ts` | Đọc HTML của web |
| `src/<Nguồn>/includes/icon.png` | Icon nguồn |
| `shared/utils.ts` | Hàm dùng chung: URL, ảnh lazy-load, ngày giờ, số chương, phân trang |
| `shared/filters.ts` | Bộ lọc tình trạng/sắp xếp (đọc từ web, có giá trị mặc định) |
| `shared/settings.ts` | Trang cài đặt nguồn: lưu và đổi tên miền |
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
4. Nếu báo lỗi Cloudflare: Settings → Extensions → chọn nguồn → **Cloudflare Bypass**,
   đợi trang web tải xong rồi đóng lại.
5. Khi web đổi tên miền: Settings → Extensions → chọn nguồn → **Đổi tên miền**, nhập tên miền mới
   (để trống hoặc bấm **Dùng tên miền mặc định** để quay về mặc định).

Sau mỗi lần push, GitHub có thể cache file khoảng 5 phút; app chỉ cập nhật nguồn khi `version` tăng.

## Đổi tên miền mặc định

Người dùng tự đổi được trong cài đặt nguồn. Để đổi mặc định cho mọi người:

1. Sửa `DEFAULT_DOMAIN` trong `src/<Nguồn>/<Nguồn>.ts`.
2. Tăng `version` trong `<Nguồn>Info` (app chỉ cập nhật khi version tăng).
3. `npm test`, rồi commit cả thư mục `0.8`.

Id truyện và id chương chỉ lưu đường dẫn (không lưu domain), nên thư viện đã lưu vẫn đọc được sau khi đổi domain.
