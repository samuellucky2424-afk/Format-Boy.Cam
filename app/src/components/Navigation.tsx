import { NavLink } from 'react-router-dom';
import { Video, ChevronDown, LogOut, CreditCard, Wallet, LayoutDashboard, Settings } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/context/AuthContext';
import { useApp } from '@/context/AppContext';
import { ROUTES } from '@/lib/routes';

interface NavigationProps {
  children: React.ReactNode;
}

interface NavItem {
  path: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

export function Navigation({ children }: NavigationProps) {
  const { user, logout } = useAuth();
  const { balance, sessionStatus } = useApp();

  const navItems: NavItem[] = [
    { path: ROUTES.PROTECTED.DASHBOARD, label: 'Dashboard', icon: LayoutDashboard },
    { path: ROUTES.PROTECTED.WALLET, label: 'Wallet', icon: Wallet },
    { path: ROUTES.PROTECTED.SUBSCRIPTION, label: 'Subscription', icon: CreditCard },
    { path: ROUTES.PROTECTED.SETTINGS, label: 'Settings', icon: Settings },
  ];

  const getNavLinkClass = ({ isActive }: { isActive: boolean }) =>
    `px-4 py-2 text-sm font-medium transition-all duration-200 rounded-lg flex items-center gap-1.5 ${
      isActive
        ? 'text-white bg-[#18181b] border border-[#27272a] shadow-lg shadow-black/10 font-semibold'
        : 'text-[#a1a1aa] hover:text-white hover:bg-[#18181b] border border-transparent hover:border-[#27272a]'
    }`;

  const getInitials = (name?: string) => {
    if (!name) return 'U';
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <div className="min-h-screen bg-[#09090b]">
      <header className="h-16 border-b border-[#18181b] bg-[#09090b]/80 backdrop-blur-2xl sticky top-0 z-50">
        <div className="h-full max-w-[1600px] mx-auto px-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <NavLink to={ROUTES.PROTECTED.DASHBOARD} className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30 transition-all duration-300 hover:scale-105">
                <Video className="w-4 h-4 text-white" />
              </div>
              <div>
                <span className="text-lg font-bold text-white tracking-tight">Morphly</span>
                <p className="text-[10px] text-[#71717a] -mt-0.5 tracking-wide">AI Streaming Platform</p>
              </div>
            </NavLink>
          </div>

          <nav className="flex items-center gap-1.5">
            {navItems.map(({ path, label, icon: Icon }) => (
              <NavLink
                key={path}
                to={path}
                end={path === ROUTES.PROTECTED.DASHBOARD}
                className={getNavLinkClass}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-4">
            <div className={`flex items-center gap-2 px-4 py-2 rounded-xl border transition-all duration-200 ${
              sessionStatus === 'LIVE'
                ? 'bg-red-500/10 border-red-500/30'
                : 'bg-[#18181b] border-[#27272a]'
            }`}>
              <div className={`w-1.5 h-1.5 rounded-full ${sessionStatus === 'LIVE' ? 'bg-red-500 animate-pulse' : 'bg-[#71717a]'}`} />
              <span className={`text-[10px] font-bold uppercase tracking-wider ${sessionStatus === 'LIVE' ? 'text-red-500' : 'text-[#71717a]'}`}>
                {sessionStatus}
              </span>
            </div>
            <NavLink
              to={ROUTES.PROTECTED.WALLET}
              className={({ isActive }) =>
                `flex items-center gap-2 px-4 py-2 rounded-xl border transition-all duration-200 shadow-lg shadow-black/10 ${
                  isActive 
                    ? 'bg-blue-500/10 border-blue-500/30 hover:border-blue-500/50' 
                    : 'bg-[#18181b] border-[#27272a] hover:border-[#3f3f46] hover:bg-[#1f1f23]'
                }`
              }
            >
              <Wallet className="w-3.5 h-3.5 text-[#a1a1aa]" />
              <span className="text-sm font-bold text-white tracking-tight">₦{Math.round(balance).toLocaleString()}</span>
              <span className="px-2 py-0.5 text-[9px] font-bold text-blue-400 bg-blue-500/10 rounded-full tracking-wide border border-blue-500/20">CREDITS</span>
            </NavLink>
            <Separator orientation="vertical" className="h-6 bg-[#27272a]" />
            <div className="relative group">
              <button className="flex items-center gap-2 p-1 rounded-xl hover:bg-[#18181b] transition-all duration-200">
                <Avatar className="w-8 h-8 ring-2 ring-[#27272a] ring-offset-2 ring-offset-[#09090b]">
                  <AvatarFallback className="bg-gradient-to-br from-[#27272a] to-[#18181b] text-xs font-semibold text-white">
                    {getInitials(user?.name)}
                  </AvatarFallback>
                </Avatar>
                <ChevronDown className="w-3.5 h-3.5 text-[#71717a]" />
              </button>
              <div className="absolute right-0 top-full mt-3 w-56 bg-[#18181b] border border-[#27272a] rounded-xl shadow-2xl shadow-black/50 py-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 backdrop-blur-xl">
                <div className="px-5 py-4 border-b border-[#27272a]">
                  <p className="text-sm font-semibold text-white">{user?.name || 'User'}</p>
                  <p className="text-xs text-[#71717a] mt-0.5">{user?.email || 'user@example.com'}</p>
                </div>
                <button
                  onClick={logout}
                  className="w-full px-5 py-3 text-sm text-left text-[#a1a1aa] hover:text-white hover:bg-[#27272a] flex items-center gap-3 transition-colors duration-150"
                >
                  <LogOut className="w-4 h-4" />
                  Sign out
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-6 py-8">
        {children}
      </main>
    </div>
  );
}
