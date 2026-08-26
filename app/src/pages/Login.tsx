import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Loader2, Eye, EyeOff, MailCheck } from 'lucide-react';
import { CosmicButton } from '@/components/ui/cosmic-button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TextureButton } from '@/components/ui/texture-button';
import { useAuth } from '@/context/AuthContext';
import { ROUTES } from '@/lib/routes';
import { toast } from 'sonner';

function Login() {
  const { login, loginWithGoogle, register, loading, error, clearError } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const isLogin = location.pathname !== ROUTES.PUBLIC.SIGNUP;
  const verificationEmail = (location.state as { verificationEmail?: string } | null)?.verificationEmail;
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      if (isLogin) {
        await login(email, password);
        toast.success('Welcome back!');
      } else {
        const result = await register(email, name, password);
        if (result.requiresEmailConfirmation) {
          navigate(ROUTES.PUBLIC.LOGIN, {
            replace: true,
            state: { verificationEmail: email },
          });
        } else {
          toast.success('Account created successfully!');
        }
      }
    } catch {
      // Error is handled by the auth context and shown via toast
    }
  };

  const toggleMode = () => {
    clearError();
    navigate(isLogin ? ROUTES.PUBLIC.SIGNUP : ROUTES.PUBLIC.LOGIN);
  };

  const handleGoogleLogin = async () => {
    try {
      await loginWithGoogle();
    } catch {
      // Error is handled by the auth context and shown via toast
    }
  };

  return (
    <div className="mesh-bg min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-[400px]">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-lg bg-panel flex items-center justify-center overflow-hidden">
            <img src="./logo.png" alt="Logo" className="w-full h-full object-cover" />
          </div>
          <span className="text-xl font-semibold text-foreground tracking-tight">Henshin 変身</span>
        </div>

        <Card>
          <CardHeader className="pb-6">
            <CardTitle className="text-xl font-semibold text-foreground text-center">
              {verificationEmail
                ? 'Check your email'
                : isLogin
                  ? 'Sign in to your account'
                  : 'Create your account'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {verificationEmail ? (
              <div className="text-center">
                <div className="mx-auto flex size-16 items-center justify-center rounded-2xl border border-blue-500/20 bg-blue-500/10">
                  <MailCheck className="size-8 text-blue-400" />
                </div>
                <p className="mt-5 text-sm leading-6 text-muted-foreground">
                  We sent a confirmation link to
                  <strong className="mt-1 block break-all text-foreground">{verificationEmail}</strong>
                </p>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  Open the email and click the confirmation link. Henshin will finish verifying your account,
                  then you can sign in.
                </p>
                <TextureButton
                  type="button"
                  className="mt-6 w-full"
                  contentClassName="min-h-11 justify-center"
                  onClick={() => navigate(ROUTES.PUBLIC.LOGIN, { replace: true, state: null })}
                >
                  Back to sign in
                </TextureButton>
              </div>
            ) : (
              <>
                <TextureButton
                  type="button"
                  className="mb-5 w-full"
                  contentClassName="min-h-11 justify-center gap-3"
                  disabled={loading}
                  onClick={handleGoogleLogin}
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4">
                    <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.41Z" />
                    <path fill="#34A853" d="M12 22c2.7 0 4.98-.9 6.63-2.43l-3.24-2.54c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z" />
                    <path fill="#FBBC05" d="M6.39 13.86A6.01 6.01 0 0 1 6.08 12c0-.65.11-1.28.31-1.86V7.52H3.04A10 10 0 0 0 2 12c0 1.61.39 3.14 1.04 4.48l3.35-2.62Z" />
                    <path fill="#EA4335" d="M12 6.01c1.47 0 2.79.51 3.83 1.5l2.87-2.88A9.64 9.64 0 0 0 12 2a10 10 0 0 0-8.96 5.52l3.35 2.62C7.18 7.77 9.39 6.01 12 6.01Z" />
                  </svg>
                  Continue with Google
                </TextureButton>

                <div className="mb-5 flex items-center gap-3 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  <span className="h-px flex-1 bg-border" />
                  <span>or continue with email</span>
                  <span className="h-px flex-1 bg-border" />
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  {!isLogin && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-muted-foreground">Full Name</label>
                      <Input
                        type="text"
                        placeholder="Jane Doe"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="h-11 border-input bg-panel text-foreground placeholder:text-muted-foreground/60"
                        disabled={loading}
                        required={!isLogin}
                      />
                    </div>
                  )}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-muted-foreground">Email</label>
                    <Input
                      type="email"
                      placeholder="you@company.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="h-11 border-input bg-panel text-foreground placeholder:text-muted-foreground/60"
                      disabled={loading}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-muted-foreground">Password</label>
                      {isLogin && (
                        <TextureButton
                          variant="minimal"
                          size="sm"
                          className="!bg-transparent"
                          contentClassName="min-h-0 !bg-transparent px-0 py-0 text-blue-400 hover:text-blue-300"
                          onClick={() => toast.info('Password reset coming soon')}
                        >
                          Forgot password?
                        </TextureButton>
                      )}
                    </div>
                    <div className="relative">
                      <Input
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Enter your password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="h-11 border-input bg-panel text-foreground placeholder:text-muted-foreground/60 pr-10"
                        disabled={loading}
                        required
                        minLength={6}
                      />
                      <TextureButton
                        variant="icon"
                        size="icon"
                        onClick={() => setShowPassword(!showPassword)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        className="absolute right-2 top-1/2 -translate-y-1/2 !bg-transparent"
                        contentClassName="!bg-transparent"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </TextureButton>
                    </div>
                  </div>
                  <CosmicButton
                    as="button"
                    type="submit"
                    disabled={loading}
                    className="w-full"
                    contentClassName="min-h-11"
                  >
                    {loading ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Please wait...
                      </span>
                    ) : (
                      isLogin ? 'Sign In' : 'Create Account'
                    )}
                  </CosmicButton>
                </form>

                <div className="mt-6 text-center">
                  <span className="text-sm text-muted-foreground">
                    {isLogin ? "Don't have an account? " : 'Already have an account? '}
                    <TextureButton
                      variant="minimal"
                      size="sm"
                      onClick={toggleMode}
                      className="!bg-transparent"
                      contentClassName="min-h-0 !bg-transparent px-0 py-0 text-blue-400 hover:text-blue-300"
                      disabled={loading}
                    >
                      {isLogin ? 'Create account' : 'Sign in'}
                    </TextureButton>
                  </span>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default Login;
