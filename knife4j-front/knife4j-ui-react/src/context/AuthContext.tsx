import React, { createContext, useContext, useState } from 'react';

const STORAGE_KEY = 'knife4j_auth';

export interface BearerAuth {
  type: 'bearer';
  token: string;
}

export interface BasicAuth {
  type: 'basic';
  username: string;
  password: string;
}

export type AuthConfig = BearerAuth | BasicAuth | null;

interface AuthContextValue {
  auth: AuthConfig;
  setAuth: (auth: AuthConfig) => void;
  clearAuth: () => void;
}

function loadAuth(): AuthConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AuthConfig) : null;
  } catch {
    return null;
  }
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [auth, setAuthState] = useState<AuthConfig>(loadAuth);

  const setAuth = (newAuth: AuthConfig) => {
    setAuthState(newAuth);
    if (newAuth) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newAuth));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  };

  const clearAuth = () => setAuth(null);

  return (
    <AuthContext.Provider value={{ auth, setAuth, clearAuth }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
};
