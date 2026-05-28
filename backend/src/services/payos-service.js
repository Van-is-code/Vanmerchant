import PayOS from '@payos/node';
import { config } from '../config.js';
import { businessDate } from './order-service.js';

let payosClient;

function requirePayosConfig() {
  const missing = [];

  if (!config.payos.clientId) missing.push('PAYOS_CLIENT_ID');
  if (!config.payos.apiKey) missing.push('PAYOS_API_KEY');
  if (!config.payos.checksumKey) missing.push('PAYOS_CHECKSUM_KEY');

  if (missing.length) {
    throw new Error(`Thiếu cấu hình PayOS: ${missing.join(', ')}`);
  }
}

function getPayosClient() {
  requirePayosConfig();

  if (!payosClient) {
    payosClient = new PayOS({
      clientId: config.payos.clientId,
      apiKey: config.payos.apiKey,
      checksumKey: config.payos.checksumKey,
      ...(config.payos.baseUrl ? { baseURL: config.payos.baseUrl } : {})
    });
  }

  return payosClient;
}

function buildPayosOrderCode(date = businessDate()) {
  const suffix = `${String(Date.now()).slice(-5)}${String(Math.floor(Math.random() * 100)).padStart(2, '0')}`;
  return Number(`${date.replaceAll('-', '')}${suffix}`);
}

export function buildPayosIntentReferenceCode(date = businessDate()) {
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `PY${date.replaceAll('-', '')}${suffix}`;
}

export async function createPayosLink({ amount, referenceCode, description, items } = {}) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Số tiền thanh toán không hợp lệ');
  }

  const payos = getPayosClient();
  const orderCode = buildPayosOrderCode();
  const paymentData = {
    orderCode,
    amount,
    description: (description || referenceCode || 'Thanh toan don hang').slice(0, 25),
    returnUrl: `${config.frontendUrl}/payment/result`,
    cancelUrl: `${config.frontendUrl}/payment/result`,
    ...(items?.length ? { items } : {})
  };

  const paymentLink = await payos.paymentRequests.create(paymentData);

  return {
    orderCode,
    checkoutUrl: paymentLink.checkoutUrl,
    qrDataUrl: paymentLink.qrCode || paymentLink.checkoutUrl,
    paymentLink
  };
}

export async function verifyPayosWebhook(body) {
  const payos = getPayosClient();
  return payos.webhooks.verify(body);
}