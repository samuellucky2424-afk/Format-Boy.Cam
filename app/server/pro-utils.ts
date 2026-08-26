// @ts-nocheck
import { createHash, randomBytes } from 'node:crypto';
import { supabaseAdmin } from '../api/supabase.js';

export const FAL_LUCY_APP = 'decart/lucy-2-5/realtime';
export const DEFAULT_PRO_CREDITS_PER_SECOND = 80;
export const PRO_CONTACT_PHONE = '237620124019';

const LICENSE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function normalizeLicenseCode(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

export function hashLicenseCode(value) {
  return createHash('sha256').update(normalizeLicenseCode(value), 'utf8').digest('hex');
}

export function generateLicenseCode() {
  const bytes = randomBytes(16);
  let cursor = 0;
  const group = () => {
    let output = '';
    for (let index = 0; index < 4; index += 1) {
      output += LICENSE_ALPHABET[bytes[cursor++] % LICENSE_ALPHABET.length];
    }
    return output;
  };
  return `HENSHIN-PRO-${group()}-${group()}-${group()}-${group()}`;
}

export function resolveSessionCreditsPerSecond(provider, license) {
  if (provider === 'reactor') return 2;
  if (provider !== 'fal' || license?.status !== 'active') return null;
  const rate = Number(license.credits_per_second);
  return Number.isInteger(rate) && rate > 0 ? rate : null;
}

export async function getProLicenseByUserId(userId) {
  const { data, error } = await supabaseAdmin
    .from('pro_licenses')
    .select('id, user_id, status, credits_per_second, code_last4, redeemed_at, revoked_at, created_at, updated_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export function publicLicenseStatus(license) {
  return {
    hasLicense: Boolean(license),
    active: license?.status === 'active',
    status: license?.status || 'none',
    licenseId: license?.id || null,
    creditsPerSecond: license?.status === 'active' ? Number(license.credits_per_second) : null,
    codeLast4: license?.code_last4 || null,
    redeemedAt: license?.redeemed_at || null,
    contactPhone: PRO_CONTACT_PHONE,
  };
}
