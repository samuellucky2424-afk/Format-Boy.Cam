// @ts-nocheck
import crypto from 'crypto';
import { supabaseAdmin, supabaseAdminConfigError } from '../supabase.js';
import { requireWalletByUserId, logCreditUpdate, updateWalletCredits } from '../credit-utils.js';

const CREDIT_PRICING_NGN = {
  500: 14000,
  1000: 28000,
  2000: 56000,
  5000: 140000
};

const CREDITS_PER_SECOND = 2;

function toKobo(amountNGN) {
  const amount = Number(amountNGN);
  return Number.isFinite(amount) ? Math.round(amount * 100) : NaN;
}

const CREDIT_PRICING_KOBO = Object.fromEntries(
  Object.entries(CREDIT_PRICING_NGN).map(([credits, ngn]) => [credits, toKobo(ngn)])
);

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

    if (event?.data?.currency && event.data.currency !== 'NGN') {
      console.warn(`Webhook: unexpected currency ${event.data.currency} for reference ${reference}`);
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

    let creditsToAdd = 0;
    for (const [credits, expectedKobo] of Object.entries(CREDIT_PRICING_KOBO)) {
      if (amountKobo === expectedKobo) {
        creditsToAdd = Number(credits);
        break;
      }
    }

    if (creditsToAdd === 0) {
      console.error(`Webhook: amount ₦${(amountKobo / 100).toLocaleString()} does not match any valid credit tier.`);
      return res.status(200).json({ status: 'ok' });
    }

    const creditAccount = await requireWalletByUserId(userId, { createIfMissing: true });
    const newCredits = creditAccount.credits + creditsToAdd;
    const updatedWallet = await updateWalletCredits(userId, newCredits);
    logCreditUpdate({
      userId,
      before: creditAccount.credits,
      after: updatedWallet.credits,
      change: creditsToAdd,
      source: 'payment-webhook',
    });

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
        description: 'Credit purchase via Paystack webhook',
        metadata: {
          provider: 'paystack',
          transaction_id: String(event?.data?.id ?? ''),
          currency: 'NGN',
          customer_email: event?.data?.customer?.email,
          source: 'webhook',
          credits_per_second: CREDITS_PER_SECOND,
        },
        created_at: new Date().toISOString(),
      });

    return res.status(200).json({ status: 'ok' });
  } catch (error) {
    console.error('Webhook processing error:', error);
    return res.status(200).json({ status: 'ok' });
  }
}
