import { NavLink, useNavigate } from 'react-router-dom';
import { 
  Video, 
  LayoutDashboard, 
  Wallet, 
  CreditCard, 
  X,
  LogOut,
  Menu,
  Settings
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useUI } from '@/context/UIContext';
import { useAuth } from '@/context/AuthContext';
import { ROUTES } from '@/lib/routes';

interface NavItem {
  path: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const navItems: NavItem[] = [
  { path: ROUTES.PROTECTED.DASHBOARD, label: 'Dashboard', icon: LayoutDashboard },
  { path: ROUTES.PROTECTED.WALLET, label: 'Wallet', icon: Wallet },
  { path: ROUTES.PROTECTED.SUBSCRIPTION, label: 'Subscription', icon: CreditCard },
  { path: ROUTES.PROTECTED.SETTINGS, label: 'Settings', icon: Settings },
];

export default function Sidebar() {
  const { sidebarOpen, toggleSidebar } = useUI();
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <>
      {/* Sticky Hamburger Toggle (When Closed) */}
      {!sidebarOpen && (
        <button
          onClick={toggleSidebar}
          aria-label="Open sidebar"
          title="Open sidebar"
          className="fixed top-5 left-5 z-50 p-2.5 bg-[#18181b] border border-[#27272a] rounded-xl hover:bg-[#27272a] hover:scale-105 shadow-xl transition-all duration-300"
        >
          <Menu className="w-5 h-5 text-white" />
        </button>
      )}

      {/* Main Sidebar Element */}
      <aside
        className={`fixed left-0 top-0 h-screen bg-[#0f0f10]/95 backdrop-blur-xl border-r border-[#18181b] transition-transform duration-300 ease-in-out z-50 flex flex-col w-56 shadow-2xl ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="h-20 flex items-center justify-between px-5 border-b border-[#18181b]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Video className="w-4 h-4 text-white" />
            </div>
            <div>
              <span className="text-lg font-bold text-white tracking-tight">Morphly</span>
              <p className="text-[10px] text-[#71717a] -mt-0.5 tracking-wide uppercase font-semibold">AI Streaming</p>
            </div>
          </div>
          <button 
            onClick={toggleSidebar} 
            aria-label="Close sidebar"
            title="Close sidebar"
            className="p-1.5 hover:bg-[#27272a] rounded-lg text-[#a1a1aa] hover:text-white transition-all transform hover:rotate-90"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <nav className="flex-1 py-8 px-4 space-y-1.5 overflow-y-auto custom-scrollbar">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={() => {
                // Auto close on mobile when navigating
                if (window.innerWidth < 1024) toggleSidebar();
              }}
              className={({ isActive }) =>
                `flex items-center gap-3.5 px-4 py-3.5 rounded-xl transition-all duration-200 group relative overflow-hidden ${
                  isActive
                    ? 'bg-blue-500/10 text-white border border-blue-500/20 shadow-lg shadow-blue-500/5'
                    : 'text-[#a1a1aa] hover:text-white hover:bg-[#18181b] border border-transparent hover:border-[#27272a]'
                }`
              }
            >
              <item.icon className="w-5 h-5 flex-shrink-0" />
              <span className="font-medium text-sm tracking-wide">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="p-5 border-t border-[#18181b] bg-[#09090b]/50">
            <div className="flex items-center gap-3 mb-4 p-2.5 rounded-xl bg-[#18181b] border border-[#27272a] shadow-inner">
              <Avatar className="w-10 h-10 ring-2 ring-[#27272a]">
                <AvatarFallback className="bg-gradient-to-br from-blue-500/20 to-[#18181b] text-xs font-semibold text-white">
                  {user?.name ? getInitials(user.name) : 'JD'}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white truncate">
                  {user?.name || 'Jane Doe'}
                </p>
                <p className="text-xs text-[#71717a] truncate">
                  {user?.email || 'jane@example.com'}
                </p>
              </div>
            </div>
            <Button
              onClick={handleLogout}
              variant="ghost"
              className="w-full justify-start gap-3 h-11 text-[#a1a1aa] hover:text-white hover:bg-red-500/10 hover:border-red-500/20 border border-transparent transition-all"
            >
              <LogOut className="w-4 h-4" />
              <span className="text-sm font-medium">Securely Sign out</span>
            </Button>
        </div>
      </aside>

      {/* Mobile Backdrop Overlay */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden transition-opacity duration-300"
          onClick={toggleSidebar}
        />
      )}
    </>
  );
}
