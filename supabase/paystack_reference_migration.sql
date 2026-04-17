-- Incremental migration for existing Supabase projects that previously stored
-- gateway references in the legacy `tx_ref` column.
--
-- This keeps old records intact, backfills the generic `reference` column, and
-- adds an index for the Paystack verification/webhook lookups used by the API.

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS reference TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'transactions'
      AND column_name = 'tx_ref'
  ) THEN
    EXECUTE '
      UPDATE public.transactions
      SET reference = tx_ref
      WHERE tx_ref IS NOT NULL
        AND tx_ref <> ''''
        AND (reference IS NULL OR reference = '''')
    ';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_transactions_reference
  ON public.transactions(reference);
