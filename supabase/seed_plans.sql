-- Seed the plans table with Format-Boy Cam credit packs
INSERT INTO public.plans (name, price, credits, duration_minutes)
VALUES
  ('Starter', 8000, 500, 4),
  ('Standard', 20000, 1000, 8),
  ('Pro', 40000, 2000, 16)
ON CONFLICT (name) DO UPDATE SET
  price = EXCLUDED.price,
  credits = EXCLUDED.credits,
  duration_minutes = EXCLUDED.duration_minutes;
