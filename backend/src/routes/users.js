import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { broadcastDataChange } from '../services/realtime.js';

const router = Router();

router.use(requireRole('OWNER', 'ADMIN'));

const roleSchema = z.enum(['STAFF', 'OWNER', 'ADMIN']);

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  role: roleSchema.default('STAFF')
});

const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  role: roleSchema.optional()
});

function canManageRole(currentUser, targetUser, nextRole) {
  if (currentUser.role === 'ADMIN') {
    return true;
  }

  if (targetUser.role === 'ADMIN') {
    return false;
  }

  if (nextRole === 'ADMIN') {
    return false;
  }

  return true;
}

router.get('/', async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        updatedAt: true
      }
    });

    return res.json(users);
  } catch (error) {
    return next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const data = createUserSchema.parse(req.body);
    if (req.user.role !== 'ADMIN' && data.role === 'ADMIN') {
      return res.status(403).json({ message: 'Chỉ tài khoản admin mới tạo được admin khác' });
    }

    const passwordHash = await bcrypt.hash(data.password, 10);
    const user = await prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        passwordHash,
        role: data.role
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        updatedAt: true
      }
    });

    broadcastDataChange('users', { action: 'created', id: user.id });
    return res.status(201).json(user);
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const data = updateUserSchema.parse(req.body);
    const targetUser = await prisma.user.findUnique({ where: { id: req.params.id } });

    if (!targetUser) {
      return res.status(404).json({ message: 'Không tìm thấy tài khoản' });
    }

    if (!canManageRole(req.user, targetUser, data.role ?? targetUser.role)) {
      return res.status(403).json({ message: 'Không đủ quyền để sửa tài khoản này' });
    }

    const updateData = {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.email !== undefined ? { email: data.email } : {}),
      ...(data.role !== undefined ? { role: data.role } : {})
    };

    if (data.password) {
      updateData.passwordHash = await bcrypt.hash(data.password, 10);
    }

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        updatedAt: true
      }
    });

    broadcastDataChange('users', { action: 'updated', id: user.id });
    return res.json(user);
  } catch (error) {
    return next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const targetUser = await prisma.user.findUnique({ where: { id: req.params.id } });

    if (!targetUser) {
      return res.status(404).json({ message: 'Không tìm thấy tài khoản' });
    }

    if (targetUser.id === req.user.sub) {
      return res.status(400).json({ message: 'Không thể xóa tài khoản đang đăng nhập' });
    }

    if (!canManageRole(req.user, targetUser, targetUser.role)) {
      return res.status(403).json({ message: 'Không đủ quyền để xóa tài khoản này' });
    }

    await prisma.user.delete({ where: { id: req.params.id } });
    broadcastDataChange('users', { action: 'deleted', id: req.params.id });
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

export default router;