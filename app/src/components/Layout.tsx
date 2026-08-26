import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Coins,
  LogOut,
  Menu,
  Minus,
  Square,
  X,
} from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { AnimatedNumber } from '@/components/ui/animated-number';
import { MetalIconButton } from '@/components/ui/metal-button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { TextureButton } from '@/components/ui/texture-button';
import { TextureOverlay } from '@/components/ui/texture-overlay';
import { useAuth } from '@/context/AuthContext';
import { useApp } from '@/context/AppContext';
import { ADMIN_NAV, HENSHIN_NAV, getPageTitle, type NavItem } from '@/lib/nav';
import { ROUTES } from '@/lib/routes';
import { PricingDialogProvider } from '@/components/PricingDialog';
import { usePricingDialog } from '@/hooks/usePricingDialog';

const SIDEBAR_COLLAPSED_WIDTH = 48;

function getInitials(name?: string): string {
  if (!name) return 'U';
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

/* Menu du tiroir mobile */
function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth();
  const { openPricing } = usePricingDialog();

  const renderItem = (item: NavItem) => {
    if (item.action === 'buy-credits') {
      return (
        <TextureButton
          key={item.action}
          variant="minimal"
          size="sm"
          onClick={() => {
            onNavigate?.();
            openPricing();
          }}
          className="w-full"
          contentClassName="justify-start"
        >
          <item.icon className="h-[18px] w-[18px] shrink-0" />
          <span>{item.label}</span>
        </TextureButton>
      );
    }

    return (
      <NavLink key={item.path} to={item.path} onClick={onNavigate} className="nav-item w-full">
        <item.icon className="h-[18px] w-[18px] shrink-0" />
        <span>{item.label}</span>
      </NavLink>
    );
  };

  return (
    <nav className="mobile-nav space-y-0.5" aria-label="Henshin">
      {HENSHIN_NAV.map(renderItem)}
      {user?.isAdmin &&
        ADMIN_NAV.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            onClick={onNavigate}
            className="nav-item mt-3 w-full"
          >
            <item.icon className="h-[18px] w-[18px] shrink-0" />
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span className="flex-1">{item.label}</span>
              <span className="rounded-full border border-blue-500/20 bg-blue-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-blue-400">
                Admin
              </span>
            </span>
          </NavLink>
        ))}
    </nav>
  );
}

function SidebarBody() {
  const { user, logout } = useAuth();
  const { openPricing } = usePricingDialog();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate(ROUTES.PUBLIC.LOGIN);
  };

  const renderItem = (item: NavItem) => {
    const content = (
      <>
        <span className="side-icon-slot">
          <item.icon className="side-icon" strokeWidth={1.5} />
        </span>
        <span className="side-tooltip" aria-hidden="true">{item.label}</span>
      </>
    );

    if (item.action === 'buy-credits') {
      return (
        <TextureButton
          key={item.action}
          variant="icon"
          size="icon"
          onClick={openPricing}
          aria-label={item.label}
          className="side-item !bg-transparent !p-0"
          contentClassName="!size-8 !min-h-8"
        >
          {content}
        </TextureButton>
      );
    }

    return (
      <NavLink key={item.path} to={item.path} aria-label={item.label} className="side-item">
        {content}
      </NavLink>
    );
  };

  return (
    <div className="flex h-full w-full flex-col px-1 py-1.5">
      <nav className="flex flex-col gap-0.5" aria-label="Henshin">
        {HENSHIN_NAV.map(renderItem)}
      </nav>

      {user?.isAdmin && (
        <nav className="mt-3 flex flex-col gap-0.5" aria-label="Admin">
          {ADMIN_NAV.map(renderItem)}
        </nav>
      )}

      <div className="mt-auto flex flex-col gap-0.5">
        {/* Bloc utilisateur */}
        <div className="side-item side-user-row cursor-default">
          <span className="side-icon-slot">
            <Avatar className="h-8 w-8 shrink-0 ring-2 ring-border">
              <AvatarFallback className="bg-blue-500/15 text-[10px] font-semibold text-blue-400">
                {getInitials(user?.name)}
              </AvatarFallback>
            </Avatar>
          </span>
          <span className="side-tooltip" aria-hidden="true">{user?.name || 'User'}</span>
        </div>

        {/* Déconnexion */}
        <TextureButton
          variant="icon"
          size="icon"
          onClick={handleLogout}
          aria-label="Sign out"
          className="side-item !bg-transparent !p-0"
          contentClassName="!size-8 !min-h-8"
        >
          <span className="side-icon-slot">
            <LogOut className="side-icon" strokeWidth={1.5} />
          </span>
          <span className="side-tooltip" aria-hidden="true">Sign out</span>
        </TextureButton>
      </div>
    </div>
  );
}

type ElectronBridge = {
  require?: (id: string) => { ipcRenderer: { send: (channel: string) => void } };
};

function getElectronIpc() {
  try {
    const bridge = window as unknown as ElectronBridge;
    return bridge.require?.('electron')?.ipcRenderer ?? null;
  } catch {
    return null;
  }
}

