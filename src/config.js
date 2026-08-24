const path = require('node:path');
require('dotenv').config();

const rootDir = path.resolve(__dirname, '..');

module.exports = {
  rootDir,
  port: Number(process.env.PORT || 3000),
  env: process.env.NODE_ENV || 'development',
  appName: process.env.APP_NAME || 'HadirKu',
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  timezone: process.env.TIMEZONE || 'Asia/Jakarta',
  sessionSecret: process.env.SESSION_SECRET || 'development-secret-change-me',
  encryptionKey: process.env.DATA_ENCRYPTION_KEY || process.env.SESSION_SECRET || 'development-encryption-key-change-me',
  dbPath: path.resolve(rootDir, process.env.DB_PATH || 'data/attendance.db'),
  admin: {
    name: process.env.ADMIN_NAME || 'Administrator',
    email: process.env.ADMIN_EMAIL || 'admin@attendance.local',
    password: process.env.ADMIN_PASSWORD || 'admin123'
  },
  solution: {
    baseUrl: (process.env.SOLUTION_BASE_URL || 'https://www.solutioncloud.co.id').replace(/\/$/, ''),
    apiKey: process.env.SOLUTION_API_KEY || '',
    apiSecret: process.env.SOLUTION_API_SECRET || '',
    authHeader: process.env.SOLUTION_AUTH_HEADER || 'Authorization',
    authScheme: process.env.SOLUTION_AUTH_SCHEME || 'Bearer',
    devicesPath: process.env.SOLUTION_DEVICES_PATH || '/api/devices',
    attendancePath: process.env.SOLUTION_ATTENDANCE_PATH || '/api/attendance',
    timeoutMs: Number(process.env.SOLUTION_TIMEOUT_MS || 20000),
    webhookSecret: process.env.SOLUTION_WEBHOOK_SECRET || 'change-me-webhook-secret',
    verifyTls: process.env.SOLUTION_VERIFY_TLS !== 'false'
  }
};
