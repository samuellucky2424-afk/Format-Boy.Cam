// @ts-nocheck
// POST /api/payment/fapshi-webhook
// Receives Fapshi payment status notifications (SUCCESSFUL/FAILED/EXPIRED).
// It only records the raw status: credits are added exclusively by an admin
// via admin_confirm_payment, so a webhook can never credit a wallet.
import { supabaseAdmin, supabaseAdminConfigError } from '../api/supabase.js';
import { timingSafeEqual } from 'node:crypto';
import { normalizeFapshiStatus } from './fapshi-client.js';

function webhookSecretConfigured() {
  return Boolean(process.env.FAPSHI_WEBHOOK_SECRET);
}

function isExpectedSecret(expected, received) {
  const expectedBuffer = Buffer.from(String(expected || ''));
  const receivedBuffer = Buffer.from(String(received || ''));
  if (expectedBuffer.length !== receivedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-wh-secret');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!supabaseAdmin || supabaseAdminConfigError) {
    return res.status(503).json({ error: 'Payments are not configured' });
  }

  if (!webhookSecretConfigured()) {
    console.error('[fapshi-webhook] FAPSHI_WEBHOOK_SECRET is not configured');
    return res.status(503).json({ error: 'Webhook is not configured' });
  }

  const signature = String(req.headers?.['x-wh-secret'] || '');
  if (!isExpectedSecret(process.env.FAPSHI_WEBHOOK_SECRET, signature)) {
    console.error('[fapshi-webhook] Invalid webhook secret');
    return res.status(401).json({ error: 'Invalid webhook secret' });
  }

  const transId = String(req.body?.transId || '').trim();
  const externalId = String(req.body?.externalId || '').trim();
  const providerStatus = normalizeFapshiStatus(req.body?.status);

  if (!transId && !externalId) {
    return res.status(400).json({ error: 'Missing transId or externalId' });
  }
  if (!['SUCCESSFUL', 'FAILED', 'EXPIRED'].includes(providerStatus)) {
    return res.status(400).json({ error: 'Unsupported payment status' });
  }

  try {
    let lookup = supabaseAdmin
      .from('crypto_payments')
      .select('id')
      .limit(1);
    lookup = transId ? lookup.eq('reference', transId) : lookup.eq('id', externalId);
    const { data: payment, error: lookupError } = await lookup.maybeSingle();

    if (lookupError) {
      console.error('[fapshi-webhook] Lookup failed:', lookupError);
      return res.status(500).json({ error: 'Lookup failed' });
    }
    if (!payment) {
      console.warn('[fapshi-webhook] Unknown payment reference, ignoring');
      return res.status(200).json({ ok: true });
    }

    const { error: updateError } = await supabaseAdmin
      .from('crypto_payments')
      .update({ provider_status: providerStatus })
      .eq('id', payment.id)
      .eq('status', 'pending');

    if (updateError) {
      console.error('[fapshi-webhook] Update failed:', updateError);
      return res.status(500).json({ error: 'Update failed' });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[fapshi-webhook] Unexpected error:', error);
    return res.status(500).json({ error: 'Unexpected error' });
  }
}
