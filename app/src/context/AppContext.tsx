import { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import type { ReactNode } from 'react';
import { apiFetch, isAbortError } from '@/lib/api-client';
import { isFiniteNumber } from '@/lib/utils';
import { useAuth } from './AuthContext';

export interface Transaction {
  id: string;
  type: 'credit' | 'debit';
  amount: number;
  credits?: number;
  description: string;
  timestamp: string;
}

interface AppContextType {
  credits: number;
  setCredits: (credits: number) => void;
  refreshCredits: () => Promise<void>;
  sessionStatus: 'LIVE' | 'IDLE';
  setSessionStatus: (status: 'LIVE' | 'IDLE') => void;
  isLoading: boolean;
  setLoading: (loading: boolean) => void;
  transactions: Transaction[];
  addTransaction: (transaction: Omit<Transaction, 'id' | 'timestamp'>) => void;
  notifications: Notification[];
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp'>) => void;
  clearNotifications: () => void;
}

export interface Notification {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message: string;
  timestamp: string;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const TRANSACTIONS_KEY = 'format_boy_transactions';

export function AppProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [credits, setCreditsState] = useState(0);
  const [sessionStatus, setSessionStatus] = useState<'LIVE' | 'IDLE'>('IDLE');
  const [isLoading, setLoading] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const loadCredits = useCallback(async (signal?: AbortSignal) => {
    if (!user?.id) {
      return;
    }

    const response = await apiFetch(`/wallet?userId=${user.id}`, {
      signal,
      timeoutMs: 20_000,
    });

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    const text = await response.text();
    let data: unknown;

    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Invalid JSON format from API: ${text.substring(0, 20)}`);
    }

    if (!data || typeof data !== 'object' || !isFiniteNumber((data as { credits?: unknown }).credits)) {
      console.error('Invalid credit response', data);
      throw new Error('Invalid credits value');
    }

    const nextCredits = Math.max(0, (data as { credits: number }).credits);
    setCreditsState(nextCredits);

    if (Array.isArray((data as { transactions?: unknown }).transactions)) {
      setTransactions((data as { transactions: Transaction[] }).transactions);
    } else if ((data as { transactions?: unknown }).transactions !== undefined) {
      console.error('Invalid transactions response', data);
    }
  }, [user?.id]);

  const refreshCredits = useCallback(async () => {
    await loadCredits();
  }, [loadCredits]);

  useEffect(() => {
    if (!user?.id) return;

    const controller = new AbortController();

    loadCredits(controller.signal)
      .catch(err => {
        if (isAbortError(err)) return;
        console.warn('Failed to sync credits from backend:', err);
      });

    return () => controller.abort();
  }, [loadCredits, user?.id]);

  const setCredits = useCallback((newCredits: number) => {
    if (!isFiniteNumber(newCredits)) {
      throw new Error('Invalid credits value');
    }

    setCreditsState(Math.max(0, newCredits));
  }, []);

  const addTransaction = useCallback((transactionData: Omit<Transaction, 'id' | 'timestamp'>) => {
    const transaction: Transaction = {
      ...transactionData,
      id: `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
    };
    
    setTransactions(prev => {
      const updated = [transaction, ...prev].slice(0, 50);
      localStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const addNotification = useCallback((notificationData: Omit<Notification, 'id' | 'timestamp'>) => {
    const notification: Notification = {
      ...notificationData,
      id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
    };
    
    setNotifications(prev => {
      const updated = [notification, ...prev].slice(0, 20);
      return updated;
    });
    
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== notification.id));
    }, 5000);
  }, []);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  const value = useMemo(() => ({
    credits,
    setCredits,
    refreshCredits,
    sessionStatus,
    setSessionStatus,
    isLoading,
    setLoading,
    transactions,
    addTransaction,
    notifications,
    addNotification,
    clearNotifications,
  }), [credits, setCredits, refreshCredits, sessionStatus, isLoading, transactions, addTransaction, notifications, addNotification, clearNotifications]);

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
