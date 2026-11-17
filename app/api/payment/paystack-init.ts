// @ts-nocheck
import { supabaseAdmin, supabaseAdminConfigError } from '../supabase.js';

function toKobo(amountNGN) {
  const amount = Number(amountNGN);
  return Number.isFinite(amount) ? Math.round(amount * 100) : NaN;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { userId, credits, email, packageId } = req.body;

  if (!userId || !email || (!packageId && !credits)) {
    return res.status(400).json({
      status: 'failed',
      message: 'Missing required fields: userId, email, and packageId',
    });
  }

  const requestedCredits = Number(credits);

  if (!supabaseAdmin) {
    return res.status(503).json({
      status: 'failed',
      message: supabaseAdminConfigError || 'Supabase admin is not configured',
    });
  }

  let planQuery = supabaseAdmin
    .from('credit_packages')
    .select('id, name, price_ngn, price_usd, plan_code, duration_days, credits')
    .eq('is_active', true);

  planQuery = packageId
    ? planQuery.eq('id', packageId)
    : planQuery.eq('credits', requestedCredits);

  const { data: plan, error: planError } = await planQuery.maybeSingle();

  if (planError || !plan) {
    return res.status(400).json({
      status: 'failed',
      message: 'Invalid plan selected or plan not found in backend',
    });
  }

  const priceUsd = Number(plan.price_usd);
  const amountNGN = Number(plan.price_ngn);
  const currency = priceUsd > 0 ? 'USD' : 'NGN';
  const amountMajor = currency === 'USD' ? priceUsd : amountNGN;

  const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!paystackSecretKey) {
    return res.status(500).json({
      status: 'failed',
      message: 'Paystack secret key not configured',
    });
  }

  const reference = `FMT-${Date.now()}-${userId}`;
  const amountKobo = toKobo(amountMajor);

  if (!Number.isFinite(amountKobo) || amountKobo <= 0) {
    return res.status(500).json({
      status: 'failed',
      message: 'Invalid payment amount configuration',
    });
  }

  try {
    const initResponse = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${paystackSecretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        amount: amountKobo,
        reference,
        currency,
        metadata: {
          user_id: userId,
          package_id: plan.id,
          plan_code: plan.plan_code,
          credits: plan.credits,
        },
      }),
    });

    const initData = await initResponse.json();

    if (!initResponse.ok || !initData?.status) {
      return res.status(400).json({
        status: 'failed',
        message: initData?.message || 'Failed to initialize Paystack transaction',
      });
    }

    return res.status(200).json({
      status: 'success',
      reference,
      amountNGN: currency === 'NGN' ? amountMajor : 0,
      amountUSD: currency === 'USD' ? amountMajor : 0,
      currency,
      amountKobo,
      packageId: plan.id,
      planCode: plan.plan_code,
      credits: plan.credits,
      authorization_url: initData?.data?.authorization_url,
      access_code: initData?.data?.access_code,
    });
  } catch (error) {
    console.error('Paystack init error:', error);
    return res.status(500).json({
      status: 'failed',
      message: 'Internal server error during payment initialization',
    });
  }
}
