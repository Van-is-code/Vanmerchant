import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { calculateCart, createOrderFromCart, businessDate } from '../services/order-service.js';
import { createPayosLink, buildPayosIntentReferenceCode } from '../services/payos-service.js';
import { broadcastDataChange } from '../services/realtime.js';

const router = Router();

router.get('/tables/:qrCode', async (req, res, next) => {
  try {
    const table = await prisma.diningTable.findUnique({
      where: { qrCode: req.params.qrCode }
    });
    if (!table || !table.active) {
      return res.status(404).json({ message: 'Bàn không tồn tại hoặc đã tắt' });
    }

    const categories = await prisma.category.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        items: {
          where: { active: true },
          orderBy: { name: 'asc' }
        }
      }
    });

    return res.json({ table, categories });
  } catch (error) {
    return next(error);
  }
});

router.post('/customers', async (req, res, next) => {
  try {
    const data = z.object({ phone: z.string().min(8), name: z.string().optional() }).parse(req.body);
    const customer = await prisma.customer.upsert({
      where: { phone: data.phone },
      update: { name: data.name },
      create: data
    });
    broadcastDataChange('customers', { action: 'upserted', id: customer.id });
    return res.json(customer);
  } catch (error) {
    return next(error);
  }
});

router.get('/customers/:phone/orders', async (req, res, next) => {
  try {
    const orders = await prisma.order.findMany({
      where: { customer: { phone: req.params.phone } },
      include: { table: true, items: true },
      orderBy: { createdAt: 'desc' },
      take: 30
    });
    return res.json(orders);
  } catch (error) {
    return next(error);
  }
});

router.post('/orders', async (req, res, next) => {
  try {
    const data = z
      .object({
        qrCode: z.string(),
        phone: z.string().min(8),
        paymentMethod: z.literal('CASH'),
        note: z.string().optional(),
        items: z.array(z.object({ menuItemId: z.string(), quantity: z.number().int().min(1) })).min(1)
      })
      .parse(req.body);

    const [table, customer, cart] = await Promise.all([
      prisma.diningTable.findUnique({ where: { qrCode: data.qrCode } }),
      prisma.customer.upsert({
        where: { phone: data.phone },
        update: {},
        create: { phone: data.phone }
      }),
      calculateCart(data.items)
    ]);

    if (!table || !table.active) {
      return res.status(404).json({ message: 'Không tìm thấy bàn' });
    }

    const subtotal = cart.reduce((sum, item) => sum + item.lineTotal, 0);
    const costTotal = cart.reduce((sum, item) => sum + item.lineCost, 0);
    const date = businessDate();

    const order = await prisma.$transaction(async (tx) => {
      return createOrderFromCart(tx, {
        date,
        tableId: table.id,
        customerId: customer.id,
        paymentMethod: 'CASH',
        paymentStatus: 'PENDING_PAYMENT',
        status: 'NEW',
        subtotal,
        costTotal,
        note: data.note,
        items: cart
      });
    });

    broadcastDataChange('orders', { action: 'created', orderId: order.id });
    broadcastDataChange('dashboard', { action: 'updated', source: 'orders' });

    return res.status(201).json(order);
  } catch (error) {
    return next(error);
  }
});