function LayoutShell() {
  const { user, logout } = useAuth();
  const { credits, sessionStatus } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isElectron] = useState(() => getElectronIpc() !== null);
  const pageTitle = getPageTitle(location.pathname);
  const isStudio =
    location.pathname === '/' || location.pathname === ROUTES.PROTECTED.DASHBOARD;

  const handleWindowControl = (action: 'minimize' | 'maximize' | 'close') => {
    getElectronIpc()?.send(`window-${action}`);
  };

  const handleLogout = () => {
    logout();
    navigate(ROUTES.PUBLIC.LOGIN);
  };

  const live = sessionStatus === 'LIVE';

  return (
    <div className="fixed inset-0 isolate flex flex-col overflow-hidden bg-background">
      <TextureOverlay texture="paperGrain" opacity={0.16} className="z-0 mix-blend-soft-light" />
      {/* Header — 48px, draggable pour la fenêtre frameless */}
      <header className="app-region-drag relative z-50 flex h-12 shrink-0 items-center justify-between pl-2 pr-0">
        <div className="flex min-w-0 items-center gap-3">
          {/* Hamburger mobile */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <TextureButton
                variant="icon"
                size="icon"
                aria-label="Menu"
                className="app-region-no-drag md:hidden"
              >
                <Menu className="size-4" strokeWidth={1.5} />
              </TextureButton>
            </SheetTrigger>
            <SheetContent side="left" className="w-[250px] bg-sidebar p-4">
              <div className="mb-4 flex items-center gap-2.5">
                <div className="h-8 w-8 overflow-hidden rounded-lg ring-1 ring-blue-500/30">
                  <img src="./logo.png" alt="Logo" className="h-full w-full object-cover" />
                </div>
                <span className="text-sm font-bold tracking-tight text-foreground">
                  Henshin 変身
                </span>
              </div>
              <NavList onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>

          {/* Logo compact centré sur le rail 48px (desktop) */}
          <NavLink
            to={ROUTES.PROTECTED.DASHBOARD}
            title="Henshin 変身"
            aria-label="Henshin"
            className="app-region-no-drag hidden size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg ring-1 ring-blue-500/30 md:flex"
          >
            <img src="./logo.png" alt="" className="h-full w-full object-cover" />
          </NavLink>

          <p className="truncate text-[15px] font-medium text-foreground">{pageTitle}</p>
        </div>

        <div className="app-region-no-drag flex shrink-0 items-center gap-2">
          {/* Statut de session */}
          <div
            className="hidden items-center gap-2 px-2 py-1.5 sm:flex"
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                live ? 'animate-pulse bg-red-500' : 'bg-muted-foreground/60'
              }`}
            />
            <span
              className={`text-[10px] font-bold uppercase tracking-wider ${
                live ? 'text-red-400' : 'text-muted-foreground'
              }`}
            >
              {sessionStatus}
            </span>
          </div>

          {/* Crédits */}
          <NavLink
            to={ROUTES.PROTECTED.WALLET}
            title="Credits"
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors duration-150 hover:text-blue-300"
          >
            <Coins className="h-3.5 w-3.5 text-blue-400" />
            <span className="text-sm font-bold tabular-nums text-foreground">
              <AnimatedNumber value={Math.round(credits)} />
            </span>
          </NavLink>

          {/* Compte */}
          <div className="group relative">
            <MetalIconButton
              className="size-7"
              disableGlow
              strength={0.45}
              aria-label="Account menu"
            >
              <Avatar className="h-7 w-7">
                <AvatarFallback className="bg-accent text-[11px] font-semibold text-foreground">
                  {getInitials(user?.name)}
                </AvatarFallback>
              </Avatar>
            </MetalIconButton>
            <div className="invisible absolute right-0 top-full z-50 mt-2 w-56 rounded-xl bg-popover py-1.5 opacity-0 shadow-surface transition-all duration-200 group-hover:visible group-hover:opacity-100">
              <div className="px-4 py-3">
                <p className="truncate text-sm font-semibold text-foreground">
                  {user?.name || 'User'}
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{user?.email || ''}</p>
              </div>
              <TextureButton
                variant="minimal"
                size="sm"
                onClick={handleLogout}
                className="mx-1 w-[calc(100%-0.5rem)]"
                contentClassName="justify-start"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </TextureButton>
            </div>
          </div>

          {/* Contrôles fenêtre (Electron) */}
          {isElectron && (
            <div className="flex items-center self-stretch">
              <TextureButton
                variant="icon"
                size="icon"
                title="Minimize"
                aria-label="Minimize"
                onClick={() => handleWindowControl('minimize')}
                className="rounded-none !bg-transparent"
                contentClassName="rounded-none !bg-transparent"
              >
                <Minus className="h-4 w-4" />
              </TextureButton>
              <TextureButton
                variant="icon"
                size="icon"
                title="Maximize"
                aria-label="Maximize"
                onClick={() => handleWindowControl('maximize')}
                className="rounded-none !bg-transparent"
                contentClassName="rounded-none !bg-transparent"
              >
                <Square className="h-4 w-4" />
              </TextureButton>
              <TextureButton
                variant="destructive"
                size="icon"
                title="Close"
                aria-label="Close"
                onClick={() => handleWindowControl('close')}
                className="rounded-none !bg-transparent"
                contentClassName="rounded-none !bg-transparent text-muted-foreground hover:!bg-red-500 hover:text-white"
              >
                <X className="h-4 w-4" />
              </TextureButton>
            </div>
          )}
        </div>
      </header>

      {/* Corps : rail fixe + surface de contenu scrollable */}
      <div className="relative z-10 grid min-h-0 flex-1 gap-2 p-2 md:grid-cols-[48px_minmax(0,1fr)]">
        <aside
          className="sidebar-shell relative hidden h-full flex-col md:flex"
          style={{ width: SIDEBAR_COLLAPSED_WIDTH, overflow: 'visible' }}
        >
          <SidebarBody />
        </aside>

        <section className="min-h-0 flex-1 overflow-hidden">
          <div className="custom-scrollbar h-full overflow-auto">
            <div
              className={`flex h-full min-h-0 flex-col ${isStudio ? '' : 'p-3 lg:p-4'}`}
            >
              <Outlet />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default function Layout() {
  return (
    <PricingDialogProvider>
      <LayoutShell />
    </PricingDialogProvider>
  );
}
