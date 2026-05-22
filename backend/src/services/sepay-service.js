import { config } from '../config.js';
import { businessDate } from './order-service.js';

const SEPAY_QR_BASE_URL = 'https://qr.sepay.vn/img';

function requireSepayConfig() {
  if (!config.sepay.enabled) {
    throw new Error('SePay đang bị tắt bằng SEPAY_ENABLED=false');
  }

  if (!config.sepay.accountNumber || !config.sepay.bankCode) {
    throw new Error('Thiếu SEPAY_ACCOUNT_NUMBER hoặc SEPAY_BANK_CODE');
  }
}

export function buildSepayReferenceCode(order) {
  return `SP${order.businessDate.replaceAll('-', '')}${String(order.dailySequence).padStart(3, '0')}`;
}

export function buildSepayIntentReferenceCode(date = businessDate()) {
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `SP${date.replaceAll('-', '')}${suffix}`;
}

export function buildSepayQrUrl({ amount, referenceCode }) {
  requireSepayConfig();

  const params = new URLSearchParams({
    acc: config.sepay.accountNumber,
    bank: config.sepay.bankCode,
    amount: String(amount),
    des: referenceCode,
    template: 'compact'
  });

  return `${SEPAY_QR_BASE_URL}?${params.toString()}`;
}

export async function createSepayLink(order) {
  const referenceCode = order.sepayReferenceCode || buildSepayReferenceCode(order);
  const checkoutUrl = buildSepayQrUrl({ amount: order.subtotal, referenceCode });

  return {
    referenceCode,
    checkoutUrl,
    qrDataUrl: checkoutUrl
  };
}

function extractReferenceCodeFromWebhook(body) {
  const candidates = [body.referenceCode, body.code, body.content, body.description]
    .filter(Boolean)
    .map((value) => String(value).trim());

  const patterns = [
    /\bSP[0-9A-Z]{8,32}\b/i,
    /\bDH[0-9A-Z_-]{3,64}\b/i
  ];

  for (const candidate of candidates) {
    for (const pattern of patterns) {
      const match = candidate.match(pattern);
      if (match) {
        return match[0].toUpperCase();
      }
    }
  }

  const directReference = candidates[0] || '';
  return directReference.toUpperCase();
}

export function verifySepayWebhook(body, headers = {}) {
  requireSepayConfig();

  if (config.sepay.webhookApiKey) {
    const authorization = String(headers.authorization || headers.Authorization || '');
    const token = authorization.toLowerCase().startsWith('apikey ')
      ? authorization.slice(7).trim()
      : String(headers['x-sepay-api-key'] || '');

    if (token !== config.sepay.webhookApiKey) {
      throw new Error('Webhook SePay không hợp lệ');
    }
  }

  const directReferenceCode = String(body.referenceCode || body.code || '').trim();
  const transferType = String(body.transferType || body.type || body.status || '').toLowerCase();
  const referenceCode = directReferenceCode || extractReferenceCodeFromWebhook(body).trim();

  return {
    transactionId: String(body.id || body.transactionId || body.referenceCode || body.code || '').trim(),
    referenceCode,
    amount: Number(body.transferAmount || body.amount || 0),
    success: transferType === 'in' || transferType === 'success' || transferType === 'paid',
    raw: body
  };
}