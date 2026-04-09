import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Video, Loader2, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/context/AuthContext';
import { toast } from 'sonner';

function Login() {
  const { login, register, loading, error, clearError } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
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

  const toggleMode = () => {
    setIsLogin(!isLogin);
    clearError();
  };

  return (
    <div className="min-h-screen bg-[#0f0f10] flex items-center justify-center p-4">
      <div className="w-full max-w-[400px]">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-lg bg-[#1a1a1b] flex items-center justify-center">
            <Video className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-semibold text-white tracking-tight">Morphly</span>
        </div>

        <Card className="bg-[#18181b] border-[#27272a]">
          <CardHeader className="pb-6">
            <CardTitle className="text-xl font-semibold text-white text-center">
              {isLogin ? 'Sign in to your account' : 'Create your account'}
            </CardTitle>
          </CardHeader>
          <CardContent>
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
