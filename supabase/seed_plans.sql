-- Seed the plans table with Morphly subscription plans
INSERT INTO public.plans (name, price, credits, duration_minutes)
VALUES
  ('Starter', 8000, 2, 2),
  ('Standard', 20000, 5, 5),
  ('Pro', 35000, 10, 10)
ON CONFLICT (name) DO UPDATE SET
  price = EXCLUDED.price,
  credits = EXCLUDED.credits,
  duration_minutes = EXCLUDED.duration_minutes;
