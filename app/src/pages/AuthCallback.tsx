import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { GOOGLE_AUTH_MESSAGE_TYPE, buildHashRouteUrl, normalizeRedirectPath } from '@/lib/auth';
import { ROUTES } from '@/lib/routes';
import { supabase } from '@/lib/supabase';
import { useLocation } from 'react-router-dom';

function AuthCallback() {
  const location = useLocation();
  const hasHandledCallbackRef = useRef(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (hasHandledCallbackRef.current) {
      return;
    }

    hasHandledCallbackRef.current = true;

    const routeParams = new URLSearchParams(location.search);
    const rootParams = new URLSearchParams(window.location.search);
    const nextPath = normalizeRedirectPath(routeParams.get('next'));
    const isPopup = routeParams.get('auth') === 'popup' && Boolean(window.opener) && !window.opener.closed;
    const oauthError = rootParams.get('error_description') || rootParams.get('error');

    const redirectTo = (path: string) => {
      window.location.replace(buildHashRouteUrl(path));
    };

    const finishPopupFlow = () => {
      if (!isPopup || !window.opener || window.opener.closed) {
        redirectTo(nextPath);
        return;
      }

      window.opener.postMessage({ type: GOOGLE_AUTH_MESSAGE_TYPE, next: nextPath }, window.location.origin);
      window.setTimeout(() => {
        window.close();
      }, 150);
    };

    const completeCallback = async () => {
      if (oauthError) {
        setErrorMessage(oauthError);
        return;
      }

      const code = rootParams.get('code');
      if (!code) {
        const { data: { session } } = await supabase.auth.getSession();

        if (session) {
          if (isPopup) {
            finishPopupFlow();
          } else {
            redirectTo(nextPath);
          }
          return;
        }

        setErrorMessage('Missing Google OAuth code in the callback URL.');
        return;
      }

      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        setErrorMessage(error.message || 'Failed to complete Google sign-in.');
        return;
      }

      if (isPopup) {
        finishPopupFlow();
        return;
      }

      redirectTo(nextPath);
    };

    void completeCallback();
  }, [location.search]);

  return (
    <div className="min-h-screen bg-[#0f0f10] flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-[#18181b] border-[#27272a]">
        <CardHeader className="pb-3">
          <CardTitle className="text-xl font-semibold text-white text-center">
            {errorMessage ? 'Sign-in failed' : 'Completing sign-in'}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center text-center gap-4">
          {errorMessage ? (
            <>
              <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center">
                <AlertCircle className="w-6 h-6 text-red-400" />
              </div>
              <p className="text-sm text-[#d4d4d8]">{errorMessage}</p>
              <Button
                type="button"
                onClick={() => window.location.replace(buildHashRouteUrl(ROUTES.PUBLIC.LOGIN))}
                className="w-full bg-[#2563eb] hover:bg-[#1d4ed8] text-white"
              >
                Return to login
              </Button>
            </>
          ) : (
            <>
              <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
              <p className="text-sm text-[#a1a1aa]">
                We&apos;re exchanging your Google session with Supabase and sending you to your dashboard.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default AuthCallback;
