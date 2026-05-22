import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret',
  storeName: process.env.STORE_NAME || 'Van Merchant',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  backendUrl: process.env.BACKEND_URL || 'http://localhost:4000',
  printerEnabled: process.env.PRINTER_ENABLED === 'true',
  sepay: {
    enabled: process.env.SEPAY_ENABLED !== 'false',
    apiUrl: process.env.SEPAY_API_URL || 'https://userapi.sepay.vn/v2',
    merchantId: process.env.MERCHANT_ID || '',
    secretKey: process.env.SECRET_KEY || '',
    accountNumber: process.env.SEPAY_ACCOUNT_NUMBER || '',
    bankCode: process.env.SEPAY_BANK_CODE || '',
    accountName: process.env.SEPAY_ACCOUNT_NAME || '',
    webhookApiKey: process.env.SEPAY_WEBHOOK_API_KEY || ''
  }
};
