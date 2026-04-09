// @ts-nocheck
import { supabaseAdmin, supabaseAdminConfigError } from '../supabase.js';

const CREDIT_PRICING = {
  500: 18500,
  1000: 37000,
  2000: 74000,
  5000: 185000
};
const CREDITS_PER_SECOND = 2;

async function loadOrCreateCreditAccount(userId) {
  let { data: creditAccount } = await supabaseAdmin
    .from('wallets')
    .select('id, credits')
    .eq('user_id', userId)
    .maybeSingle();

  if (!creditAccount) {
    const { data: createdAccount, error: createError } = await supabaseAdmin
      .from('wallets')
      .insert({
        user_id: userId,
        credits: 0,
      })
      .select('id, credits')
      .single();

    if (createError) {
      throw createError;
    }

    creditAccount = createdAccount;
  }

  return creditAccount;
}

export default async function handler(req, res) {
  // Always respond 200 quickly to Flutterwave
  if (req.method !== 'POST') {
    return res.status(200).json({ status: 'ok' });
  }

  // 1. Validate webhook signature
  const webhookSecret = process.env.FLUTTERWAVE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('FLUTTERWAVE_WEBHOOK_SECRET not configured');
    return res.status(200).json({ status: 'ok' });
  }

  const signature = req.headers['verif-hash'];
  if (!signature || signature !== webhookSecret) {
    console.error('Invalid webhook signature');
    return res.status(200).json({ status: 'ok' });
  }

  if (!supabaseAdmin) {
    console.error('Supabase admin not configured:', supabaseAdminConfigError);
    return res.status(200).json({ status: 'ok' });
  }

  try {
    const event = req.body;

    // 2. Only process successful charge events
    if (event?.event !== 'charge.completed' || event?.data?.status !== 'successful') {
      return res.status(200).json({ status: 'ok' });
    }

    const { tx_ref, amount, currency, id: transaction_id, customer } = event.data;

    // 3. Validate currency
    if (currency !== 'NGN') {
      console.warn(`Webhook: unexpected currency ${currency} for tx_ref ${tx_ref}`);
      return res.status(200).json({ status: 'ok' });
    }

    // 4. Extract user_id from tx_ref (format: FMT-{timestamp}-{userId})
    const txRefParts = tx_ref?.split('-');
    const userId = txRefParts?.length >= 3 ? txRefParts.slice(2).join('-') : null;

    if (!userId) {
      console.error(`Webhook: could not extract userId from tx_ref: ${tx_ref}`);
      return res.status(200).json({ status: 'ok' });
    }

    // 5. Check for duplicate — idempotency
    const { data: existingTx } = await supabaseAdmin
      .from('transactions')
      .select('id')
      .eq('reference', tx_ref)
      .eq('status', 'success')
      .maybeSingle();

    if (existingTx) {
      console.log(`Webhook: tx_ref ${tx_ref} already processed, skipping`);
      return res.status(200).json({ status: 'ok' });
    }

    let creditsToAdd = 0;
    const paidAmount = Number(amount || 0);
    for (const [credits, expectedPrice] of Object.entries(CREDIT_PRICING)) {
      if (paidAmount === expectedPrice) {
        creditsToAdd = Number(credits);
        break;
      }
    }

    if (creditsToAdd === 0) {
      console.error(`Webhook: amount ${paidAmount} does not match any valid credit tier.`);
      return res.status(200).json({ status: 'ok' });
    }

    const creditAccount = await loadOrCreateCreditAccount(userId);
    const newCredits = (creditAccount.credits || 0) + creditsToAdd;

    await supabaseAdmin
      .from('wallets')
      .update({ credits: newCredits })
      .eq('user_id', userId);

    // 7. Insert transaction record
    await supabaseAdmin
      .from('transactions')
      .insert({
        user_id: userId,
        wallet_id: creditAccount.id,
        amount: Number(amount || 0),
        credits: creditsToAdd,
        type: 'credit',
        status: 'success',
        tx_ref,
        reference: tx_ref,
        provider: 'flutterwave',
        description: 'Credit purchase via Flutterwave webhook',
        metadata: {
          provider: 'flutterwave',
          transaction_id: String(transaction_id),
          currency: 'NGN',
          customer_email: customer?.email,
          source: 'webhook',
          credits_per_second: CREDITS_PER_SECOND,
        },
        created_at: new Date().toISOString(),
      });

    console.log(`Webhook: added ${creditsToAdd} credits for user ${userId} (tx_ref: ${tx_ref})`);
    return res.status(200).json({ status: 'ok' });
  } catch (error) {
    console.error('Webhook processing error:', error);
    // Always return 200 to prevent Flutterwave retries on server errors
    return res.status(200).json({ status: 'ok' });
  }
}
