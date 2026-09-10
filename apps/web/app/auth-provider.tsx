'use client';

import type { CurrentUserResponse } from '@omniroute/types';
import { useRouter } from 'next/navigation';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { API_V1_URL } from './api-url';

type AuthState =
  | { status: 'loading'; session: null }
  | { status: 'anonymous'; session: null }
  | { status: 'authenticated'; session: CurrentUserResponse };

type AuthContextValue = AuthState & {
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function loadAuthState(): Promise<AuthState> {
  try {
    const response = await fetch(`${API_V1_URL}/auth/me`, {
      cache: 'no-store',
      credentials: 'include',
    });
    if (response.status === 401) return { session: null, status: 'anonymous' };
    if (!response.ok) throw new Error('Unable to load your session');
    return {
      session: (await response.json()) as CurrentUserResponse,
      status: 'authenticated',
    };
  } catch {
    return { session: null, status: 'anonymous' };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<AuthState>({
    session: null,
    status: 'loading',
  });

  const refresh = useCallback(async () => {
    setState(await loadAuthState());
  }, []);

  useEffect(() => {
    let active = true;
    void loadAuthState().then((nextState) => {
      if (active) setState(nextState);
    });
    return () => {
      active = false;
    };
  }, []);

  const signOut = useCallback(async () => {
    if (state.status !== 'authenticated') return;
    const response = await fetch(`${API_V1_URL}/auth/logout`, {
      credentials: 'include',
      headers: { 'x-csrf-token': state.session.csrfToken },
      method: 'POST',
    });
    if (!response.ok && response.status !== 401)
      throw new Error('Unable to sign out');
    setState({ session: null, status: 'anonymous' });
    router.replace('/login');
    router.refresh();
  }, [router, state]);

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
