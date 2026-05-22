import { config } from '../config.js';

export function buildKitchenTicket(order) {
  const rows = order.items
    .map((item) => `${item.quantity} x ${item.name} (${item.price.toLocaleString('vi-VN')}d)`)
    .join('\n');

  return [
    config.storeName,
    `STT: ${order.dailySequence}`,
    `Ban: ${order.table.name}`,
    `SDT: ${order.customer.phone}`,
    `Thanh toan: ${order.paymentMethod} - ${order.paymentStatus}`,
    '------------------------------',
    rows,
    '------------------------------',
    `Tong: ${order.subtotal.toLocaleString('vi-VN')}d`,
    order.note ? `Ghi chu: ${order.note}` : ''
  ]
    .filter(Boolean)
    .join('\n');
}

export async function printKitchenTicket(order) {
  const ticket = buildKitchenTicket(order);

  if (!config.printerEnabled) {
    console.log('\n=== KITCHEN TICKET ===\n' + ticket + '\n======================\n');
    return { printed: false, ticket };
  }

  // Connect ESC/POS or vendor SDK here in production.
  return { printed: true, ticket };
}
