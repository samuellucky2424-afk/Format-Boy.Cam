// @ts-nocheck
// GET /api/payment/fapshi-status?ref=<paymentId> (ou ?transId=<fapshiTransId>)
// Refreshes the raw Fapshi status of a payment. It NEVER credits the wallet:
// credits are only added when an admin runs admin_confirm_payment.
import { supabaseAdmin, supabaseAdminConfigError } from '../api/supabase.js';
import {
  fapshiConfigError,
  fapshiRequest,
  normalizeFapshiStatus,
} from './fapshi-client.js';
import { authorizedUserIds, requireAuthUser, sendApiError } from '../api/auth.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const adminError = supabaseAdminConfigError || fapshiConfigError();
  if (!supabaseAdmin || adminError) {
    return res.status(503).json({ error: adminError || 'Payments are not configured' });
  }

  const paymentId = String(req.query?.ref || '').trim();
  const transId = String(req.query?.transId || '').trim();

  if (!paymentId && !transId) {
    return res.status(400).json({ error: 'A payment reference is required.' });
  }

  try {
    const authUser = await requireAuthUser(req);
    let query = supabaseAdmin
      .from('crypto_payments')
      .select('id, user_id, amount, currency, credits, status, provider_status, reference')
      .limit(1);

    query = paymentId ? query.eq('id', paymentId) : query.eq('reference', transId);

    const { data: payment, error: lookupError } = await query.maybeSingle();

    if (lookupError) {
      console.error('[fapshi-status] Lookup failed:', lookupError);
      return res.status(500).json({ error: 'Could not load the payment.' });
    }
    if (!payment) {
      return res.status(404).json({ error: 'Payment not found.' });
    }
    const allowedUserIds = await authorizedUserIds(authUser);
    if (!allowedUserIds.includes(payment.user_id)) {
      return res.status(403).json({ error: 'This payment belongs to another account.' });
    }

    // Only ask Fapshi while the transaction can still change state.
    const storedStatus = normalizeFapshiStatus(payment.provider_status);
    const isSettled =
      storedStatus === 'SUCCESSFUL' ||
      storedStatus === 'FAILED' ||
      storedStatus === 'EXPIRED' ||
      payment.status !== 'pending';

    if (isSettled || !payment.reference) {
      return res.json({
        paymentId: payment.id,
        transId: payment.reference,
        providerStatus: storedStatus,
        paymentStatus: payment.status,
        credits: payment.credits,
        amount: Number(payment.amount),
        currency: payment.currency,
      });
    }

    let remote;
    try {
      remote = await fapshiRequest(`/payment-status/${encodeURIComponent(payment.reference)}`);
    } catch (statusError) {
      console.error('[fapshi-status] Remote status failed:', statusError);
      return res.json({
        paymentId: payment.id,
        transId: payment.reference,
        providerStatus: storedStatus,
        paymentStatus: payment.status,
        credits: payment.credits,
        amount: Number(payment.amount),
        currency: payment.currency,
      });
    }

    const providerStatus = normalizeFapshiStatus(remote?.status);

    await supabaseAdmin
      .from('crypto_payments')
      .update({ provider_status: providerStatus })
      .eq('id', payment.id)
      .eq('status', 'pending');

    return res.json({
      paymentId: payment.id,
      transId: payment.reference,
      providerStatus,
      paymentStatus: payment.status,
      credits: payment.credits,
      amount: Number(payment.amount),
      currency: payment.currency,
      operatorReference: remote?.operator_reference || undefined,
    });
  } catch (error) {
    return sendApiError(res, error, 'Could not load the payment.');
  }
}
