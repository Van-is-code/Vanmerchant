import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { markOrderPaid } from '../services/order-service.js';
import { printKitchenTicket } from '../services/print-service.js';
import { broadcastDataChange } from '../services/realtime.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const status = req.query.status ? String(req.query.status).split(',') : undefined;
    const orders = await prisma.order.findMany({
      where: status ? { status: { in: status } } : {},
      include: { table: true, customer: true, items: true },
      orderBy: { createdAt: 'desc' },
      take: 100
    });
    return res.json(orders);
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id/status', async (req, res, next) => {
  try {
    const data = z
      .object({
        status: z.enum(['NEW', 'PREPARING', 'DELIVERING', 'DELIVERED', 'CANCELLED']).optional(),
        paymentStatus: z.enum(['UNPAID', 'PENDING_PAYMENT', 'PAID', 'FAILED', 'CANCELLED']).optional()
      })
      .parse(req.body);

    if (data.status === 'CANCELLED' && !['OWNER', 'ADMIN'].includes(req.user?.role)) {
      return res.status(403).json({ message: 'Chỉ chủ quán được hủy đơn từ trang quản trị' });
    }

    // Thêm timestamps khi status thay đổi
    const updateData = { ...data };
    if (data.status === 'PREPARING') {
      updateData.completedAt = new Date();
    } else if (data.status === 'DELIVERING') {
      updateData.completedAt = new Date();
    } else if (data.status === 'DELIVERED') {
      updateData.deliveredAt = new Date();
    }

    let order;
    if (data.paymentStatus === 'PAID') {
      order = await markOrderPaid(req.params.id);
    } else {
      order = await prisma.order.update({
        where: { id: req.params.id },
        data: updateData,
        include: { table: true, customer: true, items: true }
      });
    }

    if (order.status === 'PREPARING') {
      await printKitchenTicket(order);
    }

    broadcastDataChange('orders', { action: 'updated', orderId: order.id });
    broadcastDataChange('dashboard', { action: 'updated', orderId: order.id });

    return res.json(order);
  } catch (error) {
    return next(error);
  }
});

export default router;
