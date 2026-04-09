-- Incremental migration to move legacy balance-based billing to credits.
-- Legacy balance values are treated as existing credits during backfill.

ALTER TABLE public.wallets
  ADD COLUMN IF NOT EXISTS credits INTEGER DEFAULT 0;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'wallets'
      AND column_name = 'balance'
  ) THEN
    EXECUTE '
      UPDATE public.wallets
      SET credits = GREATEST(
        COALESCE(credits, 0),
        FLOOR(COALESCE(balance, 0))
      )::INTEGER
    ';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'wallets_credits_non_negative'
  ) THEN
    ALTER TABLE public.wallets
      ADD CONSTRAINT wallets_credits_non_negative CHECK (credits >= 0);
  END IF;
END $$;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS credits INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS credits_used INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credits_per_second INTEGER DEFAULT 2;

UPDATE public.sessions
SET credits_used = COALESCE(credits_used, FLOOR(COALESCE(cost, 0)))::INTEGER
WHERE cost IS NOT NULL;
