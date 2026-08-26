import { lazy, Suspense } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from '@/context/AuthContext';
import { AppProvider } from '@/context/AppContext';
import { ProtectedRoute, PublicRoute } from '@/components/ProtectedRoute';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Toaster } from '@/components/ui/sonner';
import Layout from '@/components/Layout';
import LoadingScreen from '@/components/LoadingScreen';
import { ROUTES } from '@/lib/routes';

const Login = lazy(() => import('@/pages/Login'));
import { UpdateModal } from '@/components/UpdateModal';
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const PreviewWindow = lazy(() => import('@/pages/PreviewWindow'));
const Wallet = lazy(() => import('@/pages/Wallet'));
const Settings = lazy(() => import('@/pages/Settings'));
const AdminDashboard = lazy(() => import('@/pages/AdminDashboard'));
const NotFound = lazy(() => import('@/pages/NotFound'));
const PaymentSuccess = lazy(() => import('@/pages/PaymentSuccess'));
const AuthCallback = lazy(() => import('@/pages/AuthCallback'));

function App() {
  return (
    <ErrorBoundary>
      <HashRouter>
        <AuthProvider>
          <AppProvider>
              <Suspense fallback={<LoadingScreen />}>
                <Routes>
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
                    path={ROUTES.PUBLIC.PAYMENT_SUCCESS}
                    element={<PaymentSuccess />}
                  />
                  <Route path={ROUTES.PUBLIC.AUTH_CALLBACK} element={<AuthCallback />} />
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
                    <Route index element={<Dashboard />} />
                    <Route path={ROUTES.PROTECTED.DASHBOARD} element={<Dashboard />} />
                    <Route path={ROUTES.PROTECTED.WALLET} element={<Wallet />} />
                    <Route
                      path={ROUTES.PROTECTED.SUBSCRIPTION}
                      element={<Navigate to={`${ROUTES.PROTECTED.WALLET}?buy=1`} replace />}
                    />
                    <Route path={ROUTES.PROTECTED.SETTINGS} element={<Settings />} />
                    <Route path={ROUTES.PROTECTED.ADMIN_DASHBOARD} element={<AdminDashboard />} />
                  </Route>
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
              <Toaster />
              <UpdateModal />
            </AppProvider>
        </AuthProvider>
      </HashRouter>
    </ErrorBoundary>
  );
}

export default App;
