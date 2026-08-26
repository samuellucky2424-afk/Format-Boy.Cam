-- Atomic, idempotent session billing and session history.

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS provider_session_id text,
  ADD COLUMN IF NOT EXISTS client_session_id uuid,
  ADD COLUMN IF NOT EXISTS billable_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS end_reason text;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS session_id uuid;

UPDATE public.sessions
SET provider = CASE
  WHEN lower(COALESCE(model, '')) LIKE 'lucy%' THEN 'morphly'
  ELSE 'reactor'
END
WHERE provider IS NULL;

UPDATE public.sessions
SET credits_per_second = 2
WHERE credits_per_second IS NULL OR credits_per_second <= 0;

UPDATE public.sessions
SET billable_started_at = (metadata->>'realtime_credential_issued_at')::timestamptz
WHERE billable_started_at IS NULL
  AND metadata ? 'realtime_credential_issued_at'
  AND pg_input_is_valid(metadata->>'realtime_credential_issued_at', 'timestamptz');

UPDATE public.sessions
SET last_heartbeat_at = (metadata->>'last_heartbeat')::timestamptz
WHERE last_heartbeat_at IS NULL
  AND metadata ? 'last_heartbeat'
  AND pg_input_is_valid(metadata->>'last_heartbeat', 'timestamptz');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sessions_provider_check'
      AND conrelid = 'public.sessions'::regclass
  ) THEN
    ALTER TABLE public.sessions
      ADD CONSTRAINT sessions_provider_check
      CHECK (provider IN ('reactor', 'morphly'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transactions_session_id_fkey'
      AND conrelid = 'public.transactions'::regclass
  ) THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT transactions_session_id_fkey
      FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE SET NULL;
  END IF;
END $$;

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

  IF NOT FOUND OR (v_session.billable_started_at IS NULL AND v_wallet.credits <= 0) THEN
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
          'realtime_credential_issued_at', v_started_at
        )
      END
  WHERE id = p_session_id;

  RETURN jsonb_build_object(
    'sessionId', p_session_id,
    'billableStartedAt', v_started_at,
    'credits', v_wallet.credits
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_billed_session(
  p_user_id uuid,
  p_session_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_session public.sessions%ROWTYPE;
  v_wallet public.wallets%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_billing_end timestamptz;
  v_seconds integer := 0;
  v_credits integer := 0;
BEGIN
  SELECT * INTO v_session
  FROM public.sessions
  WHERE id = p_session_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.wallets (user_id, credits)
  VALUES (p_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_wallet
  FROM public.wallets
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF v_session.status <> 'active' THEN
    RETURN jsonb_build_object(
      'sessionId', v_session.id,
      'secondsUsed', COALESCE(v_session.seconds_used, 0),
      'creditsUsed', COALESCE(v_session.credits_used, 0),
      'remainingCredits', v_wallet.credits,
      'status', v_session.status,
      'reason', v_session.end_reason
    );
  END IF;

  IF v_session.billable_started_at IS NULL THEN
    v_billing_end := v_now;
  ELSE
    v_billing_end := GREATEST(
      v_session.billable_started_at,
      LEAST(
        v_now,
        v_session.billable_started_at + interval '600 seconds',
        COALESCE(v_session.last_heartbeat_at + interval '3 seconds', v_now)
      )
    );
    v_seconds := LEAST(
      600,
      GREATEST(0, FLOOR(EXTRACT(epoch FROM (v_billing_end - v_session.billable_started_at)))::integer)
    );
    v_credits := LEAST(
      v_wallet.credits,
      v_seconds * GREATEST(COALESCE(v_session.credits_per_second, 2), 0)
    );
  END IF;

  IF v_credits > 0 THEN
    UPDATE public.wallets
    SET credits = credits - v_credits
    WHERE id = v_wallet.id;

    INSERT INTO public.transactions (
      user_id, wallet_id, session_id, amount, credits, type, status,
      provider, description, metadata
    ) VALUES (
      p_user_id, v_wallet.id, v_session.id, 0, v_credits, 'debit', 'success',
      v_session.provider, 'Session usage', jsonb_build_object(
        'seconds_used', v_seconds,
        'credits_per_second', COALESCE(v_session.credits_per_second, 2)
      )
    );
  END IF;

  UPDATE public.sessions
  SET end_time = v_billing_end,
      seconds_used = v_seconds,
      credits_used = v_credits,
      cost = v_credits,
      status = 'ended',
      end_reason = LEFT(COALESCE(NULLIF(p_reason, ''), 'unspecified'), 200)
  WHERE id = v_session.id;

  RETURN jsonb_build_object(
    'sessionId', v_session.id,
    'secondsUsed', v_seconds,
    'creditsUsed', v_credits,
    'remainingCredits', v_wallet.credits - v_credits,
    'status', 'ended',
    'reason', LEFT(COALESCE(NULLIF(p_reason, ''), 'unspecified'), 200)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.activate_billed_session(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_billed_session(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_billed_session(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_billed_session(uuid, uuid, text) TO service_role;

-- Close only older duplicates before enforcing one active session per user.
DO $$
DECLARE
  v_duplicate record;
BEGIN
  FOR v_duplicate IN
    SELECT id, user_id
    FROM (
      SELECT id, user_id,
             row_number() OVER (PARTITION BY user_id ORDER BY start_time DESC, created_at DESC, id DESC) AS position
      FROM public.sessions
      WHERE status = 'active'
    ) ranked
    WHERE position > 1
  LOOP
    PERFORM public.finish_billed_session(
      v_duplicate.user_id,
      v_duplicate.id,
      'migration_duplicate_reconcile'
    );
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS sessions_one_active_per_user_idx
  ON public.sessions (user_id)
  WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS sessions_user_client_session_idx
  ON public.sessions (user_id, client_session_id)
  WHERE client_session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS sessions_provider_session_id_unique_idx
  ON public.sessions (provider_session_id)
  WHERE provider_session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS transactions_one_successful_debit_per_session_idx
  ON public.transactions (session_id)
  WHERE session_id IS NOT NULL AND type = 'debit' AND status = 'success';

CREATE INDEX IF NOT EXISTS transactions_session_id_idx
  ON public.transactions (session_id);

CREATE INDEX IF NOT EXISTS sessions_user_start_time_idx
  ON public.sessions (user_id, start_time DESC);
