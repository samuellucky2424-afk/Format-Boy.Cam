import { Navigate } from 'react-router-dom';
import { ROUTES } from '@/lib/routes';

export default function Subscription() {
  return <Navigate to={`${ROUTES.PROTECTED.WALLET}?buy=1`} replace />;
}
