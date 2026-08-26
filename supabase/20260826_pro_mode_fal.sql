-- Account-bound PRO licenses, fal.ai provider billing, and immutable admin audit.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.pro_licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  code_hash text NOT NULL UNIQUE,
  code_last4 text NOT NULL CHECK (char_length(code_last4) = 4),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'revoked')),
  credits_per_second integer NOT NULL DEFAULT 80
    CHECK (credits_per_second > 0 AND credits_per_second <= 100000),
  redeemed_at timestamptz,
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  admin_reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  target_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  reason text NOT NULL CHECK (char_length(btrim(reason)) > 0),
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pro_licenses_status_idx
  ON public.pro_licenses (status);
CREATE INDEX IF NOT EXISTS admin_audit_target_created_idx
  ON public.admin_audit_log (target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_actor_created_idx
  ON public.admin_audit_log (actor_user_id, created_at DESC);

ALTER TABLE public.pro_licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

-- License and audit data are exposed only through authenticated server APIs.
REVOKE ALL ON public.pro_licenses FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.admin_audit_log FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.reject_admin_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'Admin audit records are immutable';
END;
$$;

DROP TRIGGER IF EXISTS admin_audit_log_immutable ON public.admin_audit_log;
CREATE TRIGGER admin_audit_log_immutable
  BEFORE UPDATE OR DELETE ON public.admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.reject_admin_audit_mutation();

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS pro_license_id uuid REFERENCES public.pro_licenses(id) ON DELETE SET NULL;

ALTER TABLE public.sessions DROP CONSTRAINT IF EXISTS sessions_provider_check;
ALTER TABLE public.sessions
  ADD CONSTRAINT sessions_provider_check
  CHECK (provider IN ('reactor', 'morphly', 'fal'));

CREATE OR REPLACE FUNCTION public.is_admin_user_id(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE((SELECT is_admin FROM public.users WHERE id = p_user_id), false)
$$;

REVOKE ALL ON FUNCTION public.is_admin_user_id(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin_user_id(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_create_pro_license(
  p_admin_id uuid,
  p_user_id uuid,
  p_code_hash text,
  p_code_last4 text,
  p_credits_per_second integer,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_before public.pro_licenses%ROWTYPE;
  v_after public.pro_licenses%ROWTYPE;
BEGIN
  IF NOT public.is_admin_user_id(p_admin_id) THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF char_length(btrim(COALESCE(p_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'Audit reason is required' USING ERRCODE = '22023';
  END IF;
  IF p_credits_per_second <= 0 OR p_credits_per_second > 100000 THEN
    RAISE EXCEPTION 'Invalid PRO credit rate' USING ERRCODE = '22023';
  END IF;
  IF char_length(p_code_last4) <> 4 OR char_length(p_code_hash) < 32 THEN
    RAISE EXCEPTION 'Invalid license code data' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_before
  FROM public.pro_licenses
  WHERE user_id = p_user_id
  FOR UPDATE;

  INSERT INTO public.pro_licenses (
    user_id, code_hash, code_last4, status, credits_per_second,
    redeemed_at, created_by, revoked_at, revoked_by, admin_reason
  ) VALUES (
    p_user_id, p_code_hash, p_code_last4, 'pending', p_credits_per_second,
    NULL, p_admin_id, NULL, NULL, btrim(p_reason)
  )
  ON CONFLICT (user_id) DO UPDATE SET
    code_hash = EXCLUDED.code_hash,
    code_last4 = EXCLUDED.code_last4,
    status = 'pending',
    credits_per_second = EXCLUDED.credits_per_second,
    redeemed_at = NULL,
    created_by = EXCLUDED.created_by,
    revoked_at = NULL,
    revoked_by = NULL,
    admin_reason = EXCLUDED.admin_reason,
    updated_at = now()
  RETURNING * INTO v_after;

  INSERT INTO public.admin_audit_log (
    actor_user_id, target_user_id, action, entity_type, entity_id,
    reason, before_state, after_state
  ) VALUES (
    p_admin_id, p_user_id,
    CASE WHEN v_before.id IS NULL THEN 'pro_license.create' ELSE 'pro_license.regenerate' END,
    'pro_license', v_after.id, btrim(p_reason),
    CASE WHEN v_before.id IS NULL THEN NULL ELSE to_jsonb(v_before) - 'code_hash' END,
    to_jsonb(v_after) - 'code_hash'
  );

  RETURN jsonb_build_object(
    'id', v_after.id,
    'userId', v_after.user_id,
    'status', v_after.status,
    'creditsPerSecond', v_after.credits_per_second,
    'codeLast4', v_after.code_last4
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_manage_pro_license(
  p_admin_id uuid,
  p_license_id uuid,
  p_action text,
  p_credits_per_second integer,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_before public.pro_licenses%ROWTYPE;
  v_after public.pro_licenses%ROWTYPE;
BEGIN
  IF NOT public.is_admin_user_id(p_admin_id) THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF char_length(btrim(COALESCE(p_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'Audit reason is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_before
  FROM public.pro_licenses
  WHERE id = p_license_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRO license not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_action = 'set_rate' THEN
    IF p_credits_per_second <= 0 OR p_credits_per_second > 100000 THEN
      RAISE EXCEPTION 'Invalid PRO credit rate' USING ERRCODE = '22023';
    END IF;
    UPDATE public.pro_licenses
    SET credits_per_second = p_credits_per_second,
        admin_reason = btrim(p_reason),
        updated_at = now()
    WHERE id = p_license_id
    RETURNING * INTO v_after;
  ELSIF p_action = 'revoke' THEN
    UPDATE public.pro_licenses
    SET status = 'revoked', revoked_at = now(), revoked_by = p_admin_id,
        admin_reason = btrim(p_reason), updated_at = now()
    WHERE id = p_license_id
    RETURNING * INTO v_after;
  ELSIF p_action = 'reactivate' THEN
    UPDATE public.pro_licenses
    SET status = 'active', revoked_at = NULL, revoked_by = NULL,
        admin_reason = btrim(p_reason), updated_at = now()
    WHERE id = p_license_id
    RETURNING * INTO v_after;
  ELSE
    RAISE EXCEPTION 'Unsupported license action' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.admin_audit_log (
    actor_user_id, target_user_id, action, entity_type, entity_id,
    reason, before_state, after_state
  ) VALUES (
    p_admin_id, v_after.user_id, 'pro_license.' || p_action,
    'pro_license', v_after.id, btrim(p_reason),
    to_jsonb(v_before) - 'code_hash', to_jsonb(v_after) - 'code_hash'
  );

  RETURN jsonb_build_object(
    'id', v_after.id,
    'userId', v_after.user_id,
    'status', v_after.status,
    'creditsPerSecond', v_after.credits_per_second,
    'codeLast4', v_after.code_last4
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.redeem_pro_license(
  p_user_id uuid,
  p_code_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_license public.pro_licenses%ROWTYPE;
BEGIN
  SELECT * INTO v_license
  FROM public.pro_licenses
  WHERE user_id = p_user_id AND code_hash = p_code_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'License code is invalid or assigned to another account'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_license.status = 'revoked' THEN
    RAISE EXCEPTION 'This PRO license has been revoked' USING ERRCODE = 'P0001';
  END IF;

  IF v_license.status = 'pending' THEN
    UPDATE public.pro_licenses
    SET status = 'active', redeemed_at = now(), updated_at = now()
    WHERE id = v_license.id
    RETURNING * INTO v_license;
  END IF;

  RETURN jsonb_build_object(
    'active', true,
    'licenseId', v_license.id,
    'creditsPerSecond', v_license.credits_per_second,
    'redeemedAt', v_license.redeemed_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_adjust_wallet_credits(
  p_admin_id uuid,
  p_user_id uuid,
  p_change integer,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_wallet public.wallets%ROWTYPE;
  v_before integer;
  v_after integer;
  v_transaction_id uuid;
BEGIN
  IF NOT public.is_admin_user_id(p_admin_id) THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF p_change = 0 THEN
    RAISE EXCEPTION 'Credit adjustment cannot be zero' USING ERRCODE = '22023';
  END IF;
  IF char_length(btrim(COALESCE(p_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'Audit reason is required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.wallets (user_id, credits)
  VALUES (p_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_wallet
  FROM public.wallets
  WHERE user_id = p_user_id
  FOR UPDATE;

  v_before := v_wallet.credits;
  v_after := v_before + p_change;
  IF v_after < 0 THEN
    RAISE EXCEPTION 'Credit adjustment would make the wallet negative'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.wallets SET credits = v_after WHERE id = v_wallet.id;

  INSERT INTO public.transactions (
    user_id, wallet_id, amount, credits, type, status, provider,
    description, metadata
  ) VALUES (
    p_user_id, v_wallet.id, 0, abs(p_change),
    CASE WHEN p_change > 0 THEN 'credit' ELSE 'debit' END,
    'success', 'admin', 'Admin credit adjustment',
    jsonb_build_object('reason', btrim(p_reason), 'admin_id', p_admin_id, 'change', p_change)
  ) RETURNING id INTO v_transaction_id;

  INSERT INTO public.admin_audit_log (
    actor_user_id, target_user_id, action, entity_type, entity_id,
    reason, before_state, after_state
  ) VALUES (
    p_admin_id, p_user_id, 'wallet.adjust', 'transaction', v_transaction_id,
    btrim(p_reason), jsonb_build_object('credits', v_before),
    jsonb_build_object('credits', v_after, 'change', p_change)
  );

  RETURN jsonb_build_object(
    'userId', p_user_id,
    'beforeCredits', v_before,
    'change', p_change,
    'credits', v_after,
    'transactionId', v_transaction_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_pro_license(uuid, uuid, text, text, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_manage_pro_license(uuid, uuid, text, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.redeem_pro_license(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_adjust_wallet_credits(uuid, uuid, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_pro_license(uuid, uuid, text, text, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_manage_pro_license(uuid, uuid, text, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.redeem_pro_license(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_adjust_wallet_credits(uuid, uuid, integer, text) TO service_role;

CREATE OR REPLACE FUNCTION public.activate_billed_session(
  p_user_id uuid,
  p_session_id uuid,
  p_provider_session_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_session public.sessions%ROWTYPE;
  v_wallet public.wallets%ROWTYPE;
  v_started_at timestamptz;
BEGIN
  SELECT * INTO v_session
  FROM public.sessions
  WHERE id = p_session_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_session.status <> 'active' THEN
    RAISE EXCEPTION 'Session is not active' USING ERRCODE = 'P0001';
  END IF;
  IF v_session.provider = 'fal' AND NOT EXISTS (
    SELECT 1 FROM public.pro_licenses
    WHERE id = v_session.pro_license_id
      AND user_id = p_user_id
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'An active PRO license is required' USING ERRCODE = 'P0001';
  END IF;
  IF v_session.provider_session_id IS NOT NULL
     AND p_provider_session_id IS NOT NULL
     AND v_session.provider_session_id <> p_provider_session_id THEN
    RAISE EXCEPTION 'Provider session ID does not match the existing activation'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_wallet
  FROM public.wallets
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND OR (
    v_session.billable_started_at IS NULL
    AND v_wallet.credits < GREATEST(v_session.credits_per_second, 1)
  ) THEN
    RAISE EXCEPTION 'Insufficient credits' USING ERRCODE = 'P0001';
  END IF;

  v_started_at := COALESCE(v_session.billable_started_at, clock_timestamp());
  UPDATE public.sessions
  SET billable_started_at = v_started_at,
      last_heartbeat_at = COALESCE(last_heartbeat_at, v_started_at),
      provider_session_id = COALESCE(provider_session_id, NULLIF(p_provider_session_id, '')),
      metadata = CASE
        WHEN v_session.billable_started_at IS NOT NULL THEN COALESCE(metadata, '{}'::jsonb)
        ELSE COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
          'provider_output_usable_at', v_started_at
        )
      END
  WHERE id = p_session_id;

  RETURN jsonb_build_object(
    'sessionId', p_session_id,
    'billableStartedAt', v_started_at,
    'credits', v_wallet.credits,
    'creditsPerSecond', v_session.credits_per_second
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_stale_billed_sessions(
  p_stale_after_seconds integer DEFAULT 15
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_session record;
  v_count integer := 0;
BEGIN
  IF p_stale_after_seconds < 5 OR p_stale_after_seconds > 3600 THEN
    RAISE EXCEPTION 'Invalid stale-session threshold' USING ERRCODE = '22023';
  END IF;

  FOR v_session IN
    SELECT id, user_id
    FROM public.sessions
    WHERE status = 'active'
      AND billable_started_at IS NOT NULL
      AND COALESCE(last_heartbeat_at, billable_started_at)
          < clock_timestamp() - make_interval(secs => p_stale_after_seconds)
    FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM public.finish_billed_session(v_session.user_id, v_session.id, 'stale_reconciled');
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_billed_session(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_stale_billed_sessions(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_billed_session(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_stale_billed_sessions(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_decide_payment(
  p_admin_id uuid,
  p_source text,
  p_payment_id uuid,
  p_status text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_before jsonb;
  v_after jsonb;
  v_user_id uuid;
  v_credits integer;
  v_provider_status text;
BEGIN
  IF NOT public.is_admin_user_id(p_admin_id) THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'Payment status must be completed or failed' USING ERRCODE = '22023';
  END IF;
  IF char_length(btrim(COALESCE(p_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'Audit reason is required' USING ERRCODE = '22023';
  END IF;

  IF p_source = 'crypto' THEN
    SELECT to_jsonb(payment), payment.user_id, payment.credits, payment.provider_status
    INTO v_before, v_user_id, v_credits, v_provider_status
    FROM public.crypto_payments payment
    WHERE payment.id = p_payment_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Payment not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_before->>'status' <> 'pending' THEN
      RAISE EXCEPTION 'Payment has already been processed' USING ERRCODE = 'P0001';
    END IF;
    IF p_status = 'completed' AND v_provider_status IS DISTINCT FROM 'SUCCESSFUL' THEN
      RAISE EXCEPTION 'Fapshi has not marked this payment as successful' USING ERRCODE = 'P0001';
    END IF;
    IF p_status = 'completed' THEN
      PERFORM public.add_to_wallet(v_user_id, v_credits::numeric, p_payment_id::text);
    END IF;
    UPDATE public.crypto_payments
    SET status = p_status, confirmed_at = now(), confirmed_by = p_admin_id
    WHERE id = p_payment_id
    RETURNING to_jsonb(crypto_payments) INTO v_after;
  ELSIF p_source = 'website' THEN
    SELECT to_jsonb(tx), tx.user_id,
      COALESCE(NULLIF(tx.credits, 0), NULLIF(tx.metadata->>'credits', '')::integer)
    INTO v_before, v_user_id, v_credits
    FROM public.transactions tx
    WHERE tx.id = p_payment_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Website transaction not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_before->>'status' <> 'pending' THEN
      RAISE EXCEPTION 'Transaction has already been processed' USING ERRCODE = 'P0001';
    END IF;
    IF p_status = 'completed' THEN
      IF v_credits IS NULL OR v_credits <= 0 THEN
        RAISE EXCEPTION 'Transaction does not contain valid credits' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.wallets (user_id, credits)
      VALUES (v_user_id, v_credits)
      ON CONFLICT (user_id) DO UPDATE
      SET credits = public.wallets.credits + EXCLUDED.credits, updated_at = now();
    END IF;
    UPDATE public.transactions
    SET status = CASE WHEN p_status = 'completed' THEN 'success' ELSE 'failed' END,
        description = COALESCE(description, 'Website credit purchase')
    WHERE id = p_payment_id
    RETURNING to_jsonb(transactions) INTO v_after;
  ELSE
    RAISE EXCEPTION 'Unsupported payment source' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.admin_audit_log (
    actor_user_id, target_user_id, action, entity_type, entity_id,
    reason, before_state, after_state
  ) VALUES (
    p_admin_id, v_user_id, 'payment.' || p_status, 'payment', p_payment_id,
    btrim(p_reason), v_before, v_after
  );

  RETURN jsonb_build_object('id', p_payment_id, 'source', p_source, 'status', p_status);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_decide_payment(uuid, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_decide_payment(uuid, text, uuid, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
