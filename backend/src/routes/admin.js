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

router.delete('/menu-items/:id', async (req, res, next) => {
  try {
    const item = await prisma.menuItem.update({
      where: { id: req.params.id },
      data: { active: false }
    });
    broadcastDataChange('menu', { action: 'deleted', id: item.id });
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
    const item = await prisma.ingredient.update({
      where: { id: req.params.id },
      data: { active: false }
    });
    broadcastDataChange('ingredients', { action: 'deleted', id: item.id });
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
    const table = await prisma.diningTable.update({
      where: { id: req.params.id },
      data: { active: false }
    });
    broadcastDataChange('tables', { action: 'deleted', id: table.id });
    broadcastDataChange('dashboard', { action: 'updated', source: 'tables' });
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

export default router;
