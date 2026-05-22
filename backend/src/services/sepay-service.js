import { config } from '../config.js';

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
  const pattern = /SP\d{11}/;
  const candidates = [body.code, body.referenceCode, body.content, body.description]
    .filter(Boolean)
    .map((value) => String(value));

  for (const candidate of candidates) {
    const match = candidate.match(pattern);
    if (match) {
      return match[0];
    }
  }

  return candidates[0] || '';
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

  const transferType = String(body.transferType || body.type || body.status || '').toLowerCase();

  return {
    transactionId: String(body.id || body.referenceCode || body.code || '').trim(),
    referenceCode: extractReferenceCodeFromWebhook(body).trim(),
    amount: Number(body.transferAmount || body.amount || 0),
    success: transferType === 'in' || transferType === 'success' || transferType === 'paid',
    raw: body
  };
}