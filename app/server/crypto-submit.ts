// @ts-nocheck
import { supabaseAdmin, supabaseAdminConfigError } from '../api/supabase.js';

function getBearerToken(req) {
  const authHeader = String(req.headers?.authorization || '');
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
}

async function resolveBillingUserId(authUser, requestedUserId) {
  if (!requestedUserId || requestedUserId === authUser.id) {
    return authUser.id;
  }

  if (!authUser.email) {
    return null;
  }

  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
  if (error) {
    console.error('[crypto-submit] Could not verify canonical user:', error);
    return null;
  }

  const requestedUser = (data?.users || []).find((candidate) => candidate.id === requestedUserId);
  if (
    !requestedUser?.email ||
    requestedUser.email.toLowerCase() !== authUser.email.toLowerCase()
  ) {
    return null;
  }

  return requestedUser.id;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!supabaseAdmin) {
    return res.status(503).json({
      error: supabaseAdminConfigError || 'Supabase admin is not configured',
    });
  }

  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Please sign in again before submitting payment.' });
  }

  const {
    data: { user: authUser },
    error: authError,
  } = await supabaseAdmin.auth.getUser(token);

  if (authError && (![400, 401, 403, 404].includes(authError.status)
      || /^invalid api key$/i.test(authError.message))) {
    console.warn('[crypto-submit] Auth service could not verify session', {
      status: authError.status,
      code: authError.code,
    });
    return res.status(503).json({
      error: 'Payment verification is temporarily unavailable. Try submitting again without sending another payment.',
    });
  }

  if (authError || !authUser) {
    return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  }

  const packageId = String(req.body?.packageId || '').trim();
  const paymentMethodId = String(req.body?.paymentMethodId || '').trim();
  const requestedUserId = String(req.body?.userId || '').trim();

  if (!packageId || !paymentMethodId) {
    return res.status(400).json({ error: 'A package and payment method are required.' });
  }

  try {
    const billingUserId = await resolveBillingUserId(authUser, requestedUserId);
    if (!billingUserId) {
      return res.status(403).json({ error: 'The selected account does not match this session.' });
    }

    const [packageResult, methodResult] = await Promise.all([
      supabaseAdmin
        .from('credit_packages')
        .select('id, credits, price_ngn, price_usd, plan_code, duration_days')
        .eq('id', packageId)
        .eq('is_active', true)
        .maybeSingle(),
      supabaseAdmin
        .from('payment_methods')
        .select('id, name, crypto_currency, network')
        .eq('id', paymentMethodId)
        .eq('is_active', true)
        .maybeSingle(),
    ]);

    if (packageResult.error || !packageResult.data) {
      return res.status(400).json({ error: 'The selected credit package is unavailable.' });
    }
    if (methodResult.error || !methodResult.data) {
      return res.status(400).json({ error: 'The selected payment method is unavailable.' });
    }

    const creditPackage = packageResult.data;
    const paymentMethod = methodResult.data;
    const usdAmount = Number(creditPackage.price_usd || 0);
    const ngnAmount = Number(creditPackage.price_ngn || 0);
    const amount = usdAmount > 0 ? usdAmount : ngnAmount;
    const currency = usdAmount > 0 ? 'USD' : 'NGN';
    const credits = Number(creditPackage.credits);

    const isAccessPlan = creditPackage.plan_code === 'two_weeks'
      || creditPackage.plan_code === 'thirty_days'
      || creditPackage.plan_code === 'unlimited';
    if (!Number.isFinite(amount) || amount <= 0 || (!isAccessPlan && (!Number.isFinite(credits) || credits <= 0))) {
      return res.status(500).json({ error: 'The selected plan has invalid pricing.' });
    }

    const { data: payment, error: insertError } = await supabaseAdmin
      .from('crypto_payments')
      .insert({
        user_id: billingUserId,
        package_id: creditPackage.id,
        amount,
        currency,
        credits,
        crypto_currency: paymentMethod.crypto_currency,
        status: 'pending',
      })
      .select('id, status')
      .single();

    if (insertError) {
      console.error('[crypto-submit] Insert failed:', insertError);
      return res.status(500).json({ error: 'Could not submit the payment request.' });
    }

    return res.status(201).json({
      paymentId: payment.id,
      status: payment.status,
      paymentMethod: {
        id: paymentMethod.id,
        name: paymentMethod.name,
        cryptoCurrency: paymentMethod.crypto_currency,
        network: paymentMethod.network,
      },
    });
  } catch (error) {
    console.error('[crypto-submit] Unexpected error:', error);
    return res.status(500).json({ error: 'Could not submit the payment request.' });
  }
}
