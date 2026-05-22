# Thông Tin Test

## Link chạy local

- Frontend: http://localhost:5173
- Backend health: http://localhost:4000/health
- Admin/POS: http://localhost:5173

## Tài khoản test

### Admin

- Email: `admin@vanmerchant.local`
- Mật khẩu: `admin123`
- Quyền: toàn quyền hệ thống, có tab quản lý tài khoản.

### Chủ quán

- Email: `owner@vanmerchant.local`
- Mật khẩu: `123456`
- Quyền: quản lý doanh thu, menu, nguyên liệu, cost, bàn/QR, đơn hàng, tài khoản nhân viên/chủ quán.

### Nhân viên

- Email: `staff@vanmerchant.local`
- Mật khẩu: `123456`
- Quyền: xem bill đang làm, bill chờ giao, cập nhật đã giao/đã thanh toán.

## Link QR gọi món

Dùng trên cùng máy:

- Bàn 01: http://localhost:5173/table/BAN-01
- Bàn 02: http://localhost:5173/table/BAN-02

Dùng điện thoại cùng mạng Wi-Fi:

- Bàn 01: http://192.168.1.13:5173/table/BAN-01
- Bàn 02: http://192.168.1.13:5173/table/BAN-02

Nếu địa chỉ IP máy tính thay đổi, mở PowerShell và chạy:

```powershell
ipconfig
```

Sau đó thay `192.168.1.13` bằng IPv4 mới của máy.

## Dữ liệu seed

- Bàn mẫu: `BAN-01`, `BAN-02`
- Món mẫu: `Ca phe sua`, `Banh mi trung`
- Số điện thoại khách test: nhập số bất kỳ từ 8 ký tự trở lên, ví dụ `0909000001`

## Test nhanh

1. Mở http://localhost:5173/table/BAN-01
2. Nhập số điện thoại.
3. Chọn món.
4. Chọn tiền mặt để test không cần PayOS.
5. Đăng nhập admin bằng tài khoản `admin@vanmerchant.local` / `admin123` hoặc tài khoản chủ quán.
6. Vào `Bill đang làm`, chuyển đơn sang `Đang giao`.
7. Vào `Bill chờ giao`, chuyển đơn sang `Đã giao`.

## PayOS

Muốn test chuyển khoản thật, điền trong `backend/.env`:

```env
PAYOS_CLIENT_ID=""
PAYOS_API_KEY=""
PAYOS_CHECKSUM_KEY=""
```

Webhook production cần HTTPS public:

```text
https://your-domain.com/api/webhooks/payos
```
