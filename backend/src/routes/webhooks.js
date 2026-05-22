import { Router } from 'express';
import { prisma } from '../db.js';
import { createPaidOrderFromIntent, markOrderPaid } from '../services/order-service.js';
import { printKitchenTicket } from '../services/print-service.js';
import { verifySepayWebhook } from '../services/sepay-service.js';
import { broadcastDataChange } from '../services/realtime.js';

const router = Router();

router.post('/sepay', async (req, res, next) => {
  try {
    const data = verifySepayWebhook(req.body, req.headers);

    if (!data.transactionId) {
      return res.status(200).json({ success: true });
    }

    const processedIntent = await prisma.paymentIntent.findFirst({
      where: { sepayTransactionId: data.transactionId }
    });
    if (processedIntent) {
      return res.status(200).json({ success: true });
    }

    const intent = await prisma.paymentIntent.findUnique({
      where: { referenceCode: data.referenceCode }
    });
    if (intent) {
      if (data.success) {
        const paid = await prisma.$transaction(async (tx) => {
          const order = intent.orderId
            ? await tx.order.findUnique({ where: { id: intent.orderId } })
            : await createPaidOrderFromIntent(tx, intent);

          if (!order) {
            throw new Error('Không thể tạo đơn từ payment intent');
          }

          await tx.paymentIntent.update({
            where: { id: intent.id },
            data: {
              status: 'PAID',
              sepayTransactionId: data.transactionId,
              orderId: order.id
            }
          });

          return order;
        });

        await printKitchenTicket(paid);
        broadcastDataChange('orders', { action: 'paid', orderId: paid.id });
        broadcastDataChange('dashboard', { action: 'updated', source: 'webhook' });
      } else {
        await prisma.paymentIntent.update({
          where: { id: intent.id },
          data: {
            status: 'FAILED',
            sepayTransactionId: data.transactionId
          }
        });
      }

      return res.status(200).json({ success: true });
    }

    const order = await prisma.order.findUnique({
      where: { sepayReferenceCode: data.referenceCode }
    });
    if (!order) {
      return res.status(200).json({ success: true });
    }

    if (data.success) {
      const paid = await markOrderPaid(order.id);
      await prisma.order.update({
        where: { id: paid.id },
        data: { sepayTransactionId: data.transactionId }
      });
      await printKitchenTicket(paid);
      broadcastDataChange('orders', { action: 'paid', orderId: paid.id });
      broadcastDataChange('dashboard', { action: 'updated', source: 'webhook' });
    } else {
      await prisma.order.update({
        where: { id: order.id },
        data: { paymentStatus: 'FAILED' }
      });
      broadcastDataChange('orders', { action: 'failed', orderId: order.id });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    return next(error);
  }
});

router.post('/payos', async (req, res) => res.status(410).json({ message: 'PayOS đã được tắt, hãy dùng SePay' }));

export default router;
