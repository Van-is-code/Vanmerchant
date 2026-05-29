import { Router } from 'express';
import { prisma } from '../db.js';
import { createPaidOrderFromIntent, markOrderPaid } from '../services/order-service.js';
import { printKitchenTicket } from '../services/print-service.js';
import { verifyPayosWebhook } from '../services/payos-service.js';
import { broadcastDataChange } from '../services/realtime.js';

const router = Router();

router.post('/payos', async (req, res, next) => {
  try {
    const data = await verifyPayosWebhook(req.body);
    const isPaid = String(data.code || '').trim() === '00';
    const transactionId = String(data.paymentLinkId || data.reference || data.orderCode || '').trim();

    if (!data.orderCode) {
      return res.status(200).json({ success: true });
    }

    if (transactionId) {
      const processedIntent = await prisma.paymentIntent.findFirst({
        where: { payosTransactionId: transactionId }
      });
      if (processedIntent) {
        return res.status(200).json({ success: true });
      }
    }

    const intent = await prisma.paymentIntent.findUnique({
      where: { payosOrderCode: data.orderCode }
    });
    if (intent) {
      if (isPaid) {
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
              payosTransactionId: transactionId || null,
              orderId: order.id
            }
          });

          return order;
        });

        try {
          await printKitchenTicket(paid);
        } catch (error) {
          console.warn('Khong the in bill tu webhook PayOS:', error.message);
        }
        broadcastDataChange('payment-intents', {
          action: 'paid',
          intentId: intent.id,
          orderId: paid.id,
          referenceCode: intent.referenceCode
        });
        broadcastDataChange('orders', { action: 'paid', orderId: paid.id });
        broadcastDataChange('dashboard', { action: 'updated', source: 'webhook' });
      } else {
        await prisma.paymentIntent.update({
          where: { id: intent.id },
          data: {
            status: 'FAILED',
            payosTransactionId: transactionId || null
          }
        });
        broadcastDataChange('payment-intents', {
          action: 'failed',
          intentId: intent.id,
          referenceCode: intent.referenceCode
        });
      }

      return res.status(200).json({ success: true });
    }

    const order = await prisma.order.findUnique({
      where: { payosOrderCode: data.orderCode }
    });
    if (!order) {
      return res.status(200).json({ success: true });
    }

    if (isPaid) {
      const paid = await markOrderPaid(order.id);
      await prisma.order.update({
        where: { id: paid.id },
        data: { payosTransactionId: transactionId || null }
      });
      try {
        await printKitchenTicket(paid);
      } catch (error) {
        console.warn('Khong the in bill tu webhook PayOS:', error.message);
      }
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
    if (error?.name === 'WebhookError') {
      return res.status(400).json({ message: error.message });
    }

    return next(error);
  }
});

export default router;
