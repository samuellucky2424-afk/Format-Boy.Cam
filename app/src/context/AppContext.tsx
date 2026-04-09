import { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import type { ReactNode } from 'react';
import { apiFetch } from '@/lib/api-client';
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
  balance: number;
  setBalance: (balance: number) => void;
  addBalance: (amount: number) => void;
  deductBalance: (amount: number) => void;
  credits: number;
  setCredits: (credits: number) => void;
  addCredits: (credits: number) => void;
  deductCredits: (credits: number) => void;
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

const BALANCE_KEY = 'morphly_balance';
const TRANSACTIONS_KEY = 'morphly_transactions';

export function AppProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [balance, setBalanceState] = useState(0);
  const [credits, setCreditsState] = useState(0);
  const [sessionStatus, setSessionStatus] = useState<'LIVE' | 'IDLE'>('IDLE');
  const [isLoading, setLoading] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    if (user?.id) {
      apiFetch(`/wallet?userId=${user.id}`)
        .then(async res => {
          if (!res.ok) {
            throw new Error(`API returned ${res.status}`);
          }
          const text = await res.text();
          try {
            return JSON.parse(text);
          } catch (e) {
            throw new Error(`Invalid JSON format from API: ${text.substring(0, 20)}`);
          }
        })
        .then(data => {
          if (data && data.balance !== undefined) {
            setBalanceState(data.balance);
            setCreditsState(data.credits ?? 0);
            setTransactions(data.transactions || []);
          }
        })
        .catch(err => console.warn('Failed to sync wallet (backend might need restart):', err));
    }
  }, [user?.id]);

  const setBalance = useCallback((newBalance: number) => {
    setBalanceState(newBalance);
    localStorage.setItem(BALANCE_KEY, newBalance.toString());
  }, []);

  const addBalance = useCallback((amount: number) => {
    const transaction: Transaction = {
      id: `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'credit',
      amount,
      description: 'Balance added',
      timestamp: new Date().toISOString(),
    };
    
    setBalanceState(prev => {
      const newBalance = prev + amount;
      localStorage.setItem(BALANCE_KEY, newBalance.toString());
      return newBalance;
    });
    
    setTransactions(prev => {
      const updated = [transaction, ...prev].slice(0, 50);
      localStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const deductBalance = useCallback((amount: number) => {
    const transaction: Transaction = {
      id: `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'debit',
      amount,
      description: 'Session usage',
      timestamp: new Date().toISOString(),
    };
    
    setBalanceState(prev => {
      const newBalance = Math.max(0, prev - amount);
      localStorage.setItem(BALANCE_KEY, newBalance.toString());
      return newBalance;
    });
    
    setTransactions(prev => {
      const updated = [transaction, ...prev].slice(0, 50);
      localStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const setCredits = useCallback((newCredits: number) => {
    setCreditsState(Math.max(0, newCredits || 0));
  }, []);

  const addCredits = useCallback((amount: number) => {
    const transaction: Transaction = {
      id: `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'credit',
      amount: 0,
      credits: amount,
      description: 'Credits purchased',
      timestamp: new Date().toISOString(),
    };

    setCreditsState(prev => Math.max(0, prev + amount));

    setTransactions(prev => {
      const updated = [transaction, ...prev].slice(0, 50);
      localStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const deductCredits = useCallback((amount: number) => {
    const transaction: Transaction = {
      id: `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'debit',
      amount: 0,
      credits: amount,
      description: 'Session usage',
      timestamp: new Date().toISOString(),
    };

    setCreditsState(prev => Math.max(0, prev - amount));

    setTransactions(prev => {
      const updated = [transaction, ...prev].slice(0, 50);
      localStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(updated));
      return updated;
    });
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
    balance,
    setBalance,
    addBalance,
    deductBalance,
    credits,
    setCredits,
    addCredits,
    deductCredits,
    sessionStatus,
    setSessionStatus,
    isLoading,
    setLoading,
    transactions,
    addTransaction,
    notifications,
    addNotification,
    clearNotifications,
  }), [balance, setBalance, addBalance, deductBalance, credits, setCredits, addCredits, deductCredits, sessionStatus, isLoading, transactions, addTransaction, notifications, addNotification, clearNotifications]);

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
