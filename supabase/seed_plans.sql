-- Clean up all existing plans first to prevent duplicates
DELETE FROM public.plans;

-- Seed the plans table with Henshin credit packs
INSERT INTO public.plans (name, price, credits, duration_minutes, usd_price)
VALUES
  ('Starter', 8000, 9400, 78, 14.00),
  ('Basic', 14000, 21800, 181, 24.50),
  ('Pro', 25000, 44400, 370, 43.75),
  ('Enterprise', 140000, 281200, 2343, 245.00);
