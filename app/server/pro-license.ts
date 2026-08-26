// @ts-nocheck
import { requireAuthorizedUser, sendApiError } from '../api/auth.js';
import { supabaseAdmin } from '../api/supabase.js';
import {
  getProLicenseByUserId,
  hashLicenseCode,
  normalizeLicenseCode,
  publicLicenseStatus,
} from './pro-utils.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const userId = String(req.method === 'GET' ? req.query?.userId : req.body?.userId || '').trim();

  try {
    await requireAuthorizedUser(req, userId);

    if (req.method === 'GET') {
      return res.json(publicLicenseStatus(await getProLicenseByUserId(userId)));
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const code = normalizeLicenseCode(req.body?.code);
    if (!/^HENSHIN-PRO-[A-Z2-9]{4}(?:-[A-Z2-9]{4}){3}$/.test(code)) {
      return res.status(400).json({ error: 'Invalid PRO license code format' });
    }

    const { data, error } = await supabaseAdmin.rpc('redeem_pro_license', {
      p_user_id: userId,
      p_code_hash: hashLicenseCode(code),
    });
    if (error) {
      const status = error.code === 'P0002' ? 404 : error.code === 'P0001' ? 403 : 500;
      return res.status(status).json({ error: error.message });
    }

    return res.json({ ...data, ...(publicLicenseStatus(await getProLicenseByUserId(userId))) });
  } catch (error) {
    return sendApiError(res, error, 'Failed to manage PRO license');
  }
}
