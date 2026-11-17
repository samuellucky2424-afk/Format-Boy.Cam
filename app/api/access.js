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

export function describeAccess(row, now = Date.now()) {
  if (!isAccessActive(row, now)) {
    return { active: false, planName: null, endsAt: null, label: 'No active plan' };
  }
  if (row.plan_name === 'Unlimited' && (row.ends_at == null || row.ends_at === '')) {
    return { active: true, planName: 'Unlimited', endsAt: null, label: 'Unlimited' };
  }
  const ends = Date.parse(row.ends_at);
  const days = Math.max(1, Math.ceil((ends - now) / 86_400_000));
  return {
    active: true,
    planName: row.plan_name,
    endsAt: row.ends_at,
    label: `${days} day${days === 1 ? '' : 's'} left`,
  };
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
