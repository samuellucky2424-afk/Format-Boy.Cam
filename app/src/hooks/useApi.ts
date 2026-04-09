import { useState, useCallback } from 'react';
import { ApiError } from '@/services/api';
import { toast } from 'sonner';

interface UseApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

interface UseApiOptions {
  showToast?: boolean;
  errorMessage?: string;
}

export function useApi<T>(
  apiFn: () => Promise<T>,
  options: UseApiOptions = {}
) {
  const [state, setState] = useState<UseApiState<T>>({
    data: null,
    loading: false,
    error: null,
  });

  const execute = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      const result = await apiFn();
      setState({ data: result, loading: false, error: null });
      return result;
    } catch (err) {
      let message = options.errorMessage || 'An error occurred';
      
      if (err instanceof ApiError) {
        message = err.message;
      } else if (err instanceof Error) {
        message = err.message;
      }

      setState({ data: null, loading: false, error: message });
      
      if (options.showToast !== false) {
        toast.error(message);
      }
      
      return null;
    }
  }, [apiFn, options.errorMessage, options.showToast]);

  const reset = useCallback(() => {
    setState({ data: null, loading: false, error: null });
  }, []);

  return { ...state, execute, reset };
}

export function handleApiError(error: unknown, fallbackMessage = 'An error occurred'): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallbackMessage;
}
