import { lazy, Suspense } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from '@/context/AuthContext';
import { UIProvider } from '@/context/UIContext';
import { AppProvider } from '@/context/AppContext';
import { ProtectedRoute, PublicRoute } from '@/components/ProtectedRoute';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Toaster } from '@/components/ui/sonner';
import Layout from '@/components/Layout';
import LoadingScreen from '@/components/LoadingScreen';
import { ROUTES } from '@/lib/routes';

const Login = lazy(() => import('@/pages/Login'));
const AuthCallback = lazy(() => import('@/pages/AuthCallback'));
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const PreviewWindow = lazy(() => import('@/pages/PreviewWindow'));
const Wallet = lazy(() => import('@/pages/Wallet'));
const Subscription = lazy(() => import('@/pages/Subscription'));
const Settings = lazy(() => import('@/pages/Settings'));
const NotFound = lazy(() => import('@/pages/NotFound'));
const PaymentSuccess = lazy(() => import('@/pages/PaymentSuccess'));

function App() {
  return (
    <ErrorBoundary>
      <HashRouter>
        <AuthProvider>
          <UIProvider>
            <AppProvider>
              <Suspense fallback={<LoadingScreen />}>
                <Routes>
                  <Route
                    path={ROUTES.PUBLIC.AUTH_CALLBACK}
                    element={<AuthCallback />}
                  />
                  <Route
                    path={ROUTES.PUBLIC.LOGIN}
                    element={
                      <PublicRoute>
                        <Login />
                      </PublicRoute>
                    }
                  />
                  <Route
                    path={ROUTES.PUBLIC.SIGNUP}
                    element={
                      <PublicRoute>
                        <Login />
                      </PublicRoute>
                    }
                  />
                  <Route
                    path={ROUTES.PROTECTED.SUBSCRIPTION}
                    element={<Subscription />}
                  />
                  <Route
                    path={ROUTES.PUBLIC.PAYMENT_SUCCESS}
                    element={<PaymentSuccess />}
                  />
                  <Route path="/preview" element={<PreviewWindow />} />
                  <Route
                    path="/wallet"
                    element={<Navigate to={ROUTES.PROTECTED.WALLET} replace />}
                  />
                  <Route
                    path="/"
                    element={
                      <ProtectedRoute>
                        <Layout />
                      </ProtectedRoute>
                    }
                  >
                    <Route index element={<Navigate to={ROUTES.DEFAULT} replace />} />
                    <Route path={ROUTES.PROTECTED.WALLET} element={<Wallet />} />
                    <Route path={ROUTES.PROTECTED.SETTINGS} element={<Settings />} />
                  </Route>
                  <Route
                    path={ROUTES.PROTECTED.DASHBOARD}
                    element={
                      <ProtectedRoute>
                        <Dashboard />
                      </ProtectedRoute>
                    }
                  />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
              <Toaster />
            </AppProvider>
          </UIProvider>
        </AuthProvider>
      </HashRouter>
    </ErrorBoundary>
  );
}

export default App;
