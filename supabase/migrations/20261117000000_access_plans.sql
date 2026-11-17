-- Replace credit packs with three access plans:
--   $100 / 14 days, $250 / 30 days, $500 unlimited (no expiry).

ALTER TABLE public.credit_packages
  ADD COLUMN IF NOT EXISTS plan_code text,
  ADD COLUMN IF NOT EXISTS duration_days integer;

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USD';

ALTER TABLE public.credit_packages
  DROP CONSTRAINT IF EXISTS credit_packages_credits_check;

ALTER TABLE public.crypto_payments
  DROP CONSTRAINT IF EXISTS crypto_payments_credits_check;

ALTER TABLE public.credit_packages
  DROP CONSTRAINT IF EXISTS credit_packages_plan_code_key;

ALTER TABLE public.credit_packages
  ADD CONSTRAINT credit_packages_plan_code_key UNIQUE (plan_code);

UPDATE public.credit_packages
SET is_active = false
WHERE plan_code IS NULL
   OR plan_code NOT IN ('two_weeks', 'thirty_days', 'unlimited');

INSERT INTO public.credit_packages (
  name, credits, price_ngn, price_usd, is_active, sort_order, plan_code, duration_days
) VALUES
  ('2 Weeks', 0, 0, 100, true, 1, 'two_weeks', 14),
  ('30 Days', 0, 0, 250, true, 2, 'thirty_days', 30),
  ('Unlimited', 0, 0, 500, true, 3, 'unlimited', NULL)
ON CONFLICT (plan_code) DO UPDATE
SET name = EXCLUDED.name,
    credits = EXCLUDED.credits,
    price_ngn = EXCLUDED.price_ngn,
    price_usd = EXCLUDED.price_usd,
    is_active = true,
    sort_order = EXCLUDED.sort_order,
    duration_days = EXCLUDED.duration_days;

CREATE OR REPLACE FUNCTION public.grant_plan_access(
  p_user_id uuid,
  p_package_id uuid,
  p_amount numeric,
  p_currency text DEFAULT 'USD'
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_package public.credit_packages%ROWTYPE;
  v_current public.subscriptions%ROWTYPE;
  v_start timestamptz := now();
  v_end timestamptz;
BEGIN
  IF p_user_id IS NULL OR p_package_id IS NULL THEN
    RAISE EXCEPTION 'A user and package are required';
  END IF;

  SELECT * INTO v_package
  FROM public.credit_packages
  WHERE id = p_package_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan not found';
  END IF;

  SELECT * INTO v_current
  FROM public.subscriptions
  WHERE user_id = p_user_id AND status = 'active'
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_package.plan_code = 'unlimited' THEN
    v_end := NULL;
  ELSIF v_current.id IS NOT NULL
    AND v_current.plan_name = 'Unlimited'
    AND v_current.ends_at IS NULL THEN
    v_end := NULL;
  ELSE
    IF v_package.duration_days IS NULL OR v_package.duration_days <= 0 THEN
      RAISE EXCEPTION 'Plan does not grant an access period';
    END IF;
    IF v_current.id IS NOT NULL
      AND v_current.ends_at IS NOT NULL
      AND v_current.ends_at > v_start THEN
      v_start := v_current.ends_at;
    END IF;
    v_end := v_start + make_interval(days => v_package.duration_days);
  END IF;

  IF v_current.id IS NOT NULL THEN
    UPDATE public.subscriptions
    SET plan_name = CASE WHEN v_end IS NULL THEN 'Unlimited' ELSE v_package.name END,
        amount_paid = COALESCE(p_amount, 0),
        currency = COALESCE(NULLIF(p_currency, ''), 'USD'),
        credits = 0,
        status = 'active',
        ends_at = v_end,
        updated_at = now()
    WHERE id = v_current.id;
  ELSE
    INSERT INTO public.subscriptions (
      user_id, plan_name, amount_paid, currency, credits, status, starts_at, ends_at
    ) VALUES (
      p_user_id,
      CASE WHEN v_end IS NULL THEN 'Unlimited' ELSE v_package.name END,
      COALESCE(p_amount, 0),
      COALESCE(NULLIF(p_currency, ''), 'USD'),
      0,
      'active',
      now(),
      v_end
    );
  END IF;

  RETURN v_end;
END;
$$;

REVOKE ALL ON FUNCTION public.grant_plan_access(uuid, uuid, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grant_plan_access(uuid, uuid, numeric, text) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_confirm_payment(
  p_payment_id uuid,
  p_status text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.crypto_payments%ROWTYPE;
  v_is_admin boolean;
BEGIN
  SELECT COALESCE(is_admin, false) INTO v_is_admin FROM public.users WHERE id = auth.uid();
  IF v_is_admin IS NOT TRUE THEN
    RAISE EXCEPTION 'Only an admin can process payments';
  END IF;

  IF p_status NOT IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'Status must be completed or failed';
  END IF;

  SELECT * INTO v_payment
  FROM public.crypto_payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;

  IF v_payment.status <> 'pending' THEN
    RAISE EXCEPTION 'Payment has already been processed';
  END IF;

  IF p_status = 'completed' THEN
    IF v_payment.package_id IS NOT NULL THEN
      PERFORM public.grant_plan_access(
        v_payment.user_id,
        v_payment.package_id,
        v_payment.amount,
        v_payment.currency
      );
    ELSIF COALESCE(v_payment.credits, 0) > 0 THEN
      PERFORM public.add_to_wallet(
        v_payment.user_id,
        v_payment.credits::numeric,
        v_payment.id::text
      );
    ELSE
      RAISE EXCEPTION 'Payment is not tied to an access plan';
    END IF;
  END IF;

  UPDATE public.crypto_payments
  SET status = p_status,
      confirmed_at = now(),
      confirmed_by = auth.uid()
  WHERE id = p_payment_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_confirm_payment(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_confirm_payment(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
