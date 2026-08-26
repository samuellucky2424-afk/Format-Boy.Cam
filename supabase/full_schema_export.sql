-- Henshin - Complete Schema for New Supabase Project

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- USERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  is_premium BOOLEAN DEFAULT FALSE,
  is_admin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Compatibility view for website clients that query admin_users.user_id.
CREATE OR REPLACE VIEW public.admin_users
WITH (security_invoker = true)
AS SELECT id AS user_id, email, created_at
FROM public.users
WHERE is_admin = TRUE;

-- ============================================
-- CREDITS TABLE (Wallets)
-- ============================================
CREATE TABLE IF NOT EXISTS public.wallets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  credits INTEGER DEFAULT 0 CHECK (credits >= 0),
  balance NUMERIC(14, 2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'NGN',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id)
);

-- ============================================
-- TRANSACTIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  wallet_id UUID REFERENCES public.wallets(id) ON DELETE SET NULL,
  amount NUMERIC(12, 2) DEFAULT 0,
  credits INTEGER DEFAULT 0 CHECK (credits >= 0),
  type TEXT NOT NULL CHECK (type IN ('credit', 'debit')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'refunded')),
  reference TEXT,
  provider TEXT,
  description TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- SESSIONS TABLE (AI Streaming Sessions)
-- ============================================
CREATE TABLE IF NOT EXISTS public.sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  wallet_id UUID REFERENCES public.wallets(id) ON DELETE SET NULL,
  title TEXT,
  start_time TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  end_time TIMESTAMP WITH TIME ZONE,
  seconds_used INTEGER DEFAULT 0,
  credits_per_second INTEGER DEFAULT 2,
  credits_used INTEGER DEFAULT 0,
  cost NUMERIC(12, 2) DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'ended', 'interrupted')),
  model TEXT DEFAULT 'henshin-v1',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- CREDIT PACKAGES TABLE (Replacing legacy plans)
-- ============================================
CREATE TABLE IF NOT EXISTS public.credit_packages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT,
  credits INTEGER NOT NULL,
  price_xaf NUMERIC NOT NULL,
  price_usd NUMERIC DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- CRYPTO PAYMENTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  plan_id UUID,
  plan_name TEXT NOT NULL,
  amount_paid NUMERIC(12, 2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'NGN',
  credits INTEGER NOT NULL DEFAULT 0,
  credits_used INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  starts_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMP WITH TIME ZONE,
  auto_renew BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.crypto_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  package_id UUID REFERENCES public.credit_packages(id) ON DELETE SET NULL,
  amount NUMERIC NOT NULL, 
  currency TEXT NOT NULL DEFAULT 'USD', 
  credits INTEGER NOT NULL, 
  crypto_currency TEXT NOT NULL DEFAULT 'USDT',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  reference TEXT,
  provider_status TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  confirmed_at TIMESTAMP WITH TIME ZONE,
  confirmed_by UUID REFERENCES public.users(id) ON DELETE SET NULL
);

-- ============================================
-- REAL-TIME TABLES (Enable Realtime)
-- ============================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.transactions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.wallets;
ALTER PUBLICATION supabase_realtime ADD TABLE public.crypto_payments;

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON public.wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON public.transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_wallet_id ON public.transactions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON public.transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON public.transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON public.sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON public.sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_start_time ON public.sessions(start_time DESC);
CREATE INDEX IF NOT EXISTS idx_crypto_payments_reference ON public.crypto_payments(reference);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crypto_payments ENABLE ROW LEVEL SECURITY;

-- USERS POLICIES
CREATE POLICY "Users can view own profile" ON public.users FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.users FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Admins can view all users" ON public.users FOR SELECT USING ((SELECT is_admin FROM public.users WHERE id = auth.uid()) = TRUE);

-- CREDITS (WALLETS) POLICIES
CREATE POLICY "Users can view own credits" ON public.wallets FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all wallets" ON public.wallets FOR SELECT USING ((SELECT is_admin FROM public.users WHERE id = auth.uid()) = TRUE);

-- TRANSACTIONS POLICIES
CREATE POLICY "Users can view own transactions" ON public.transactions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all transactions" ON public.transactions FOR SELECT USING ((SELECT is_admin FROM public.users WHERE id = auth.uid()) = TRUE);

-- SESSIONS POLICIES
CREATE POLICY "Users can view own sessions" ON public.sessions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own sessions" ON public.sessions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own sessions" ON public.sessions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all sessions" ON public.sessions FOR SELECT USING ((SELECT is_admin FROM public.users WHERE id = auth.uid()) = TRUE);

-- CREDIT PACKAGES POLICIES
CREATE POLICY "Anyone can view active credit_packages" ON public.credit_packages FOR SELECT USING (true);
CREATE POLICY "Admins can manage credit_packages" ON public.credit_packages FOR ALL USING ((SELECT is_admin FROM public.users WHERE id = auth.uid()) = TRUE);

