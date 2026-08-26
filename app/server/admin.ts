// @ts-nocheck
import { requireAdminUser, sendApiError } from '../api/auth.js';
import { supabaseAdmin } from '../api/supabase.js';
import {
  DEFAULT_PRO_CREDITS_PER_SECOND,
  generateLicenseCode,
  hashLicenseCode,
} from './pro-utils.js';

const PERIODS = new Set(['today', '7d', '30d', 'all']);

function periodStart(period) {
  if (period === 'all') return null;
  const now = new Date();
  if (period === 'today') return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const days = period === '7d' ? 7 : 30;
  return new Date(Date.now() - days * 86400000).toISOString();
}

function requireReason(value) {
  const reason = String(value || '').trim();
  if (reason.length < 3) {
    const error = new Error('An audit reason of at least 3 characters is required');
    error.status = 400;
    throw error;
  }
  return reason.slice(0, 500);
}

async function usersById(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (unique.length === 0) return new Map();
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, email, name, is_admin, created_at')
    .in('id', unique);
  if (error) throw error;
  return new Map((data || []).map((user) => [user.id, user]));
}

async function loadClients() {
  const [{ data: users, error: userError }, { data: wallets, error: walletError }, { data: licenses, error: licenseError }] = await Promise.all([
    supabaseAdmin.from('users').select('id, email, name, is_admin, created_at').order('created_at', { ascending: false }).limit(1000),
    supabaseAdmin.from('wallets').select('user_id, credits'),
    supabaseAdmin.from('pro_licenses').select('id, user_id, status, credits_per_second, code_last4, redeemed_at, revoked_at, created_at, updated_at'),
  ]);
  if (userError) throw userError;
  if (walletError) throw walletError;
  if (licenseError) throw licenseError;
  const walletByUser = new Map((wallets || []).map((wallet) => [wallet.user_id, Number(wallet.credits || 0)]));
  const licenseByUser = new Map((licenses || []).map((license) => [license.user_id, license]));
  return (users || []).map((user) => ({
    ...user,
    credits: walletByUser.get(user.id) || 0,
    proLicense: licenseByUser.get(user.id) || null,
  }));
}

async function loadPayments() {
  const [{ data: crypto, error: cryptoError }, { data: transactions, error: transactionError }] = await Promise.all([
    supabaseAdmin.from('crypto_payments').select('*').order('created_at', { ascending: false }).limit(500),
    supabaseAdmin.from('transactions').select('id, user_id, amount, credits, status, reference, description, metadata, created_at').eq('type', 'credit').order('created_at', { ascending: false }).limit(500),
  ]);
  if (cryptoError) throw cryptoError;
  if (transactionError) throw transactionError;
  const website = (transactions || []).filter((row) => row.status === 'pending' || row.description === 'Website credit purchase');
  const rows = [
    ...(crypto || []).map((row) => ({ ...row, source: 'crypto', currency: row.currency || 'USD' })),
    ...website.map((row) => ({
      ...row,
      source: 'website',
      currency: row.metadata?.currency || 'XAF',
      status: row.status === 'success' ? 'completed' : row.status,
    })),
  ].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const userMap = await usersById(rows.map((row) => row.user_id));
  const revenueByCurrency = {};
  for (const row of rows) {
    if (!['completed', 'success'].includes(row.status)) continue;
    const currency = String(row.currency || 'UNKNOWN').toUpperCase();
    revenueByCurrency[currency] = (revenueByCurrency[currency] || 0) + Number(row.amount || 0);
  }
  return {
    rows: rows.map((row) => ({ ...row, user: userMap.get(row.user_id) || null })),
    revenueByCurrency,
    pending: rows.filter((row) => row.status === 'pending').length,
  };
}

async function loadUsage(period) {
  const start = periodStart(period);
  let query = supabaseAdmin
    .from('sessions')
    .select('id, user_id, provider, model, start_time, end_time, seconds_used, credits_used, credits_per_second, status, end_reason')
    .order('start_time', { ascending: false })
    .limit(2000);
  if (start) query = query.gte('start_time', start);
  const { data, error } = await query;
  if (error) throw error;
  const rows = data || [];
  const userMap = await usersById(rows.map((row) => row.user_id));
  const totals = rows.reduce((result, row) => {
    const provider = row.provider || 'unknown';
    const current = result[provider] || { sessions: 0, seconds: 0, credits: 0, providerCostUsd: 0 };
    const seconds = Number(row.seconds_used || 0);
    current.sessions += 1;
    current.seconds += seconds;
    current.credits += Number(row.credits_used || 0);
    if (provider === 'fal') current.providerCostUsd += seconds * 0.04;
    result[provider] = current;
    return result;
  }, {});
  return {
    period,
    totals,
    rows: rows.map((row) => ({
      ...row,
      user: userMap.get(row.user_id) || null,
      providerCostUsd: row.provider === 'fal' ? Number(row.seconds_used || 0) * 0.04 : null,
    })),
  };
}

