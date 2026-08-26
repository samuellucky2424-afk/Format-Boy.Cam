import { LayoutDashboard, Coins, CreditCard, Settings, ShieldAlert, type ComponentType } from 'lucide-react';
import { ROUTES } from '@/lib/routes';

interface NavItemBase {
  label: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
}

export interface NavLinkItem extends NavItemBase {
  path: string;
  action?: never;
}

export interface NavActionItem extends NavItemBase {
  action: 'buy-credits';
  path?: never;
}

export type NavItem = NavLinkItem | NavActionItem;

export const HENSHIN_NAV: NavItem[] = [
  { path: ROUTES.PROTECTED.DASHBOARD, label: 'Dashboard', icon: LayoutDashboard },
  { path: ROUTES.PROTECTED.WALLET, label: 'Credits', icon: Coins },
  { action: 'buy-credits', label: 'Buy Credits', icon: CreditCard },
  { path: ROUTES.PROTECTED.SETTINGS, label: 'Settings', icon: Settings },
];

export const ADMIN_NAV: NavItem[] = [
  { path: ROUTES.PROTECTED.ADMIN_DASHBOARD, label: 'Admin', icon: ShieldAlert },
];

const PAGE_TITLES: Array<{ path: string; label: string }> = [
  { path: ROUTES.PROTECTED.DASHBOARD, label: 'Dashboard' },
  { path: ROUTES.PROTECTED.WALLET, label: 'Credits' },
  { path: ROUTES.PROTECTED.SETTINGS, label: 'Settings' },
  { path: ROUTES.PROTECTED.ADMIN_DASHBOARD, label: 'Admin' },
];

export function getPageTitle(pathname: string): string {
  const exact = PAGE_TITLES.find((item) => pathname === item.path);
  if (exact) return exact.label;

  const nested = PAGE_TITLES.filter((item) => pathname.startsWith(`${item.path}/`)).sort(
    (a, b) => b.path.length - a.path.length,
  )[0];
  if (nested) return nested.label;

  return 'Henshin 変身';
}
