import type { CurrentUserResponse } from '@omniroute/types';
import { API_V1_URL } from './api-url';

export type AuthState =
  | { status: 'loading'; session: null }
  | { status: 'anonymous'; session: null }
  | { status: 'unavailable'; session: null }
  | { status: 'authenticated'; session: CurrentUserResponse };

export const AUTH_TIMEOUT_MS = 8000;

export async function loadAuthState(): Promise<AuthState> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_V1_URL}/auth/me`, {
      cache: 'no-store',
      credentials: 'include',
      signal: controller.signal,
    });
    if (response.status === 401) return { session: null, status: 'anonymous' };
    if (!response.ok) return { session: null, status: 'unavailable' };
    const session = (await response.json()) as CurrentUserResponse;
    if (!session?.user?.id || !session.workspace?.id || !session.csrfToken) {
      return { session: null, status: 'unavailable' };
    }
    return { session, status: 'authenticated' };
  } catch {
    return { session: null, status: 'unavailable' };
  } finally {
    clearTimeout(timeout);
  }
}
