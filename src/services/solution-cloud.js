const axios = require('axios');
const https = require('node:https');
const db = require('../db');
const config = require('../config');
const { ingestMany } = require('./attendance-service');
const { decrypt } = require('./secrets');

function clientFor(device) {
  const baseURL = (device?.api_url || config.solution.baseUrl).replace(/\/$/, '');
  const token = decrypt(device?.api_token) || config.solution.apiKey;
  const headers = { Accept: 'application/json' };
  if (token) {
    headers[config.solution.authHeader] = config.solution.authScheme
      ? `${config.solution.authScheme} ${token}`.trim()
      : token;
  }
  if (config.solution.apiSecret) headers['X-API-Secret'] = config.solution.apiSecret;

  return axios.create({
    baseURL,
    headers,
    timeout: config.solution.timeoutMs,
    httpsAgent: new https.Agent({ rejectUnauthorized: config.solution.verifyTls })
  });
}

function unwrapRecords(data) {
  if (Array.isArray(data)) return data;
  for (const key of ['data', 'records', 'attendance', 'logs', 'items']) {
    if (Array.isArray(data?.[key])) return data[key];
    if (Array.isArray(data?.data?.[key])) return data.data[key];
  }
  return [];
}

async function testConnection(device) {
  const path = device?.external_id
    ? `${config.solution.devicesPath}/${encodeURIComponent(device.external_id)}`
    : config.solution.devicesPath;
  const response = await clientFor(device).get(path);
  return { ok: true, status: response.status, data: response.data };
}

async function pullAttendance(device, from, to) {
  const startedAt = new Date().toISOString();
  const sync = db.prepare(`
    INSERT INTO sync_logs (device_id, direction, status, started_at) VALUES (?, 'pull', 'running', ?)
  `).run(device?.id || null, startedAt);

  try {
    const params = { from, to };
    if (device?.external_id) params.device_id = device.external_id;
    if (device?.serial_number) params.serial_number = device.serial_number;
    const response = await clientFor(device).get(config.solution.attendancePath, { params });
    const records = unwrapRecords(response.data);
    const result = ingestMany(records, 'solution-cloud-pull');
    db.prepare(`
      UPDATE sync_logs SET status = 'success', records_count = ?, message = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(result.inserted, `${result.received} data diterima`, sync.lastInsertRowid);
    if (device?.id) {
      db.prepare(`UPDATE devices SET status = 'online', last_sync_at = CURRENT_TIMESTAMP, last_seen_at = CURRENT_TIMESTAMP WHERE id = ?`).run(device.id);
    }
    return result;
  } catch (error) {
    const message = error.response?.data?.message || error.message;
    db.prepare(`UPDATE sync_logs SET status = 'failed', message = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(String(message).slice(0, 500), sync.lastInsertRowid);
    throw error;
  }
}

module.exports = { testConnection, pullAttendance, unwrapRecords };
