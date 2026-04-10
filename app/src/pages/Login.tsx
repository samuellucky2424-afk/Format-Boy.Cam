import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Loader2, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/context/AuthContext';
import { GOOGLE_AUTH_MESSAGE_TYPE, normalizeRedirectPath } from '@/lib/auth';
import { ROUTES } from '@/lib/routes';
import { toast } from 'sonner';

function Login() {
  const { login, register, signInWithGoogle, loading, error, clearError } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const isLogin = location.pathname !== ROUTES.PUBLIC.SIGNUP;
  const authRedirectPath = normalizeRedirectPath(
    (location.state as { from?: { pathname?: string } } | null)?.from?.pathname || ROUTES.DEFAULT
  );
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (error) {
      toast.error(error);
      clearError();
    }
  }, [error, clearError]);

  useEffect(() => {
    clearError();
  }, [clearError, isLogin]);

  useEffect(() => {
    const handleGoogleAuthComplete = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) {
        return;
      }

      if (event.data?.type !== GOOGLE_AUTH_MESSAGE_TYPE) {
        return;
      }

      toast.success('Google sign-in complete');
      const nextPath = normalizeRedirectPath(
        typeof event.data?.next === 'string' ? event.data.next : authRedirectPath
      );
      navigate(nextPath, { replace: true });
    };

    window.addEventListener('message', handleGoogleAuthComplete);
    return () => window.removeEventListener('message', handleGoogleAuthComplete);
  }, [authRedirectPath, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      if (isLogin) {
        await login(email, password);
        toast.success('Welcome back!');
      } else {
        await register(email, name, password);
        toast.success('Account created successfully!');
      }
    } catch (_err) {
      // Error is handled by the auth context and shown via toast
    }
  };

  const handleGoogleAuth = async () => {
    clearError();

    try {
      await signInWithGoogle(authRedirectPath);
    } catch (_err) {
      // Error is handled by the auth context and shown via toast
    }
  };

  const toggleMode = () => {
    clearError();
    navigate(isLogin ? ROUTES.PUBLIC.SIGNUP : ROUTES.PUBLIC.LOGIN);
  };

  return (
    <div className="min-h-screen bg-[#0f0f10] flex items-center justify-center p-4">
      <div className="w-full max-w-[400px]">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-lg bg-[#1a1a1b] flex items-center justify-center overflow-hidden">
            <img src="./logo.png" alt="Logo" className="w-full h-full object-cover" />
          </div>
          <span className="text-xl font-semibold text-white tracking-tight">Format-Boy.CAM</span>
        </div>

        <Card className="bg-[#18181b] border-[#27272a]">
          <CardHeader className="pb-6">
            <CardTitle className="text-xl font-semibold text-white text-center">
              {isLogin ? 'Sign in to your account' : 'Create your account'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Button
              type="button"
              onClick={handleGoogleAuth}
              disabled={loading}
              variant="outline"
              className="w-full h-11 border-[#3f3f46] bg-[#202024] text-white hover:bg-[#27272a] hover:text-white"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Please wait...
                </span>
              ) : (
                <span className="flex items-center gap-3">
                  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="#EA4335" d="M12 10.2v3.9h5.4c-.2 1.3-.8 2.4-1.8 3.2l2.9 2.3c1.7-1.5 2.7-3.9 2.7-6.6 0-.6-.1-1.2-.2-1.8H12z" />
                    <path fill="#34A853" d="M12 21c2.4 0 4.5-.8 6-2.1l-2.9-2.3c-.8.5-1.9.9-3.1.9-2.4 0-4.5-1.6-5.2-3.8l-3 .2v2.4C5.3 19 8.4 21 12 21z" />
                    <path fill="#4A90E2" d="M6.8 13.7c-.2-.5-.3-1.1-.3-1.7s.1-1.2.3-1.7V7.9h-3C3.3 9.1 3 10.5 3 12s.3 2.9.8 4.1l3-.2v-2.2z" />
                    <path fill="#FBBC05" d="M12 6.5c1.3 0 2.5.5 3.4 1.3l2.6-2.6C16.5 3.8 14.4 3 12 3 8.4 3 5.3 5 3.8 7.9l3 2.4c.7-2.2 2.8-3.8 5.2-3.8z" />
                  </svg>
                  Continue with Google
                </span>
              )}
            </Button>

            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-[#27272a]" />
              </div>
              <div className="relative flex justify-center text-[11px] uppercase tracking-[0.16em]">
                <span className="bg-[#18181b] px-3 text-[#71717a]">Or continue with email</span>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {!isLogin && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-[#a1a1aa]">Full Name</label>
                  <Input
                    type="text"
                    placeholder="Jane Doe"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="h-11 bg-[#27272a] border-[#3f3f46] text-white placeholder:text-[#71717a]"
                    disabled={loading}
                    required={!isLogin}
                  />
                </div>
              )}
              <div className="space-y-2">
                <label className="text-sm font-medium text-[#a1a1aa]">Email</label>
                <Input
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11 bg-[#27272a] border-[#3f3f46] text-white placeholder:text-[#71717a]"
                  disabled={loading}
                  required
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-[#a1a1aa]">Password</label>
                  {isLogin && (
                    <button 
                      type="button" 
                      className="text-sm text-[#2563eb] hover:text-[#3b82f6]"
                      onClick={() => toast.info('Password reset coming soon')}
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-11 bg-[#27272a] border-[#3f3f46] text-white placeholder:text-[#71717a] pr-10"
                    disabled={loading}
                    required
                    minLength={6}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#71717a] hover:text-white transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <Button
                type="submit"
                disabled={loading}
                className="w-full h-11 bg-[#2563eb] hover:bg-[#1d4ed8] text-white font-medium disabled:opacity-50"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Please wait...
                  </span>
                ) : (
                  isLogin ? 'Sign In' : 'Create Account'
                )}
              </Button>
            </form>

            <div className="mt-6 text-center">
              <span className="text-sm text-[#71717a]">
                {isLogin ? "Don't have an account? " : 'Already have an account? '}
                <button
                  type="button"
                  onClick={toggleMode}
                  className="text-[#2563eb] hover:text-[#3b82f6] font-medium"
                  disabled={loading}
                >
                  {isLogin ? 'Create account' : 'Sign in'}
                </button>
              </span>
            </div>
            <div className="mt-4 text-center">
              <Link 
                to="/subscription" 
                className="text-sm text-[#71717a] hover:text-white transition-colors"
              >
                View pricing plans
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default Login;
