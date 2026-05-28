import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db.js';
import { signUser, requireAuth } from '../middleware/auth.js';

const router = Router();

// Legacy email/password login
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

router.post('/login', async (req, res, next) => {
  try {
    const data = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: data.email } });
    if (!user || !(await bcrypt.compare(data.password, user.passwordHash))) {
      return res.status(401).json({ message: 'Sai email hoặc mật khẩu' });
    }

    return res.json({
      token: signUser(user),
      user: { id: user.id, name: user.name, email: user.email, role: user.role }
    });
  } catch (error) {
    return next(error);
  }
});

// ── Phone-based PIN Authentication ──────────────────────────
router.post('/login-phone', async (req, res, next) => {
  try {
    const { phone, deviceId } = z.object({
      phone: z.string().min(8),
      deviceId: z.string().min(1)
    }).parse(req.body);

    const user = await prisma.user.findUnique({
      where: { phone },
      include: { devices: true }
    });

    if (!user || !user.role) {
      return res.status(401).json({ message: 'Số điện thoại không tồn tại hoặc chưa có quyền truy cập' });
    }

    // Kiểm tra device đã đăng ký trước
    const existingDevice = user.devices.find((d) => d.deviceId === deviceId);
    
    if (existingDevice && user.pin) {
      // Device cũ + có PIN → yêu cầu nhập PIN
      return res.status(202).json({
        message: 'Nhập mã PIN để xác nhận',
        requiresPin: true,
        phone: user.phone?.slice(-6)
      });
    }

    if (existingDevice && !user.pin) {
      // Device cũ + chưa có PIN → login ngay
      await prisma.userDevice.update({
        where: { id: existingDevice.id },
        data: { lastUsedAt: new Date() }
      });

      return res.json({
        token: signUser(user),
        user: { id: user.id, name: user.name, phone: user.phone, role: user.role }
      });
    }

    // Device mới → yêu cầu nhập PIN để tạo thiết bị
    return res.status(202).json({
      message: 'Thiết bị mới. Nhập mã PIN để xác nhận',
      requiresPin: true,
      isNewDevice: true,
      phone: user.phone?.slice(-6)
    });
  } catch (error) {
    return next(error);
  }
});

// ── Verify PIN & Register Device ──────────────────────────
router.post('/verify-pin', async (req, res, next) => {
  try {
    const { phone, deviceId, pin } = z.object({
      phone: z.string().min(8),
      deviceId: z.string().min(1),
      pin: z.string().length(6)
    }).parse(req.body);

    const user = await prisma.user.findUnique({
      where: { phone },
      include: { devices: true }
    });

    if (!user) {
      return res.status(401).json({ message: 'Số điện thoại không tồn tại' });
    }

    // Nếu chưa có PIN → set PIN lần đầu
    if (!user.pin) {
      const hashedPin = await bcrypt.hash(pin, 10);
      await prisma.user.update({
        where: { id: user.id },
        data: { pin: hashedPin }
      });
    } else {
      // Kiểm tra PIN
      const isValidPin = await bcrypt.compare(pin, user.pin);
      if (!isValidPin) {
        return res.status(401).json({ message: 'Mã PIN sai' });
      }
    }

    // Tạo device record
    let device = user.devices.find((d) => d.deviceId === deviceId);
    if (!device) {
      device = await prisma.userDevice.create({
        data: {
          userId: user.id,
          deviceId,
          deviceName: 'Web Browser',
          ipAddress: req.ip
        }
      });
    } else {
      await prisma.userDevice.update({
        where: { id: device.id },
        data: { lastUsedAt: new Date() }
      });
    }

    return res.json({
      token: signUser(user),
      user: { id: user.id, name: user.name, phone: user.phone, role: user.role },
      device: { id: device.id, deviceId }
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
