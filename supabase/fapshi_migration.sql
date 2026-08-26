-- Fapshi migration: switch all payments to the Fapshi gateway (XAF).
-- Run in the Supabase SQL Editor before deploying the Fapshi code. The
-- schema changes are safe to re-run.

-- 1. Prices are now expressed in XAF (FCFA) instead of NGN.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'credit_packages'
      AND column_name = 'price_ngn'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'credit_packages'
      AND column_name = 'price_xaf'
  ) THEN
    ALTER TABLE public.credit_packages RENAME COLUMN price_ngn TO price_xaf;
  END IF;
END $$;

ALTER TABLE public.credit_packages
  ADD COLUMN IF NOT EXISTS price_xaf NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS price_usd NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- X2 public rate checked against https://api.reactor.inc/pricing:
-- 17 Reactor credits/s, 10,000 credits/USD ($6.12/hour).
-- Henshin bills 2 wallet credits/s. Each pack below keeps about $6 gross
-- margin using the Starter conversion supplied for 8,000 XAF (~$14).
UPDATE public.credit_packages
SET
  credits = CASE lower(name)
    WHEN 'starter' THEN 9400       -- 78m20s, about $7.99 Reactor cost
    WHEN 'basic' THEN 21800        -- 181m40s, about $18.53 Reactor cost
    WHEN 'pro' THEN 44400          -- 370m, about $37.74 Reactor cost
    WHEN 'enterprise' THEN 281200  -- 39h03m20s, about $239.02 Reactor cost
    ELSE credits
  END,
  price_xaf = CASE lower(name)
    WHEN 'starter' THEN 8000
    WHEN 'basic' THEN 14000
    WHEN 'pro' THEN 25000
    WHEN 'enterprise' THEN 140000
    ELSE price_xaf
  END,
  price_usd = CASE lower(name)
    WHEN 'starter' THEN 14.00
    WHEN 'basic' THEN 24.50
    WHEN 'pro' THEN 43.75
    WHEN 'enterprise' THEN 245.00
    ELSE price_usd
  END;

-- 2. crypto_payments is reused as the generic payments table.
--    reference       = Fapshi transId returned by initiate-pay
--    provider_status = raw status reported by Fapshi (CREATED/PENDING/
--    SUCCESSFUL/FAILED/EXPIRED); `status` stays the admin-driven state.
ALTER TABLE public.crypto_payments
  ADD COLUMN IF NOT EXISTS reference TEXT,
  ADD COLUMN IF NOT EXISTS provider_status TEXT;

CREATE INDEX IF NOT EXISTS idx_crypto_payments_reference
  ON public.crypto_payments (reference);

-- 3. Retire the legacy manual crypto methods when that legacy table exists.
DO $$
BEGIN
  IF to_regclass('public.payment_methods') IS NOT NULL THEN
    UPDATE public.payment_methods SET is_active = false;
  END IF;
END $$;
