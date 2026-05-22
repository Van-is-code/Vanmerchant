# Tài Liệu Chức Năng VanMerchant

## 1. Mục tiêu

Xây dựng một hệ thống POS web cho quán ăn/cafe gồm:

- Khách tự gọi món bằng QR theo bàn.
- Thanh toán tiền mặt hoặc chuyển khoản qua PayOS.
- Chủ quán quản lý doanh thu, nguyên liệu, cost, menu, bàn và QR.
- Nhân viên chỉ thao tác trang bill đang làm/ra món.
- Bill có số thứ tự theo ngày và tự reset mỗi ngày.
- Chủ quán/bếp nhận bill khi đơn hợp lệ để làm món.

## 2. Phân quyền

### ADMIN

- Toàn quyền hệ thống.
- Quản lý mọi chức năng của OWNER.
- Tạo, sửa, xóa và nâng role mọi tài khoản.

### OWNER

- Xem dashboard doanh thu, cost, lợi nhuận gộp.
- Quản lý menu, nguyên liệu, định mức cost.
- Quản lý bàn và mã QR.
- Xem/sửa tất cả đơn hàng.
- Cập nhật trạng thái thanh toán tiền mặt.
- Quản lý tài khoản nhân viên và chủ quán trong backoffice.

### STAFF

- Xem danh sách bill.
- Chuyển trạng thái món: `PREPARING`, `DELIVERING`, `DELIVERED`.
- Đánh dấu đã thanh toán khi thu tiền mặt.
- Không được vào màn hình doanh thu, menu, nguyên liệu, bàn.

## 3. Luồng khách gọi món

1. Khách quét QR trên bàn, URL dạng:

   ```text
   https://your-frontend.com/table/BAN-01
   ```

2. Web yêu cầu khách nhập số điện thoại.
3. Backend lưu hoặc lấy lại customer theo số điện thoại.
4. Khách chọn món và phương thức thanh toán.
5. Với tiền mặt:
   - Tạo đơn `paymentStatus=PENDING_PAYMENT`.
   - Đơn vào bếp với `status=PREPARING`.
   - Nhân viên/chủ quán đánh dấu `PAID` khi thu tiền.
6. Với chuyển khoản:
   - Tạo đơn `paymentStatus=UNPAID`, `status=NEW`.
   - Backend tạo PayOS payment link.
   - Khách mở checkout PayOS và thanh toán.
   - Webhook PayOS xác nhận thành công.
   - Backend chuyển đơn sang `paymentStatus=PAID`, `status=PREPARING`.
   - Backend in/log bill bếp.

## 4. Luồng PayOS đúng chuẩn

PayOS là nguồn xác thực thanh toán. Không dùng return URL làm bằng chứng đã thanh toán vì người dùng có thể đóng tab hoặc quay lại thủ công.

Backend đang dùng:

- `@payos/node`
- `createPaymentLink(paymentData)` để tạo checkout URL.
- `verifyPaymentWebhookData(req.body)` để xác minh webhook.

Webhook public:

```text
POST /api/webhooks/payos
```

Sau khi deploy, cấu hình URL HTTPS này trong dashboard PayOS.

## 5. Giới hạn về việc tự mở app ngân hàng

Yêu cầu “ấn chuyển khoản, web tự quét mã đã trả trên màn hình rồi chuyển đến ngân hàng có trên máy, nếu nhiều ngân hàng cho chọn” không thể làm trực tiếp trong browser theo cách tự động hoàn toàn.

Lý do:

- Website không có quyền điều khiển app ngân hàng.
- Website không được tự đăng nhập hoặc tự xác nhận chuyển tiền.
- Browser không được tự quét nội dung màn hình thiết bị của người dùng.
- Ngân hàng chỉ cho người dùng thao tác trong app/banking session của họ.

Giải pháp hợp lệ:

- Hiển thị PayOS checkout URL/QR.
- PayOS hoặc thiết bị hỗ trợ mở deep link ngân hàng nếu có.
- Người dùng tự chọn ngân hàng và xác nhận chuyển tiền.
- Backend nhận webhook PayOS để cập nhật đơn.

## 6. Trạng thái đơn

### PaymentStatus

- `UNPAID`: chưa bắt đầu thanh toán.
- `PENDING_PAYMENT`: đang chờ chuyển khoản hoặc chờ thu tiền mặt.
- `PAID`: đã thanh toán.
- `FAILED`: thanh toán lỗi.
- `CANCELLED`: đã hủy.

### OrderStatus

- `NEW`: đơn mới, thường là chuyển khoản chưa thanh toán.
- `PREPARING`: bếp đang làm.
- `DELIVERING`: đang mang ra bàn.
- `DELIVERED`: đã giao.
- `CANCELLED`: đã hủy.

## 7. Mô hình dữ liệu

- `User`: tài khoản admin/chủ quán/nhân viên.
- `Customer`: khách theo số điện thoại.
- `DiningTable`: bàn và mã QR cố định.
- `Category`: nhóm món.
- `MenuItem`: món bán.
- `Ingredient`: nguyên liệu, tồn kho, cost mỗi đơn vị.
- `RecipeItem`: định mức nguyên liệu cho từng món.
- `StockMove`: lịch sử xuất/nhập kho.
- `Order`: đơn hàng, số thứ tự theo ngày, bàn, khách, trạng thái.
- `OrderItem`: chi tiết món trong đơn.

## 8. In bill

Hiện tại backend gọi `printKitchenTicket(order)`. Khi `PRINTER_ENABLED=false`, bill sẽ log ra console.

Khi nối máy in nhiệt thật:

- Dùng ESC/POS qua USB/LAN/Bluetooth tùy máy in.
- Thay phần comment trong `backend/src/services/print-service.js`.
- Nên đặt backend trên máy local cùng mạng với máy in, hoặc dùng print agent riêng.

Bill gồm:

- Tên quán.
- STT đơn.
- Số bàn.
- Số điện thoại khách.
- Phương thức và trạng thái thanh toán.
- Danh sách món.
- Tổng tiền.
- Ghi chú.

## 9. Màn hình quản lý tài khoản

- Backoffice có tab riêng để tạo, sửa, xóa tài khoản.
- Tài khoản mặc định sau seed: `admin@vanmerchant.local` / `admin123`.
- OWNER có thể quản lý staff và owner; ADMIN có thể quản lý mọi tài khoản.

## 10. Các việc nên làm tiếp khi lên production

- Đổi SQLite sang PostgreSQL/MySQL.
- Bật HTTPS cho backend để PayOS webhook gọi được.
- Thêm màn hình sửa công thức cost từng món.
- Thêm nhập kho/xuất kho thủ công.
- Thêm phân ca nhân viên và nhật ký thao tác.
- Thêm realtime bằng Socket.IO để bếp nhận bill ngay không cần polling.
- Thêm export Excel doanh thu/nguyên liệu.
- Thêm retry/đối soát PayOS theo `payosOrderCode`.
