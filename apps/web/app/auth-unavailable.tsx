'use client';

import { useState } from 'react';
import { useAuth } from './auth-provider';
import { PRODUCT_NAME } from './brand';

export function AuthUnavailable() {
  const auth = useAuth();
  const [retrying, setRetrying] = useState(false);
  if (auth.status !== 'unavailable') return null;
  return (
    <div className="auth-unavailable" role="alert">
      <p>
        We can’t reach {PRODUCT_NAME} to check your session. You have not been
        signed out.
      </p>
      <button
        type="button"
        disabled={retrying}
        onClick={async () => {
          setRetrying(true);
          try {
            await auth.refresh();
          } finally {
            setRetrying(false);
          }
        }}
      >
        {retrying ? 'Checking…' : 'Try again'}
      </button>
    </div>
  );
}
