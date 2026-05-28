import { Router } from 'express';
import { z } from 'zod';
import QRCode from 'qrcode';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { broadcastDataChange } from '../services/realtime.js';

const router = Router();

router.use(requireRole('OWNER', 'ADMIN'));

function tableOrderUrl(qrCode) {
  return `${config.frontendUrl}/table/${encodeURIComponent(qrCode)}`;
}

function generateQrCode(name) {
  const base = name
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return `${base || 'BAN'}-${Date.now().toString().slice(-5)}`;
}

async function enrichTable(table) {
  const orderUrl = tableOrderUrl(table.qrCode);
  return {
    ...table,
    orderUrl,
    qrDataUrl: await QRCode.toDataURL(orderUrl, { width: 360, margin: 2 })
  };
}

router.get('/dashboard', async (req, res, next) => {
  try {
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(new Date().setHours(0, 0, 0, 0));
    const to = req.query.to ? new Date(String(req.query.to)) : new Date();
    const orders = await prisma.order.findMany({
      where: {
        createdAt: { gte: from, lte: to },
        paymentStatus: 'PAID'
      },
      include: { items: true, table: true }
    });

    const revenue = orders.reduce((sum, order) => sum + order.subtotal, 0);
    const cost = orders.reduce((sum, order) => sum + order.costTotal, 0);
    const ingredients = await prisma.ingredient.findMany({ orderBy: { name: 'asc' } });
    const lowStock = ingredients.filter((ingredient) => ingredient.stock <= ingredient.minStock);

    return res.json({
      revenue,
      cost,
      profit: revenue - cost,
      orderCount: orders.length,
      lowStock,
      recentOrders: orders.slice(-10).reverse()
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/top-products', async (req, res, next) => {
  try {
    const period = req.query.period || 'day'; // day, week, month, year
    const now = new Date();
    let from = new Date(now.setHours(0, 0, 0, 0));
    
    if (period === 'week') {
      from = new Date(now);
      from.setDate(from.getDate() - 7);
    } else if (period === 'month') {
      from = new Date(now);
      from.setMonth(from.getMonth() - 1);
    } else if (period === 'year') {
      from = new Date(now);
      from.setFullYear(from.getFullYear() - 1);
    } else {
      from = new Date(now.setHours(0, 0, 0, 0));
    }
    
    const orders = await prisma.order.findMany({
      where: {
        createdAt: { gte: from },
        paymentStatus: 'PAID'
      },
      include: { items: true }
    });

    const productMap = {};
    orders.forEach((order) => {
      order.items.forEach((item) => {
        if (!productMap[item.menuItemId]) {
          productMap[item.menuItemId] = {
            id: item.menuItemId,
            name: item.name,
            totalRevenue: 0,
            totalQuantity: 0
          };
        }
        productMap[item.menuItemId].totalRevenue += item.price * item.quantity;
        productMap[item.menuItemId].totalQuantity += item.quantity;
      });
    });

    const products = Object.values(productMap)
      .sort((a, b) => b.totalRevenue - a.totalRevenue);

    return res.json(products);
  } catch (error) {
    return next(error);
  }
});

router.get('/revenue-series', async (req, res, next) => {
  try {
    const period = req.query.period || 'day'; // day, month, year
    const now = new Date();
    let from = new Date(now);

    if (period === 'day') {
      // Show all days in current month
      from = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (period === 'month') {
      // Show all months in current year
      from = new Date(now.getFullYear(), 0, 1);
    } else if (period === 'year') {
      // Show all months of previous year (for year-over-year comparison)
      const prevYear = now.getFullYear() - 1;
      from = new Date(prevYear, 0, 1);
    }

    const orders = await prisma.order.findMany({
      where: { createdAt: { gte: from }, paymentStatus: 'PAID' },
      include: { items: true }
    });

    // Filter orders for year period to only previous year
    let filteredOrders = orders;
    if (period === 'year') {
      const prevYear = now.getFullYear() - 1;
      filteredOrders = orders.filter(o => new Date(o.createdAt).getFullYear() === prevYear);
    }

    const seriesMap = {};

    filteredOrders.forEach((order) => {
      let key;
      const orderDate = new Date(order.createdAt);
      
      if (period === 'day') {
        // Group by day of month
        key = orderDate.getDate().toString().padStart(2, '0');
      } else if (period === 'month') {
        // Group by month
        const monthNames = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12'];
        key = monthNames[orderDate.getMonth()];
      } else if (period === 'year') {
        // Group by month of the year
        const monthNames = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12'];
        key = monthNames[orderDate.getMonth()];
      }

      if (!seriesMap[key]) {
        seriesMap[key] = { label: key, revenue: 0, orders: 0 };
      }
      seriesMap[key].revenue += order.subtotal;
      seriesMap[key].orders += 1;
    });

    // Generate all labels for the period
    const allLabels = [];
    if (period === 'day') {
      // All days in current month
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      for (let i = 1; i <= daysInMonth; i++) {
        allLabels.push(i.toString().padStart(2, '0'));
      }
    } else if (period === 'month') {
      // All 12 months of current year (T1 to T12)
      allLabels.push('T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12');
    } else if (period === 'year') {
      // All 12 months of previous year (T1 to T12)
      allLabels.push('T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12');
    }

    const series = allLabels.map((label) => seriesMap[label] || { label, revenue: 0, orders: 0 });

    return res.json(series);
  } catch (error) {
    return next(error);
  }
});

router.get('/categories', async (req, res, next) => {
  try {
    const categories = await prisma.category.findMany({ orderBy: { sortOrder: 'asc' } });
    return res.json(categories);
  } catch (error) {
    return next(error);
  }
});

router.get('/menu-items', async (req, res, next) => {
  try {
    const items = await prisma.menuItem.findMany({
      include: { category: true, recipes: { include: { ingredient: true } } },
      orderBy: { name: 'asc' }
    });
    return res.json(items);
  } catch (error) {
    return next(error);
  }
});

router.post('/menu-items', async (req, res, next) => {
  try {
    const data = z
      .object({
        name: z.string().min(1),
        description: z.string().optional(),
        price: z.number().int().min(0),
        imageUrl: z.string().optional(),
        active: z.boolean().default(true),
        categoryId: z.string().optional().nullable()
      })
      .parse(req.body);
    const item = await prisma.menuItem.create({ data });
    broadcastDataChange('menu', { action: 'created', id: item.id });
    broadcastDataChange('dashboard', { action: 'updated', source: 'menu' });
    return res.status(201).json(item);
  } catch (error) {
    return next(error);
  }
});

router.put('/menu-items/:id', async (req, res, next) => {
  try {
    const item = await prisma.menuItem.update({
      where: { id: req.params.id },
      data: req.body
    });
    broadcastDataChange('menu', { action: 'updated', id: item.id });
    broadcastDataChange('dashboard', { action: 'updated', source: 'menu' });
    return res.json(item);
  } catch (error) {
    return next(error);
  }
});

router.put('/menu-items/:id/toggle-hidden', async (req, res, next) => {
  try {
    const item = await prisma.menuItem.findUnique({ where: { id: req.params.id } });
    if (!item) return res.status(404).json({ message: 'Không tìm thấy món' });
    const updated = await prisma.menuItem.update({
      where: { id: req.params.id },
      data: { hidden: !item.hidden }
    });
    broadcastDataChange('menu', { action: 'updated', id: updated.id });
    return res.json(updated);
  } catch (error) {
    return next(error);
  }
});

router.delete('/menu-items/:id', async (req, res, next) => {
  try {
    await prisma.menuItem.delete({
      where: { id: req.params.id }
    });
    broadcastDataChange('menu', { action: 'deleted', id: req.params.id });
    broadcastDataChange('dashboard', { action: 'updated', source: 'menu' });
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

router.get('/ingredients', async (req, res, next) => {
  try {
    const items = await prisma.ingredient.findMany({ orderBy: { name: 'asc' } });
    return res.json(items);
  } catch (error) {
    return next(error);
  }
});

router.post('/ingredients', async (req, res, next) => {
  try {
    const data = z
      .object({
        name: z.string().min(1),
        unit: z.string().min(1),
        stock: z.number().default(0),
        minStock: z.number().default(0),
        unitCost: z.number().int().default(0)
      })
      .parse(req.body);
    const item = await prisma.ingredient.create({ data });
    broadcastDataChange('ingredients', { action: 'created', id: item.id });
    broadcastDataChange('dashboard', { action: 'updated', source: 'ingredients' });
    return res.status(201).json(item);
  } catch (error) {
    return next(error);
  }
});

router.put('/ingredients/:id', async (req, res, next) => {
  try {
    const item = await prisma.ingredient.update({
      where: { id: req.params.id },
      data: req.body
    });
    broadcastDataChange('ingredients', { action: 'updated', id: item.id });
    broadcastDataChange('dashboard', { action: 'updated', source: 'ingredients' });
    return res.json(item);
  } catch (error) {
    return next(error);
  }
});

router.delete('/ingredients/:id', async (req, res, next) => {
  try {
    await prisma.ingredient.delete({
      where: { id: req.params.id }
    });
    broadcastDataChange('ingredients', { action: 'deleted', id: req.params.id });
    broadcastDataChange('dashboard', { action: 'updated', source: 'ingredients' });
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

router.get('/tables', async (req, res, next) => {
  try {
    const tables = await prisma.diningTable.findMany({ orderBy: { name: 'asc' } });
    return res.json(await Promise.all(tables.map(enrichTable)));
  } catch (error) {
    return next(error);
  }
});

router.post('/tables', async (req, res, next) => {
  try {
    const data = z
      .object({
        name: z.string().min(1),
        qrCode: z.string().optional(),
        seats: z.number().int().default(4),
        active: z.boolean().default(true)
      })
      .parse(req.body);
    const table = await prisma.diningTable.create({
      data: {
        ...data,
        qrCode: data.qrCode?.trim() || generateQrCode(data.name)
      }
    });
    broadcastDataChange('tables', { action: 'created', id: table.id });
    broadcastDataChange('dashboard', { action: 'updated', source: 'tables' });
    return res.status(201).json(await enrichTable(table));
  } catch (error) {
    return next(error);
  }
});

router.put('/tables/:id', async (req, res, next) => {
  try {
    const table = await prisma.diningTable.update({
      where: { id: req.params.id },
      data: req.body
    });
    broadcastDataChange('tables', { action: 'updated', id: table.id });
    broadcastDataChange('dashboard', { action: 'updated', source: 'tables' });
    return res.json(table);
  } catch (error) {
    return next(error);
  }
});

router.delete('/tables/:id', async (req, res, next) => {
  try {
    await prisma.diningTable.delete({
      where: { id: req.params.id }
    });
    broadcastDataChange('tables', { action: 'deleted', id: req.params.id });
    broadcastDataChange('dashboard', { action: 'updated', source: 'tables' });
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

// ── User Management (Admin only) ──────────────────────────
// Chỉ Admin có thể quản lý Owner và Staff

router.get('/users', async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, name: true, phone: true, role: true, createdAt: true, updatedAt: true },
      orderBy: { createdAt: 'desc' }
    });
    return res.json(users);
  } catch (error) {
    return next(error);
  }
});

router.post('/users', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const data = z.object({
      name: z.string().min(1),
      phone: z.string().min(8).unique(),
      role: z.enum(['OWNER', 'STAFF']).default('STAFF')
    }).parse(req.body);

    // Kiểm tra phone đã tồn tại
    const existing = await prisma.user.findUnique({ where: { phone: data.phone } });
    if (existing) {
      return res.status(400).json({ message: 'Số điện thoại đã được sử dụng' });
    }

    const user = await prisma.user.create({
      data: {
        name: data.name,
        phone: data.phone,
        role: data.role
      }
    });

    broadcastDataChange('users', { action: 'created', id: user.id });
    return res.status(201).json({
      id: user.id,
      name: user.name,
      phone: user.phone,
      role: user.role,
      createdAt: user.createdAt
    });
  } catch (error) {
    return next(error);
  }
});

router.put('/users/:id', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const data = z.object({
      name: z.string().min(1).optional(),
      phone: z.string().min(8).optional(),
      role: z.enum(['OWNER', 'STAFF']).optional()
    }).parse(req.body);

    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) {
      return res.status(404).json({ message: 'Không tìm thấy tài khoản' });
    }

    // Kiểm tra phone đã tồn tại (ngoại trừ user hiện tại)
    if (data.phone && data.phone !== user.phone) {
      const existing = await prisma.user.findUnique({ where: { phone: data.phone } });
      if (existing) {
        return res.status(400).json({ message: 'Số điện thoại đã được sử dụng' });
      }
    }

    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data
    });

    broadcastDataChange('users', { action: 'updated', id: updated.id });
    return res.json({
      id: updated.id,
      name: updated.name,
      phone: updated.phone,
      role: updated.role
    });
  } catch (error) {
    return next(error);
  }
});

router.delete('/users/:id', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) {
      return res.status(404).json({ message: 'Không tìm thấy tài khoản' });
    }

    // Không cho xóa admin
    if (user.role === 'ADMIN') {
      return res.status(403).json({ message: 'Không thể xóa tài khoản Admin' });
    }

    await prisma.user.delete({ where: { id: req.params.id } });
    broadcastDataChange('users', { action: 'deleted', id: req.params.id });
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

router.patch('/users/:id/reset-pin', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) {
      return res.status(404).json({ message: 'Không tìm thấy tài khoản' });
    }

    // Reset PIN và xóa devices
    await prisma.userDevice.deleteMany({ where: { userId: user.id } });
    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: { pin: null }
    });

    broadcastDataChange('users', { action: 'updated', id: updated.id });
    return res.json({
      message: 'Đã reset PIN và xóa tất cả thiết bị của tài khoản',
      user: {
        id: updated.id,
        name: updated.name,
        phone: updated.phone,
        role: updated.role
      }
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
