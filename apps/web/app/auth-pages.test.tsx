import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthState } from './auth-state';

const auth = vi.hoisted(() => ({
  status: 'loading' as AuthState['status'],
  session: null,
  refresh: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('./auth-provider', () => ({ useAuth: () => auth }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('./api-url', () => ({
  API_URL: 'https://api.example.com',
  API_V1_URL: 'https://api.example.com/v1',
}));

import { WorkspaceOrLanding } from './workspace-shell';
import { ConversationWorkspace } from './conversation-workspace';
import LoginPage from './login/page';

beforeEach(() => {
  auth.status = 'loading';
});

describe('public and protected auth presentation', () => {
  it.each(['loading', 'anonymous', 'unavailable'] as const)(
    'renders the landing page while auth is %s',
    (status) => {
      auth.status = status;
      const html = renderToStaticMarkup(<WorkspaceOrLanding />);
      expect(html).toContain('Choose the answer, not the provider.');
      expect(html).not.toContain('Loading OneRoute-AI');
    },
  );
  it('shows a retryable outage rather than session-ended messaging', () => {
    auth.status = 'unavailable';
    const html = renderToStaticMarkup(<ConversationWorkspace />);
    expect(html).toContain('not been signed out');
    expect(html).toContain('Try again');
    expect(html).not.toContain('Your session has ended');
  });
  it('renders login and derives Google sign-in exclusively from the configured API', async () => {
    const html = renderToStaticMarkup(
      await LoginPage({ searchParams: Promise.resolve({}) }),
    );
    expect(html).toContain('Sign in to your workspace');
    expect(html).toContain(
      'https://api.example.com/v1/auth/google?returnTo=%2F',
    );
    expect(html).not.toContain('localhost');
  });
});
