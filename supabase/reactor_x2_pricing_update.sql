-- Reprice Henshin packs against Reactor X2's public rate on 2026-08-24.
-- Source: https://api.reactor.inc/pricing
-- X2 = 17 Reactor credits/second; 10,000 credits/USD ($6.12/hour).
-- Henshin deducts 2 wallet credits/second. Values target about $6 gross
-- margin per pack using 8,000 XAF ~= $14 for the Starter pack.

-- Accept both the legacy NGN schema and the current XAF schema so this file
-- can be applied independently of fapshi_migration.sql.
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
  ADD COLUMN IF NOT EXISTS price_xaf numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS price_usd numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

UPDATE public.credit_packages
SET
  credits = CASE lower(name)
    WHEN 'starter' THEN 9400
    WHEN 'basic' THEN 21800
    WHEN 'pro' THEN 44400
    WHEN 'enterprise' THEN 281200
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
  END
WHERE lower(name) IN ('starter', 'basic', 'pro', 'enterprise');

-- Preserve a predictable card order after the credit amounts change.
UPDATE public.credit_packages
SET sort_order = CASE lower(name)
  WHEN 'starter' THEN 0
  WHEN 'basic' THEN 1
  WHEN 'pro' THEN 2
  WHEN 'enterprise' THEN 3
  ELSE sort_order
END
WHERE lower(name) IN ('starter', 'basic', 'pro', 'enterprise');
