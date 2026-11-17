-- Access plans. duration_minutes is kept for the legacy plans table:
-- 14 days, 30 days, and unlimited (duration_minutes 0 means no expiry).
DELETE FROM public.plans;

INSERT INTO public.plans (name, price, credits, duration_minutes, usd_price)
VALUES
  ('2 Weeks', 100, 0, 20160, 100.00),
  ('30 Days', 250, 0, 43200, 250.00),
  ('Unlimited', 500, 0, 0, 500.00);
