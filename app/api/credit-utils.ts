// @ts-nocheck
import { supabaseAdmin } from './supabase.js';

function buildError(message, cause) {
  const error = new Error(message);
  error.cause = cause;
  return error;
}

export function assertValidCredits(value, context = 'credits') {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw buildError(`Invalid credits value for ${context}`);
  }

  return value;
}

function normalizeWallet(wallet, context) {
  if (!wallet) {
    return null;
  }

  return {
    id: wallet.id,
    userId: wallet.user_id,
    credits: assertValidCredits(wallet.credits, context),
  };
}

export async function getWalletByUserId(userId, options = {}) {
  const { createIfMissing = false } = options;

  if (!supabaseAdmin) {
    throw buildError('Supabase admin client is not configured');
  }

  const { data: wallet, error } = await supabaseAdmin
    .from('wallets')
    .select('id, user_id, credits')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw buildError(`Failed to fetch wallet: ${error.message}`, error);
  }

  if (wallet) {
    return normalizeWallet(wallet, 'wallet read');
  }

  if (!createIfMissing) {
    return null;
  }

  const { data: createdWallet, error: createError } = await supabaseAdmin
    .from('wallets')
    .insert({
      user_id: userId,
      credits: 0,
    })
    .select('id, user_id, credits')
    .single();

  if (createError) {
    throw buildError(`Failed to create wallet: ${createError.message}`, createError);
  }

  return normalizeWallet(createdWallet, 'wallet creation');
}

export async function requireWalletByUserId(userId, options = {}) {
  const wallet = await getWalletByUserId(userId, options);

  if (!wallet) {
    throw buildError('Wallet not found');
  }

  return wallet;
}

export async function updateWalletCredits(userId, nextCredits) {
  const safeCredits = Math.max(0, assertValidCredits(nextCredits, 'wallet update'));

  if (!supabaseAdmin) {
    throw buildError('Supabase admin client is not configured');
  }

  const { data: wallet, error } = await supabaseAdmin
    .from('wallets')
    .update({ credits: safeCredits })
    .eq('user_id', userId)
    .select('id, user_id, credits')
    .single();

  if (error) {
    throw buildError(`Failed to update wallet credits: ${error.message}`, error);
  }

  const normalizedWallet = normalizeWallet(wallet, 'wallet update');

  if (!normalizedWallet) {
    throw buildError('Wallet update returned no data');
  }

  return normalizedWallet;
}

export function logCreditUpdate({ userId, before, after, change, source }) {
  console.log('[CREDIT UPDATE]', {
    userId,
    before,
    after,
    change,
    source,
  });
}
