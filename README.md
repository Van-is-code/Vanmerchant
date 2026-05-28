# VanMerchant POS

Hệ thống quản lý quán ăn/cafe: khách quét QR theo bàn để gọi món, chọn thanh toán tiền mặt hoặc chuyển khoản qua PayOS, chủ quán nhận bill, nhân viên xử lý trạng thái món và thanh toán.

## Công nghệ

- Frontend: React + Vite
- Backend: Node.js + Express
- Database: PostgreSQL qua Prisma
- Realtime: SSE đẩy sự kiện cập nhật để client tự refetch phần đang mở, không reload trang
- Thanh toán: PayOS payment link + webhook xác nhận thanh toán
- In bill: endpoint print adapter, hiện log ra console và có chỗ nối máy in nhiệt

## Cài đặt

```bash
npm.cmd install
copy .env.example backend\.env
npm.cmd run db:push
npm.cmd run db:seed
npm.cmd run dev
```

Đặt `DATABASE_URL` trong `backend\.env` theo kết nối PostgreSQL của bạn, ví dụ `postgresql://user:pass@localhost:5432/vanmerchant`.

Frontend chạy tại `http://localhost:2245`, backend chạy tại `http://localhost:2026`.

Tài khoản seed:

- Admin: `admin@vanmerchant.local` / `admin123`
- Chủ quán: `owner@vanmerchant.local` / `123456`
- Nhân viên: `staff@vanmerchant.local` / `123456`

## Luồng khách hàng

1. Mỗi bàn có QR riêng trỏ đến `/table/:qrCode`.
2. Khách nhập số điện thoại, không cần mật khẩu.
3. Khách chọn món, tăng giảm số lượng, gửi đơn.
4. Nếu chọn tiền mặt, đơn ở trạng thái `PENDING_PAYMENT`, chủ quán/nhân viên có thể đánh dấu đã thanh toán.
5. Nếu chọn chuyển khoản, backend tạo PayOS payment link. Khách bấm nút chuyển khoản để mở trang thanh toán PayOS, PayOS hiển thị QR và lựa chọn ngân hàng phù hợp trên thiết bị.
6. Khi PayOS gửi webhook thành công, đơn chuyển sang `PAID` và `PREPARING`, backend tạo bill cho bếp.

## Giới hạn quan trọng về app ngân hàng

Website không thể tự đăng nhập app ngân hàng, tự quét mã trên màn hình, hoặc tự bấm xác nhận chuyển tiền. Đây là giới hạn bảo mật của trình duyệt và hệ điều hành. Cách đúng là:

- Tạo payment link/QR qua PayOS.
- Người dùng tự mở app ngân hàng hoặc checkout PayOS.
- Backend chỉ tin trạng thái thanh toán từ webhook PayOS đã xác minh chữ ký.

## Vai trò

- `ADMIN`: toàn quyền hệ thống, bao gồm tất cả chức năng của chủ quán và quản lý tài khoản.
- `OWNER`: xem dashboard doanh thu, quản lý menu, nguyên liệu, cost, bàn, đơn hàng.
- `STAFF`: xem đơn đang làm/ra món, sửa trạng thái `PREPARING`, `DELIVERING`, `DELIVERED`, và cập nhật thanh toán tiền mặt theo quyền quán cấp.

## Trạng thái đơn hàng

- Thanh toán: `UNPAID`, `PENDING_PAYMENT`, `PAID`, `FAILED`, `CANCELLED`
- Xử lý món: `NEW`, `PREPARING`, `DELIVERING`, `DELIVERED`, `CANCELLED`

Số thứ tự đơn (`dailySequence`) reset theo ngày theo timezone của server.

## API chính

- `POST /api/auth/login`: đăng nhập chủ quán/nhân viên
- `GET /api/public/tables/:qrCode`: lấy thông tin bàn và menu
- `POST /api/public/customers`: khách nhập số điện thoại
- `GET /api/public/customers/:phone/orders`: lịch sử đơn theo số điện thoại
- `POST /api/public/orders`: tạo đơn
- `POST /api/public/orders/:id/payos`: tạo link thanh toán PayOS
- `POST /api/webhooks/payos`: nhận webhook PayOS
- `GET /api/events`: stream realtime cho client đang mở
- `GET /api/admin/dashboard`: doanh thu/cost
- `GET/POST/PUT /api/admin/menu-items`: quản lý menu
- `GET/POST/PUT /api/admin/ingredients`: quản lý nguyên liệu
- `GET/POST/PUT /api/admin/tables`: quản lý bàn/QR
- `GET/POST/PATCH/DELETE /api/admin/users`: quản lý tài khoản nhân viên/chủ quán
- `GET /api/orders`: danh sách đơn cho chủ quán/nhân viên
- `PATCH /api/orders/:id/status`: cập nhật trạng thái đơn

## Triển khai PayOS

1. Tạo kênh thanh toán trong PayOS.
2. Điền `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY`.
3. Deploy backend lên HTTPS public.
4. Cấu hình webhook PayOS đến `https://your-domain.com/api/webhooks/payos`.
5. Return URL đặt về `https://your-frontend.com/payment/result`.

Nguồn tham khảo chính thức: [PayOS NodeJS SDK](https://payos.vn/docs/sdks/back-end/node/).

## Automation deploy Docker + NGINX

Repo đã có sẵn bộ automation để chạy production trên VPS:

- `scripts/vps_bootstrap_deploy.sh`: tự cài Docker, Docker Compose, NGINX, UFW; clone/pull code; chạy DB, seed; build FE/BE qua Docker.
- `scripts/release_to_vps.sh`: push code lên GitHub rồi SSH qua VPS để chạy deploy script.
- `deploy/docker-compose.prod.yml`: chạy 3 service `postgres`, `backend`, `frontend`.
- `deploy/nginx/vanmerchant.conf`: reverse proxy theo domain:
  - FE: `tranhalam.uyentoan.studio` -> container frontend
  - BE: `apitranhalam.uyentoan.studio` -> container backend

### 1) Chuẩn bị DNS

Trỏ A record cho cả 2 domain về IP VPS:

- `vanmerchant.uyentoan.studio` -> `103.157.204.155`
- `vanmerchantapi.uyentoan.studio` -> `103.157.204.155`

### 2) Chạy bootstrap lần đầu trên VPS

```bash
ssh admin@103.157.204.155
cd /var/www
git clone https://github.com/Van-is-code/Vanmerchant.git vanmerchant
cd /var/www/vanmerchant
bash scripts/vps_bootstrap_deploy.sh
```

Sau lần đầu, chỉnh secrets tại:

- `deploy/env/backend.env`

PostgreSQL mặc định đã được set đúng theo yêu cầu của bạn:

- user: `tranhalam`
- password: `tranhalam`
- db: `tranhalam`

Rồi chạy lại script để apply:

```bash
cd /var/www/vanmerchant
bash scripts/vps_bootstrap_deploy.sh
```

### 3) Deploy các lần sau từ máy local

```bash
bash scripts/release_to_vps.sh
```

### 4) Bật HTTPS tự động (khuyến nghị)

Truyền email Let's Encrypt khi chạy bootstrap:

```bash
LETSENCRYPT_EMAIL=you@example.com bash scripts/vps_bootstrap_deploy.sh
```
