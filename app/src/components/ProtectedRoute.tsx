import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import type { ReactNode } from 'react';
import { ROUTES } from '@/lib/routes';
import LoadingScreen from '@/components/LoadingScreen';

function SessionLoading({ retrying }: { retrying: boolean }) {
  return <LoadingScreen message={retrying ? 'Waiting to reconnect to your saved session…' : 'Checking your sign-in…'} />;
}

interface RouteGuardProps {
  children: ReactNode;
  redirectTo?: string;
}

export function ProtectedRoute({ children, redirectTo }: RouteGuardProps) {
  const { isAuthenticated, loading, retryingSession } = useAuth();
  const location = useLocation();

  if (loading) {
    return <SessionLoading retrying={retryingSession} />;
  }

  if (!isAuthenticated) {
    return (
      <Navigate 
        to={redirectTo || ROUTES.PUBLIC.LOGIN} 
        state={{ from: location }} 
        replace 
      />
    );
  }

  return <>{children}</>;
}

export function PublicRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, loading, user, retryingSession } = useAuth();
  
  if (loading) {
    return <SessionLoading retrying={retryingSession} />;
  }

  if (isAuthenticated) {
    const redirectPath = user?.isAdmin ? ROUTES.PROTECTED.ADMIN_DASHBOARD : ROUTES.DEFAULT;
    return <Navigate to={redirectPath} replace />;
  }

  return <>{children}</>;
}

interface AuthGuardProps {
  children: ReactNode;
  fallback?: ReactNode;
}

export function AuthGuard({ children, fallback }: AuthGuardProps) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return fallback || null;
  }

  if (!isAuthenticated) {
    return fallback || null;
  }

  return <>{children}</>;
}