async function loadLicenses() {
  const { data, error } = await supabaseAdmin
    .from('pro_licenses')
    .select('id, user_id, status, credits_per_second, code_last4, redeemed_at, revoked_at, admin_reason, created_at, updated_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  const userMap = await usersById((data || []).map((license) => license.user_id));
  return (data || []).map((license) => ({ ...license, user: userMap.get(license.user_id) || null }));
}

async function loadPackages() {
  const { data, error } = await supabaseAdmin
    .from('credit_packages')
    .select('id, name, credits, price_usd, price_xaf, is_active, sort_order')
    .order('sort_order', { ascending: true })
    .order('credits', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function handleGet(req, res) {
  const action = String(req.query?.action || 'overview');
  if (action === 'clients') return res.json({ clients: await loadClients() });
  if (action === 'licenses') return res.json({ licenses: await loadLicenses() });
  if (action === 'packages') return res.json({ packages: await loadPackages() });
  if (action === 'payments') return res.json(await loadPayments());
  if (action === 'usage') {
    const requested = String(req.query?.period || '30d');
    const period = PERIODS.has(requested) ? requested : '30d';
    return res.json(await loadUsage(period));
  }
  if (action === 'audit') {
    const { data, error } = await supabaseAdmin
      .from('admin_audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) throw error;
    return res.json({ audit: data || [] });
  }
  if (action === 'overview') {
    const [clients, licenses, payments, usage] = await Promise.all([
      loadClients(), loadLicenses(), loadPayments(), loadUsage('30d'),
    ]);
    return res.json({
      totalUsers: clients.length,
      totalCredits: clients.reduce((sum, client) => sum + client.credits, 0),
      activeProLicenses: licenses.filter((license) => license.status === 'active').length,
      pendingProLicenses: licenses.filter((license) => license.status === 'pending').length,
      pendingPayments: payments.pending,
      revenueByCurrency: payments.revenueByCurrency,
      usageByProvider: usage.totals,
    });
  }
  return res.status(400).json({ error: 'Unknown admin action' });
}

async function handlePost(req, res, adminUserId) {
  const action = String(req.body?.action || '').trim();
  const reason = requireReason(req.body?.reason);

  if (action === 'create-license') {
    const userId = String(req.body?.userId || '').trim();
    const rate = Number(req.body?.creditsPerSecond ?? DEFAULT_PRO_CREDITS_PER_SECOND);
    if (!Number.isInteger(rate) || rate <= 0) return res.status(400).json({ error: 'Invalid PRO credit rate' });
    const code = generateLicenseCode();
    const { data, error } = await supabaseAdmin.rpc('admin_create_pro_license', {
      p_admin_id: adminUserId,
      p_user_id: userId,
      p_code_hash: hashLicenseCode(code),
      p_code_last4: code.slice(-4),
      p_credits_per_second: rate,
      p_reason: reason,
    });
    if (error) throw error;
    return res.json({ license: data, code });
  }

  if (action === 'manage-license') {
    const licenseAction = String(req.body?.licenseAction || '').trim();
    const rate = req.body?.creditsPerSecond == null ? null : Number(req.body.creditsPerSecond);
    const { data, error } = await supabaseAdmin.rpc('admin_manage_pro_license', {
      p_admin_id: adminUserId,
      p_license_id: String(req.body?.licenseId || '').trim(),
      p_action: licenseAction,
      p_credits_per_second: rate,
      p_reason: reason,
    });
    if (error) throw error;
    return res.json({ license: data });
  }

  if (action === 'adjust-credits') {
    const change = Number(req.body?.change);
    if (!Number.isInteger(change) || change === 0) return res.status(400).json({ error: 'Credit change must be a non-zero integer' });
    const { data, error } = await supabaseAdmin.rpc('admin_adjust_wallet_credits', {
      p_admin_id: adminUserId,
      p_user_id: String(req.body?.userId || '').trim(),
      p_change: change,
      p_reason: reason,
    });
    if (error) throw error;
    return res.json(data);
  }

  if (action === 'decide-payment') {
    const status = String(req.body?.status || '').trim();
    const source = String(req.body?.source || '').trim();
    const { data, error } = await supabaseAdmin.rpc('admin_decide_payment', {
      p_admin_id: adminUserId,
      p_source: source,
      p_payment_id: String(req.body?.paymentId || '').trim(),
      p_status: status,
      p_reason: reason,
    });
    if (error) throw error;
    return res.json(data);
  }

  if (action === 'upsert-package') {
    const id = String(req.body?.packageId || '').trim();
    const values = {
      name: String(req.body?.name || '').trim(),
      credits: Number(req.body?.credits),
      price_usd: Number(req.body?.priceUsd || 0),
      price_xaf: Number(req.body?.priceXaf || 0),
      is_active: req.body?.isActive !== false,
    };
    if (!values.name || !Number.isInteger(values.credits) || values.credits <= 0
      || !Number.isFinite(values.price_usd) || values.price_usd < 0
      || !Number.isFinite(values.price_xaf) || values.price_xaf < 0) {
      return res.status(400).json({ error: 'Invalid credit package' });
    }
    const query = id
      ? supabaseAdmin.from('credit_packages').update(values).eq('id', id)
      : supabaseAdmin.from('credit_packages').insert(values);
    const { data, error } = await query.select('id, name, credits, price_usd, price_xaf, is_active, sort_order').single();
    if (error) throw error;
    const { error: auditError } = await supabaseAdmin.from('admin_audit_log').insert({
      actor_user_id: adminUserId,
      action: id ? 'credit_package.update' : 'credit_package.create',
      entity_type: 'credit_package',
      entity_id: data.id,
      reason,
      after_state: data,
    });
    if (auditError) throw auditError;
    return res.json({ package: data });
  }

  return res.status(400).json({ error: 'Unknown admin mutation' });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { adminUserId } = await requireAdminUser(req);
    if (req.method === 'GET') return await handleGet(req, res);
    if (req.method === 'POST') return await handlePost(req, res, adminUserId);
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    if (Number.isInteger(error?.status)) return res.status(error.status).json({ error: error.message });
    return sendApiError(res, error, 'Admin request failed');
  }
}
