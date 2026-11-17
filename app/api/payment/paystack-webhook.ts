// @ts-nocheck
import crypto from 'crypto';
import { supabaseAdmin, supabaseAdminConfigError } from '../supabase.js';
import { requireWalletByUserId } from '../credit-utils.js';

function getHeader(req, name) {
  const value = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ status: 'ok' });
  }

  const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!paystackSecretKey) {
    console.error('PAYSTACK_SECRET_KEY not configured');
    return res.status(200).json({ status: 'ok' });
  }

  const signature = getHeader(req, 'x-paystack-signature');
  const rawBody =
    typeof req.body === 'string'
      ? req.body
      : typeof req.rawBody === 'string'
        ? req.rawBody
        : JSON.stringify(req.body ?? {});
  const computed = crypto.createHmac('sha512', paystackSecretKey).update(rawBody).digest('hex');

  if (!signature || signature !== computed) {
    console.error('Invalid Paystack webhook signature');
    return res.status(200).json({ status: 'ok' });
  }

  if (!supabaseAdmin) {
    console.error('Supabase admin not configured:', supabaseAdminConfigError);
    return res.status(200).json({ status: 'ok' });
  }

  try {
    const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    if (event?.event !== 'charge.success') {
      return res.status(200).json({ status: 'ok' });
    }

    const reference = event?.data?.reference;
    if (!reference) {
      return res.status(200).json({ status: 'ok' });
    }

    const { data: existingTx } = await supabaseAdmin
      .from('transactions')
      .select('id')
      .eq('reference', reference)
      .eq('status', 'success')
      .maybeSingle();

    if (existingTx) {
      return res.status(200).json({ status: 'ok' });
    }

    const paidCurrency = event?.data?.currency || 'NGN';
    if (paidCurrency !== 'NGN' && paidCurrency !== 'USD') {
      console.warn(`Webhook: unexpected currency ${paidCurrency} for reference ${reference}`);
      return res.status(200).json({ status: 'ok' });
    }

    const amountKobo = Number(event?.data?.amount);
    if (!Number.isFinite(amountKobo)) {
      console.error(`Webhook: invalid amount for reference ${reference}`);
      return res.status(200).json({ status: 'ok' });
    }

    const refParts = String(reference).split('-');
    const userId = refParts?.length >= 3 ? refParts.slice(2).join('-') : null;
    if (!userId) {
      console.error(`Webhook: could not extract userId from reference: ${reference}`);
      return res.status(200).json({ status: 'ok' });
    }

    const { data: plans, error: plansError } = await supabaseAdmin
      .from('credit_packages')
      .select('id, name, price_ngn, price_usd, credits, plan_code')
      .eq('is_active', true);

    if (plansError || !plans) {
      console.error('Webhook: could not load access plans');
      return res.status(200).json({ status: 'ok' });
    }

    const matchedPlan = plans.find((plan) => {
      const expected = paidCurrency === 'USD' ? Number(plan.price_usd) : Number(plan.price_ngn);
      return Math.round(expected * 100) === amountKobo;
    });

    if (!matchedPlan) {
      console.error(`Webhook: amount ${(amountKobo / 100).toLocaleString()} ${paidCurrency} does not match an active plan.`);
      return res.status(200).json({ status: 'ok' });
    }

    const creditsToAdd = Number(matchedPlan.credits) || 0;
    const creditAccount = await requireWalletByUserId(userId, { createIfMissing: true });

    if (matchedPlan.plan_code) {
      const { error: accessError } = await supabaseAdmin.rpc('grant_plan_access', {
        p_user_id: userId,
        p_package_id: matchedPlan.id,
        p_amount: amountKobo / 100,
        p_currency: paidCurrency,
      });
      if (accessError) {
        console.error('Webhook: access grant failed', accessError);
        return res.status(200).json({ status: 'ok' });
      }
    }

    await supabaseAdmin
      .from('transactions')
      .insert({
        user_id: userId,
        wallet_id: creditAccount.id,
        amount: amountKobo / 100,
        credits: creditsToAdd,
        type: 'credit',
        status: 'success',
        reference,
        provider: 'paystack',
        description: matchedPlan.plan_code ? `Access plan: ${matchedPlan.name}` : 'Credit purchase via Paystack webhook',
        metadata: {
          provider: 'paystack',
          transaction_id: String(event?.data?.id ?? ''),
          currency: paidCurrency,
          plan_code: matchedPlan.plan_code,
          customer_email: event?.data?.customer?.email,
          source: 'webhook',
        },
        created_at: new Date().toISOString(),
      });

    return res.status(200).json({ status: 'ok' });
  } catch (error) {
    console.error('Webhook processing error:', error);
    return res.status(200).json({ status: 'ok' });
  }
}
