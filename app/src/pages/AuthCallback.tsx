import { useEffect, useState } from 'react';
import { CheckCircle, Loader2, XCircle } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { TextureButton } from '@/components/ui/texture-button';
import { ROUTES } from '@/lib/routes';
import { supabase } from '@/lib/supabase';

type CallbackState = 'loading' | 'success' | 'error';

function AuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const code = searchParams.get('code');
  const providerError = searchParams.get('error_description') || searchParams.get('error');
  const invalidMessage = providerError || (!code ? 'This confirmation link is invalid or has expired.' : '');
  const [state, setState] = useState<CallbackState>(invalidMessage ? 'error' : 'loading');
  const [message, setMessage] = useState(invalidMessage || 'Confirming your email...');

  useEffect(() => {
    if (!code || providerError) return;

    let active = true;
    void supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
      if (!active) return;
      if (error) {
        setState('error');
        setMessage(error.message);
        return;
      }

      setState('success');
      setMessage('Your email is confirmed. Henshin is ready.');
      window.setTimeout(() => navigate(ROUTES.DEFAULT, { replace: true }), 800);
    });

    return () => {
      active = false;
    };
  }, [code, navigate, providerError]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <section className="w-full max-w-md rounded-2xl border border-blue-500/20 bg-panel p-8 text-center shadow-2xl">
        {state === 'loading' && <Loader2 className="mx-auto size-12 animate-spin text-blue-400" />}
        {state === 'success' && <CheckCircle className="mx-auto size-12 text-blue-400" />}
        {state === 'error' && <XCircle className="mx-auto size-12 text-red-400" />}
        <h1 className="mt-5 text-2xl font-semibold text-foreground">Email confirmation</h1>
        <p className="mt-3 text-sm text-muted-foreground">{message}</p>
        {state === 'error' && (
          <TextureButton className="mt-6 w-full" size="lg" onClick={() => navigate(ROUTES.PUBLIC.LOGIN)}>
            Return to sign in
          </TextureButton>
        )}
      </section>
    </main>
  );
}

export default AuthCallback;
