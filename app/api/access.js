export function isAccessActive(row, now = Date.now()) {
  if (!row || row.status !== 'active') return false;
  if (row.plan_name === 'Unlimited' && (row.ends_at == null || row.ends_at === '')) return true;
  if (row.ends_at == null || row.ends_at === '') return false;
  const ends = Date.parse(row.ends_at);
  return Number.isFinite(ends) && ends > now;
}

export function accessLabel(durationDays) {
  if (durationDays == null) return 'Unlimited, no expiry';
  if (durationDays === 14) return '14 days access';
  return `${durationDays} days access`;
}

export async function getActiveAccess(admin, userId, now = Date.now()) {
  const { data, error } = await admin
    .from('subscriptions')
    .select('id, status, ends_at, plan_name')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return isAccessActive(data, now) ? data : null;
}
