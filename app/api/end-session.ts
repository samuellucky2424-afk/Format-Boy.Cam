// @ts-nocheck
import { requireAuthorizedUser, sendApiError } from './auth.js';
import { supabaseAdmin } from './supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'private, no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const userId = String(req.body?.userId || '').trim();
  const sessionId = String(req.body?.sessionId || '').trim();
  const reason = String(req.body?.reason || '').trim();
  if (!sessionId) return res.status(400).json({ error: 'Session ID is required' });
  if (!reason) return res.status(400).json({ error: 'End reason is required' });

  try {
    await requireAuthorizedUser(req, userId);
    const { data, error } = await supabaseAdmin.rpc('finish_billed_session', {
      p_user_id: userId,
      p_session_id: sessionId,
      p_reason: reason.slice(0, 200),
    });
    if (error) {
      console.error('finish_billed_session failed:', error);
      const status = error.code === 'P0002' ? 404 : error.code === 'P0001' ? 409 : 500;
      return res.status(status).json({ error: error.message });
    }
    return res.json(data);
  } catch (error) {
    return sendApiError(res, error, 'Failed to end session');
  }
}
