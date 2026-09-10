'use client';

import { useRouter } from 'next/navigation';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { API_V1_URL } from './api-url';
import { loadAuthState, type AuthState } from './auth-state';

type AuthContextValue = AuthState & {
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<AuthState>({
    session: null,
    status: 'loading',
  });
  const generation = useRef(0);
  const invalidatePendingRequests = useCallback(() => {
    generation.current++;
  }, []);

  const refresh = useCallback(async () => {
    const requestGeneration = ++generation.current;
    const nextState = await loadAuthState();
    if (generation.current === requestGeneration) setState(nextState);
  }, []);

  useEffect(() => {
    void refresh();
    return invalidatePendingRequests;
  }, [refresh, invalidatePendingRequests]);

  const signOut = useCallback(async () => {
    if (state.status !== 'authenticated') return;
    const response = await fetch(`${API_V1_URL}/auth/logout`, {
      credentials: 'include',
      headers: { 'x-csrf-token': state.session.csrfToken },
      method: 'POST',
    });
    if (!response.ok && response.status !== 401)
      throw new Error('Unable to sign out');
    invalidatePendingRequests();
    setState({ session: null, status: 'anonymous' });
    router.replace('/login');
    router.refresh();
  }, [router, state, invalidatePendingRequests]);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, refresh, signOut }),
    [refresh, signOut, state],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
