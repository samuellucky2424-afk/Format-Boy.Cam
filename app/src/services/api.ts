import { apiFetch } from '@/lib/api-client';

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }

  static fromResponse(response: Response): ApiError {
    return new ApiError(
      response.status,
      response.statusText || 'Unknown error',
      response.status.toString()
    );
  }
}

export class NetworkError extends Error {
  constructor(message: string = 'Network error occurred') {
    super(message);
    this.name = 'NetworkError';
  }
}

export class AuthError extends ApiError {
  constructor(message: string = 'Authentication required') {
    super(401, message);
    this.name = 'AuthError';
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function isAuthError(error: unknown): error is AuthError {
  return error instanceof AuthError;
}

interface ApiOptions extends RequestInit {
  token?: string;
}

async function apiRequest<T>(endpoint: string, options: ApiOptions = {}): Promise<T> {
  const { token, ...fetchOptions } = options;
  
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (token) {
    (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
  }

  try {
    const response = await apiFetch(endpoint, {
      ...fetchOptions,
      headers,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new ApiError(
        response.status,
        errorData.message || `API Error: ${response.statusText}`
      );
    }

    return response.json();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new Error('Network error');
  }
}

export const api = {
  get: <T>(endpoint: string, options?: ApiOptions) => 
    apiRequest<T>(endpoint, { ...options, method: 'GET' }),
  
  post: <T>(endpoint: string, data?: unknown, options?: ApiOptions) =>
    apiRequest<T>(endpoint, { ...options, method: 'POST', body: JSON.stringify(data) }),
  
  put: <T>(endpoint: string, data?: unknown, options?: ApiOptions) =>
    apiRequest<T>(endpoint, { ...options, method: 'PUT', body: JSON.stringify(data) }),
  
  delete: <T>(endpoint: string, options?: ApiOptions) =>
    apiRequest<T>(endpoint, { ...options, method: 'DELETE' }),
};

export const authApi = {
  login: (email: string, password: string) => 
    api.post<{ user: unknown; token: string }>('/auth/login', { email, password }),
  
  register: (name: string, email: string, password: string) =>
    api.post<{ user: unknown; token: string }>('/auth/register', { name, email, password }),
  
  logout: () => api.post('/auth/logout'),
  
  me: () => api.get<{ user: unknown }>('/auth/me'),
};

export const usersApi = {
  getProfile: () => api.get<{ user: unknown }>('/users/profile'),
  
  updateProfile: (data: Partial<{ name: string; email: string }>) =>
    api.put<{ user: unknown }>('/users/profile', data),
};

export const dataApi = {
  getDashboard: () => api.get<{ stats: unknown }>('/data/dashboard'),
  
  getTransactions: () => api.get<{ transactions: unknown[] }>('/data/transactions'),
  
  startSession: () => api.post<{ allowed: boolean; error?: string }>('/session/start'),
  
  endSession: () => api.post('/session/end'),
  
  deductBalance: (amount: number) => api.post('/session/deduct', { amount }),
};
