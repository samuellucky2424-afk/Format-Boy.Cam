const MOCK_DELAY = 500;

export const mockUsers = [
  { id: '1', name: 'Jane Doe', email: 'jane@example.com', avatar: 'JD' },
  { id: '2', name: 'John Smith', email: 'john@example.com', avatar: 'JS' },
];

export const mockTransactions = [
  { id: 1, type: 'deposit', amount: 8000, date: 'Mar 25, 2026', status: 'Completed', description: 'Credit top-up' },
  { id: 2, type: 'usage', amount: -4200, date: 'Mar 25, 2026', status: 'Completed', description: 'AI Streaming' },
  { id: 3, type: 'deposit', amount: 34500, date: 'Mar 24, 2026', status: 'Completed', description: 'Credit top-up' },
  { id: 4, type: 'usage', amount: -13800, date: 'Mar 24, 2026', status: 'Completed', description: 'AI Streaming' },
  { id: 5, type: 'deposit', amount: 20000, date: 'Mar 23, 2026', status: 'Completed', description: 'Subscription purchase' },
];

export const mockPricingPlans = [
  {
    id: 'two_weeks',
    name: '2 Weeks',
    price: 100,
    days: 14,
    popular: false,
    badge: null,
    features: ['14 days access'],
  },
  {
    id: 'thirty_days',
    name: '30 Days',
    price: 250,
    days: 30,
    popular: true,
    badge: null,
    features: ['30 days access'],
  },
  {
    id: 'unlimited',
    name: 'Unlimited',
    price: 500,
    days: null,
    popular: false,
    badge: 'No expiry',
    features: ['Access does not expire'],
  },
];

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const mockApi = {
  auth: {
    login: async (email: string) => {
      await delay(MOCK_DELAY);
      const user = mockUsers.find(u => u.email === email) || mockUsers[0];
      return {
        user,
        token: 'mock-jwt-token-' + Date.now(),
      };
    },
    register: async (name: string, email: string) => {
      await delay(MOCK_DELAY);
      const newUser = {
        id: String(mockUsers.length + 1),
        name,
        email,
        avatar: name.split(' ').map(n => n[0]).join(''),
      };
      return {
        user: newUser,
        token: 'mock-jwt-token-' + Date.now(),
      };
    },
    logout: async () => {
      await delay(200);
      return { success: true };
    },
    me: async () => {
      await delay(300);
      return { user: mockUsers[0] };
    },
  },
  users: {
    getProfile: async () => {
      await delay(MOCK_DELAY);
      return { user: mockUsers[0] };
    },
    updateProfile: async (data: Partial<typeof mockUsers[0]>) => {
      await delay(MOCK_DELAY);
      return { user: { ...mockUsers[0], ...data } };
    },
  },
  data: {
    getDashboard: async () => {
      await delay(MOCK_DELAY);
      return {
        stats: {
          credits: 24500,
          sessionsToday: 3,
          totalUsage: 125.5,
          streakDays: 7,
        },
      };
    },
    getTransactions: async () => {
      await delay(MOCK_DELAY);
      return { transactions: mockTransactions };
    },
  },
  session: {
    start: async () => {
      await delay(MOCK_DELAY);
      return { allowed: true };
    },
    end: async () => {
      await delay(200);
      return { success: true };
    },
    deduct: async (amount: number) => {
      await delay(200);
      return { deducted: amount, success: true };
    },
  },
};