-- CRYPTO PAYMENTS POLICIES
CREATE POLICY "Users can insert their own payments" ON public.crypto_payments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can view their own payments" ON public.crypto_payments FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all payments" ON public.crypto_payments FOR SELECT USING ((SELECT is_admin FROM public.users WHERE id = auth.uid()) = TRUE);
CREATE POLICY "Admins can update payments" ON public.crypto_payments FOR UPDATE USING ((SELECT is_admin FROM public.users WHERE id = auth.uid()) = TRUE);

-- ============================================
-- FUNCTIONS & TRIGGERS
-- ============================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER update_wallets_updated_at BEFORE UPDATE ON public.wallets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Auto-create user profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO NOTHING;
  
  INSERT INTO public.wallets (user_id, credits)
  VALUES (NEW.id, 0)
  ON CONFLICT (user_id) DO NOTHING;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Function to deduct credits from the credit ledger
CREATE OR REPLACE FUNCTION public.deduct_from_wallet(p_user_id UUID, p_amount NUMERIC)
RETURNS BOOLEAN AS $$
DECLARE
  v_current_credits INTEGER;
BEGIN
  SELECT credits INTO v_current_credits FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;

  IF v_current_credits IS NULL OR v_current_credits < p_amount THEN
    RETURN FALSE;
  END IF;

  UPDATE public.wallets SET credits = credits - p_amount WHERE user_id = p_user_id;

  INSERT INTO public.transactions (user_id, wallet_id, amount, type, status, description)
  VALUES (
    p_user_id,
    (SELECT id FROM public.wallets WHERE user_id = p_user_id),
    -p_amount,
    'debit',
    'success',
    'Stream credit deduction'
  );

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to add credits to the credit ledger
CREATE OR REPLACE FUNCTION public.add_to_wallet(p_user_id UUID, p_amount NUMERIC, p_reference TEXT DEFAULT NULL)
RETURNS BOOLEAN AS $$
DECLARE
  v_wallet_id UUID;
BEGIN
  SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = p_user_id;

  IF v_wallet_id IS NULL THEN
    RETURN FALSE;
  END IF;

  UPDATE public.wallets SET credits = credits + p_amount WHERE user_id = p_user_id;

  INSERT INTO public.transactions (user_id, wallet_id, amount, type, status, reference, description)
  VALUES (
    p_user_id,
    v_wallet_id,
    p_amount,
    'credit',
    'success',
    p_reference,
    'Credit top-up'
  );

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Admin Function to confirm payment and add credits
CREATE OR REPLACE FUNCTION public.admin_confirm_payment(p_payment_id UUID, p_status TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  v_payment RECORD;
  v_is_admin BOOLEAN;
BEGIN
  -- Verify admin
  SELECT is_admin INTO v_is_admin FROM public.users WHERE id = auth.uid();
  IF v_is_admin IS NOT TRUE THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Get payment
  SELECT * INTO v_payment FROM public.crypto_payments WHERE id = p_payment_id FOR UPDATE;
  
  IF v_payment.id IS NULL THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;

  IF v_payment.status != 'pending' THEN
    RAISE EXCEPTION 'Payment already processed';
  END IF;

  IF p_status = 'completed' THEN
    -- Add credits using existing function
    PERFORM public.add_to_wallet(v_payment.user_id, v_payment.credits::numeric, p_payment_id::text);
    
    UPDATE public.crypto_payments
    SET status = 'completed', confirmed_at = NOW(), confirmed_by = auth.uid()
    WHERE id = p_payment_id;
  ELSIF p_status = 'failed' THEN
    UPDATE public.crypto_payments
    SET status = 'failed', confirmed_at = NOW(), confirmed_by = auth.uid()
    WHERE id = p_payment_id;
  ELSE
    RAISE EXCEPTION 'Invalid status';
  END IF;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Admin Function to add credits manually
CREATE OR REPLACE FUNCTION public.admin_add_credits(p_user_id UUID, p_amount NUMERIC)
RETURNS BOOLEAN AS $$
DECLARE
  v_is_admin BOOLEAN;
BEGIN
  -- Verify admin
  SELECT is_admin INTO v_is_admin FROM public.users WHERE id = auth.uid();
  IF v_is_admin IS NOT TRUE THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Add credits using existing function
  PERFORM public.add_to_wallet(p_user_id, p_amount, 'Admin manual addition');

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- SEED DATA: Default Packages
-- ============================================
INSERT INTO public.credit_packages (name, credits, price_xaf, price_usd) VALUES
  ('Starter', 9400, 8000, 14.00),
  ('Basic', 21800, 14000, 24.50),
  ('Pro', 44400, 25000, 43.75),
  ('Enterprise', 281200, 140000, 245.00);
