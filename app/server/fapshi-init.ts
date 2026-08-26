// @ts-nocheck
// POST /api/payment/fapshi-init
// Creates a pending payment row and returns the Fapshi checkout link.
// The wallet is only credited later by an admin (admin_confirm_payment).
import { supabaseAdmin, supabaseAdminConfigError } from '../api/supabase.js';
import { requireAuthorizedUser, sendApiError } from '../api/auth.js';
import { fapshiConfigError, fapshiRequest } from './fapshi-client.js';

function appPublicUrl() {
  const raw = process.env.PAYMENT_RETURN_URL || process.env.APP_PUBLIC_URL || 'http://localhost:5173';
  return String(raw).replace(/\/+$/, '');
}

function paymentReturnUrl(paymentId, returnToApp) {
  if (returnToApp) {
    const bridge = new URL(
      process.env.FAPSHI_APP_RETURN_URL ||
        'https://henshin.numzer0.store/api/payment/fapshi-return',
    );
    if (bridge.protocol !== 'https:') {
      throw new Error('FAPSHI_APP_RETURN_URL must use HTTPS.');
    }
    bridge.searchParams.set('ref', paymentId);
    return bridge.toString();
  }

  const base = appPublicUrl();
  const separator = base.includes('#') ? (base.includes('?') ? '&' : '?') : '/#/payment-success?';
  return `${base}${separator}ref=${encodeURIComponent(paymentId)}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const adminError = supabaseAdminConfigError || fapshiConfigError();
  if (!supabaseAdmin || adminError) {
    return res.status(503).json({ error: adminError || 'Payments are not configured' });
  }

  const packageId = String(req.body?.packageId || '').trim();
  const requestedUserId = String(req.body?.userId || '').trim();
  const returnToApp = req.body?.returnToApp === true;

  if (!packageId) {
    return res.status(400).json({ error: 'A credit package is required.' });
  }

  try {
    const { authUser, userId: billingUserId } = await requireAuthorizedUser(req, requestedUserId);

    const { data: creditPackage, error: packageError } = await supabaseAdmin
      .from('credit_packages')
      .select('id, credits, price_xaf')
      .eq('id', packageId)
      .eq('is_active', true)
      .maybeSingle();

    if (packageError || !creditPackage) {
      return res.status(400).json({ error: 'The selected credit package is unavailable.' });
    }

    const amountXaf = Math.round(Number(creditPackage.price_xaf || 0));
    const credits = Number(creditPackage.credits);
    if (!Number.isFinite(amountXaf) || amountXaf < 100 || !Number.isFinite(credits) || credits <= 0) {
      return res.status(500).json({ error: 'The selected package has invalid pricing.' });
    }

    const { data: payment, error: insertError } = await supabaseAdmin
      .from('crypto_payments')
      .insert({
        user_id: billingUserId,
        package_id: creditPackage.id,
        amount: amountXaf,
        currency: 'XAF',
        credits,
        crypto_currency: 'FAPSHI',
        status: 'pending',
        provider_status: 'CREATED',
      })
      .select('id')
      .single();

    if (insertError) {
      console.error('[fapshi-init] Insert failed:', insertError);
      return res.status(500).json({ error: 'Could not start the payment.' });
    }

    let initiated;
    try {
      initiated = await fapshiRequest('/initiate-pay', {
        method: 'POST',
        body: {
          amount: amountXaf,
          email: authUser.email || undefined,
          userId: billingUserId,
          externalId: payment.id,
          message: `Henshin ${credits.toLocaleString('en-US')} credits`,
          redirectUrl: paymentReturnUrl(payment.id, returnToApp),
        },
      });
    } catch (initError) {
      await supabaseAdmin.from('crypto_payments').delete().eq('id', payment.id);
      console.error('[fapshi-init] Initiate failed:', initError);
      return res.status(502).json({
        error: initError?.message || 'Could not create the checkout. Please try again.',
      });
    }

    const transId = String(initiated?.transId || '').trim();
    if (!transId || !initiated?.link) {
      await supabaseAdmin.from('crypto_payments').delete().eq('id', payment.id);
      return res.status(502).json({ error: 'The payment gateway returned an invalid response.' });
    }

    const { error: referenceError } = await supabaseAdmin
      .from('crypto_payments')
      .update({ reference: transId })
      .eq('id', payment.id);

    if (referenceError) {
      console.error('[fapshi-init] Could not store transaction reference:', referenceError);
      const { error: cleanupError } = await supabaseAdmin
        .from('crypto_payments')
        .delete()
        .eq('id', payment.id);
      if (cleanupError) {
        console.error('[fapshi-init] Could not clean up payment after reference failure:', cleanupError);
      }
      return res.status(500).json({
        error: 'Could not save the payment reference. Please start a new payment.',
      });
    }

    return res.status(201).json({
      paymentId: payment.id,
      transId,
      link: initiated.link,
    });
  } catch (error) {
    return sendApiError(res, error, 'Could not start the payment.');
  }
}
