import { createContext, useContext } from 'react';

export interface PricingDialogContextValue {
  openPricing: () => void;
}

export const PricingDialogContext = createContext<PricingDialogContextValue | null>(null);

export function usePricingDialog() {
  const context = useContext(PricingDialogContext);
  if (!context) throw new Error('usePricingDialog must be used within PricingDialogProvider');
  return context;
}
