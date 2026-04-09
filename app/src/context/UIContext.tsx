import React, { createContext, useContext, useState, useCallback } from 'react';

interface UIState {
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;
}

interface UIContextType extends UIState {
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebarCollapse: () => void;
}

const UIContext = createContext<UIContextType | undefined>(undefined);

export function UIProvider({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen(prev => !prev);
  }, []);

  const setSidebarOpenFn = useCallback((open: boolean) => {
    setSidebarOpen(open);
  }, []);

  const toggleSidebarCollapse = useCallback(() => {
    setSidebarCollapsed(prev => !prev);
  }, []);

  return (
    <UIContext.Provider value={{
      sidebarOpen,
      sidebarCollapsed,
      toggleSidebar,
      setSidebarOpen: setSidebarOpenFn,
      toggleSidebarCollapse,
    }}>
      {children}
    </UIContext.Provider>
  );
}

export function useUI() {
  const context = useContext(UIContext);
  if (context === undefined) {
    throw new Error('useUI must be used within a UIProvider');
  }
  return context;
}
