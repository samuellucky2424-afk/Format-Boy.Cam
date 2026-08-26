// @ts-nocheck
// Shared Fapshi API client (https://docs.fapshi.com).
// Sandbox: https://sandbox.fapshi.com — Live: https://live.fapshi.com

export const FAPSHI_BASE_URL = (
  process.env.FAPSHI_BASE_URL || 'https://sandbox.fapshi.com'
).replace(/\/+$/, '');

export function fapshiConfigError() {
  if (!process.env.FAPSHI_APIUSER || !process.env.FAPSHI_APIKEY) {
    return 'Fapshi API credentials are not configured';
  }
  return null;
}

function fapshiHeaders(withBody) {
  const headers = {
    apiuser: process.env.FAPSHI_APIUSER,
    apikey: process.env.FAPSHI_APIKEY,
  };
  if (withBody) headers['Content-Type'] = 'application/json';
  return headers;
}

export async function fapshiRequest(path, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(`${FAPSHI_BASE_URL}${path}`, {
      method,
      headers: fapshiHeaders(Boolean(body)),
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    console.error('[fapshi] Network error:', error);
    throw new Error('Payment gateway is unreachable. Please try again.');
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error('[fapshi] API error:', response.status, data);
    throw new Error(data?.message || `Fapshi request failed (${response.status})`);
  }
  return data;
}

// Raw statuses reported by Fapshi for a transaction.
export const FAPSHI_STATUSES = Object.freeze([
  'CREATED',
  'PENDING',
  'SUCCESSFUL',
  'FAILED',
  'EXPIRED',
]);

export function normalizeFapshiStatus(value) {
  const text = String(value || '').toUpperCase();
  return FAPSHI_STATUSES.includes(text) ? text : 'UNKNOWN';
}
