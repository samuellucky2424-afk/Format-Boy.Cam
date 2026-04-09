// @ts-nocheck
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasSupabaseAdminConfig = Boolean(supabaseUrl && supabaseServiceKey);

export const supabaseAdminConfigError = !supabaseUrl
  ? 'Missing SUPABASE_URL or VITE_SUPABASE_URL'
  : !supabaseServiceKey
    ? 'Missing SUPABASE_SERVICE_KEY or SUPABASE_SERVICE_ROLE_KEY'
    : null;

export const supabaseAdmin = hasSupabaseAdminConfig
  ? createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })
  : null;
