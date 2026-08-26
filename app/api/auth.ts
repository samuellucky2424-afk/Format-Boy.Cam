// @ts-nocheck
import { supabaseAdmin, supabaseAdminConfigError } from './supabase.js';

export class ApiAuthError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function bearerToken(req) {
  const header = String(req.headers?.authorization || '');
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || '';
}

export function isSameAccountIdentity(authUser, requestedUserId, requestedEmail = '') {
  if (String(requestedUserId || '').trim() === authUser?.id) return true;
  const authEmail = String(authUser?.email || '').trim().toLowerCase();
  return Boolean(authEmail && authEmail === String(requestedEmail || '').trim().toLowerCase());
}

export async function requireAuthUser(req) {
  if (!supabaseAdmin) {
    throw new ApiAuthError(503, supabaseAdminConfigError || 'Supabase is not configured');
  }

  const token = bearerToken(req);
  if (!token) throw new ApiAuthError(401, 'Authentication required');

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) throw new ApiAuthError(401, 'Invalid or expired token');
  return data.user;
}

export async function requireAuthorizedUser(req, requestedUserId) {
  const authUser = await requireAuthUser(req);
  const userId = String(requestedUserId || '').trim();
  if (!userId) throw new ApiAuthError(400, 'User ID is required');
  if (isSameAccountIdentity(authUser, userId)) return { authUser, userId };

  if (!authUser.email) {
    throw new ApiAuthError(403, 'The selected account does not match this session');
  }

  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
  const requestedUser = data?.user;
  if (
    error ||
    !requestedUser?.email ||
    !isSameAccountIdentity(authUser, userId, requestedUser.email)
  ) {
    throw new ApiAuthError(403, 'The selected account does not match this session');
  }

  return { authUser, userId };
}

export async function authorizedUserIds(authUser) {
  if (!authUser.email) return [authUser.id];

  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw new ApiAuthError(500, 'Could not resolve the authenticated account');

  const email = authUser.email.toLowerCase();
  const ids = (data?.users || [])
    .filter((candidate) => candidate.email?.toLowerCase() === email)
    .map((candidate) => candidate.id);
  return ids.includes(authUser.id) ? ids : [authUser.id, ...ids];
}

export async function requireAdminUser(req) {
  const authUser = await requireAuthUser(req);
  const userIds = await authorizedUserIds(authUser);
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, is_admin')
    .in('id', userIds)
    .eq('is_admin', true)
    .limit(1)
    .maybeSingle();

  if (error) throw new ApiAuthError(500, 'Could not verify administrator access');
  if (!data?.id) throw new ApiAuthError(403, 'Administrator access required');
  return { authUser, adminUserId: data.id };
}

export function sendApiError(res, error, fallback = 'Internal server error') {
  if (error instanceof ApiAuthError) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error(fallback, error);
  return res.status(500).json({ error: fallback });
}
