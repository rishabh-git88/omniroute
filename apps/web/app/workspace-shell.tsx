'use client';

import { ConversationWorkspace } from './conversation-workspace';
import { LandingPage } from './landing-page';
import { useAuth } from './auth-provider';

export function WorkspaceShell() {
  return <ConversationWorkspace />;
}

export function WorkspaceOrLanding() {
  const auth = useAuth();
  return auth.status === 'authenticated' ? <WorkspaceShell /> : <LandingPage />;
}
