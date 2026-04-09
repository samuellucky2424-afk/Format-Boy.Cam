import type { ReactNode } from 'react';
import { Outlet } from 'react-router-dom';
import { Navigation } from './Navigation';

interface AppLayoutProps {
  children?: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  return <Navigation>{children || <Outlet />}</Navigation>;
}
