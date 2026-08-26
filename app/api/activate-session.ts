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
  const providerSessionId = String(req.body?.providerSessionId || '').trim() || null;
  if (!sessionId) return res.status(400).json({ error: 'Session ID is required' });

  try {
    await requireAuthorizedUser(req, userId);
    const { data, error } = await supabaseAdmin.rpc('activate_billed_session', {
      p_user_id: userId,
      p_session_id: sessionId,
      p_provider_session_id: providerSessionId,
    });
    if (error) {
      console.error('activate_billed_session failed:', error);
      const status = error.code === 'P0002' ? 404 : ['P0001', '23505'].includes(error.code) ? 409 : 500;
      return res.status(status).json({ error: error.message });
    }
    return res.json(data);
  } catch (error) {
    return sendApiError(res, error, 'Failed to activate session');
  }
}
