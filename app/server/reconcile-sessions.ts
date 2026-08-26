// @ts-nocheck
import { supabaseAdmin, supabaseAdminConfigError } from '../api/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const cronSecret = process.env.CRON_SECRET;
  const authorization = String(req.headers?.authorization || '');
  if (!cronSecret || authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!supabaseAdmin) {
    return res.status(503).json({ error: supabaseAdminConfigError || 'Supabase is not configured' });
  }

  const { data, error } = await supabaseAdmin.rpc('reconcile_stale_billed_sessions', {
    p_stale_after_seconds: 15,
  });
  if (error) {
    console.error('Stale session reconciliation failed:', error);
    return res.status(500).json({ error: 'Session reconciliation failed' });
  }
  return res.json({ reconciled: Number(data || 0) });
}