router.post('/payment-intents', async (req, res, next) => {
  try {
    const data = z
      .object({
        qrCode: z.string(),
        phone: z.string().min(8),
        note: z.string().optional(),
        items: z.array(z.object({ menuItemId: z.string(), quantity: z.number().int().min(1) })).min(1)
      })
      .parse(req.body);

    const [table, customer, cart] = await Promise.all([
      prisma.diningTable.findUnique({ where: { qrCode: data.qrCode } }),
      prisma.customer.upsert({
        where: { phone: data.phone },
        update: {},
        create: { phone: data.phone }
      }),
      calculateCart(data.items)
    ]);

    if (!table || !table.active) {
      return res.status(404).json({ message: 'Không tìm thấy bàn' });
    }

    const subtotal = cart.reduce((sum, item) => sum + item.lineTotal, 0);
    const costTotal = cart.reduce((sum, item) => sum + item.lineCost, 0);
    const date = businessDate();
    const referenceCode = buildPayosIntentReferenceCode(date);
    const payment = await createPayosLink({ amount: subtotal, referenceCode });

    const intent = await prisma.paymentIntent.create({
      data: {
        referenceCode,
        qrCode: data.qrCode,
        phone: data.phone,
        tableId: table.id,
        customerId: customer.id,
        businessDate: date,
        paymentMethod: 'BANK_TRANSFER',
        status: 'PENDING',
        subtotal,
        costTotal,
        note: data.note,
        items: cart,
        payosOrderCode: payment.orderCode,
        payosCheckoutUrl: payment.checkoutUrl,
        payosQrCode: payment.qrDataUrl
      }
    });

    return res.status(201).json({
      intent: {
        ...intent,
        qrDataUrl: payment.qrDataUrl
      },
      checkoutUrl: payment.checkoutUrl,
      qrDataUrl: payment.qrDataUrl
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/payment-intents/:id', async (req, res, next) => {
  try {
    const intent = await prisma.paymentIntent.findUnique({
      where: { id: req.params.id },
      include: { order: { include: { table: true, customer: true, items: true } } }
    });

    if (!intent) {
      return res.status(404).json({ message: 'Không tìm thấy yêu cầu thanh toán' });
    }

    const order = intent.order || (intent.orderId
      ? await prisma.order.findUnique({
          where: { id: intent.orderId },
          include: { table: true, customer: true, items: true }
        })
      : null);

    return res.json({
      intent: {
        ...intent,
        qrDataUrl: intent.payosQrCode
      },
      order,
      orderId: intent.orderId,
      qrDataUrl: intent.payosQrCode,
      checkoutUrl: intent.payosCheckoutUrl
    });
  } catch (error) {
    return next(error);
  }
});

router.delete('/payment-intents/:id', async (req, res, next) => {
  try {
    const data = z.object({ phone: z.string().min(8) }).parse(req.body);
    const intent = await prisma.paymentIntent.findUnique({ where: { id: req.params.id } });

    if (!intent || intent.phone !== data.phone) {
      return res.status(404).json({ message: 'Không tìm thấy yêu cầu thanh toán' });
    }

    if (intent.status === 'PAID' || intent.orderId) {
      return res.status(400).json({ message: 'Đơn đã được thanh toán, không thể hủy' });
    }

    const cancelled = await prisma.paymentIntent.update({
      where: { id: intent.id },
      data: { status: 'CANCELLED' }
    });

    return res.json({ success: true, intent: cancelled });
  } catch (error) {
    return next(error);
  }
});

router.patch('/orders/:id/cancel', async (req, res, next) => {
  try {
    const data = z.object({ phone: z.string().min(8) }).parse(req.body);
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: { customer: true, table: true, items: true }
    });

    if (!order || order.customer.phone !== data.phone) {
      return res.status(404).json({ message: 'Không tìm thấy đơn của số điện thoại này' });
    }

    if (order.status !== 'NEW') {
      return res.status(400).json({ message: 'Chỉ hủy được đơn đang chờ xác nhận' });
    }

    const cancelled = await prisma.order.update({
      where: { id: order.id },
      data: { status: 'CANCELLED', paymentStatus: order.paymentStatus === 'PAID' ? 'PAID' : 'CANCELLED' },
      include: { table: true, customer: true, items: true }
    });

    broadcastDataChange('orders', { action: 'cancelled', orderId: cancelled.id });
    broadcastDataChange('dashboard', { action: 'updated', source: 'orders' });

    return res.json(cancelled);
  } catch (error) {
    return next(error);
  }
});

export default router;
