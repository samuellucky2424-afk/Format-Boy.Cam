// @ts-nocheck
/**
 * POST /api/auth/resolve-user
 *
 * Resolves the canonical user ID for a given authenticated session.
 * Handles the case where the same email has been used to create multiple
 * Supabase auth identities (e.g. email+password first, then Google OAuth),
 * by migrating all data to the oldest (canonical) user ID and returning it.
 *
 * The caller MUST include: Authorization: Bearer <supabase_access_token>
 */
import { supabaseAdmin, supabaseAdminConfigError } from '../supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!supabaseAdmin) {
    return res.status(503).json({ error: supabaseAdminConfigError });
  }

  // ── 1. Authenticate the caller via their JWT ─────────────────────────────
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }

  const { data: { user: authUser }, error: jwtError } = await supabaseAdmin.auth.getUser(token);

  if (jwtError || !authUser) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const currentId = authUser.id;
  const email = authUser.email;

  if (!email) {
    // No email means we cannot deduplicate; just echo back the current ID.
    return res.json({ canonicalUserId: currentId, linked: false });
  }

  try {
    // ── 2. Find ALL Supabase auth users with the same email ─────────────────
    //
    // supabaseAdmin.auth.admin.listUsers() can be paginated; for most apps
    // the total user count is small enough that page 1 is sufficient.
    // If you have >1000 users, add pagination here.
    const { data: { users: allUsers }, error: listError } =
      await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });

    if (listError) {
      console.error('[resolve-user] listUsers error:', listError);
      // Non-fatal: fall back to using current ID
      return res.json({ canonicalUserId: currentId, linked: false });
    }

    const sameEmailUsers = (allUsers || []).filter(
      (u) => u.email?.toLowerCase() === email.toLowerCase(),
    );

    // ── 3. Determine the canonical (oldest) user ─────────────────────────────
    //
    // The canonical user is the one created first — that is the account
    // the user built up credits on before linking providers.
    sameEmailUsers.sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );

    const canonicalUser = sameEmailUsers[0];

    if (!canonicalUser) {
      // Should not happen since authUser is always in the list
      return res.json({ canonicalUserId: currentId, linked: false });
    }

    const canonicalId = canonicalUser.id;

    // ── 4. If current user IS the canonical user, nothing to migrate ─────────
    if (canonicalId === currentId) {
      // Ensure a wallet exists for the canonical user (idempotent)
      await ensureWallet(canonicalId);
      return res.json({ canonicalUserId: canonicalId, linked: false });
    }

    // ── 5. Current session belongs to a duplicate — migrate data ─────────────
    console.log(
      `[resolve-user] Migrating duplicate user ${currentId} → canonical ${canonicalId} (email: ${email})`,
    );

    // Ensure canonical wallet exists before transferring data into it
    await ensureWallet(canonicalId);

    // 5a. Migrate wallet credits: add duplicate's credits to canonical wallet
    await mergeWallets(currentId, canonicalId);

    // 5b. Re-assign transactions
    await migrateTable('transactions', 'user_id', currentId, canonicalId);

    // 5c. Re-assign sessions
    await migrateTable('sessions', 'user_id', currentId, canonicalId);

    // 5d. Clean up the orphan wallet row (it should now be empty / 0)
    await supabaseAdmin.from('wallets').delete().eq('user_id', currentId);

    return res.json({ canonicalUserId: canonicalId, linked: true });
  } catch (err) {
    console.error('[resolve-user] Unexpected error:', err);
    // Always return *something* so the frontend can continue
    return res.status(500).json({ canonicalUserId: currentId, linked: false, error: String(err?.message) });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Ensure a wallet row exists for the given userId.
 * Uses upsert with ignoreDuplicates so it is always safe to call.
 */
async function ensureWallet(userId) {
  const { error } = await supabaseAdmin
    .from('wallets')
    .upsert({ user_id: userId, credits: 0 }, { onConflict: 'user_id', ignoreDuplicates: true });

  if (error) {
    console.error(`[resolve-user] ensureWallet(${userId}) error:`, error);
  }
}

/**
 * Move credits from the duplicate wallet into the canonical wallet,
 * then zero out the duplicate.
 */
async function mergeWallets(fromId, toId) {
  // Fetch both wallets
  const { data: fromWallet } = await supabaseAdmin
    .from('wallets')
    .select('credits')
    .eq('user_id', fromId)
    .maybeSingle();

  if (!fromWallet || !fromWallet.credits || fromWallet.credits <= 0) {
    // Nothing to transfer
    return;
  }

  const { data: toWallet } = await supabaseAdmin
    .from('wallets')
    .select('credits')
    .eq('user_id', toId)
    .maybeSingle();

  const toCredits = toWallet?.credits ?? 0;
  const newCredits = toCredits + fromWallet.credits;

  // Update canonical wallet with merged credits
  const { error: updateError } = await supabaseAdmin
    .from('wallets')
    .update({ credits: newCredits })
    .eq('user_id', toId);

  if (updateError) {
    console.error(`[resolve-user] mergeWallets update error:`, updateError);
    throw updateError;
  }

  console.log(`[resolve-user] Merged ${fromWallet.credits} credits from ${fromId} → ${toId} (new total: ${newCredits})`);
}

/**
 * Re-assign all rows in `table` where `column = fromId` to `toId`.
 */
async function migrateTable(table, column, fromId, toId) {
  const { error } = await supabaseAdmin
    .from(table)
    .update({ [column]: toId })
    .eq(column, fromId);

  if (error) {
    console.error(`[resolve-user] migrateTable(${table}) error:`, error);
    // Non-fatal: log and continue
  } else {
    console.log(`[resolve-user] Migrated ${table}.${column}: ${fromId} → ${toId}`);
  }
}
