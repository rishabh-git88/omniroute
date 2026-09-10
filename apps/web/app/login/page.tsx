import Link from 'next/link';

import { API_V1_URL } from '../api-url';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const loginUrl = new URL(`${API_V1_URL}/auth/google`);
  loginUrl.searchParams.set('returnTo', '/');

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <Link className="brand" href="/login">
          <span className="brand-mark">O</span>
          OmniRoute
        </Link>
        <p className="eyebrow">Your models. One memory.</p>
        <h1 id="login-title">Sign in to your workspace</h1>
        <p className="login-copy">
          Compare answers, choose the strongest path, and change providers
          without starting over.
        </p>
        {error ? (
          <p className="login-error" role="alert">
            Google sign-in could not be completed. Please try again.
          </p>
        ) : null}
        <a className="google-button" href={loginUrl.toString()}>
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path
              d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.41Z"
              fill="#4285F4"
            />
            <path
              d="M12 22c2.7 0 4.98-.9 6.63-2.36l-3.24-2.54c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z"
              fill="#34A853"
            />
            <path
              d="M6.39 13.93A6.02 6.02 0 0 1 6.08 12c0-.67.11-1.32.31-1.93V7.45H3.04A10 10 0 0 0 2 12c0 1.61.38 3.14 1.04 4.55l3.35-2.62Z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.94c1.47 0 2.79.51 3.83 1.5L18.7 4.57A9.64 9.64 0 0 0 12 2a10 10 0 0 0-8.96 5.45l3.35 2.62C7.18 7.7 9.39 5.94 12 5.94Z"
              fill="#EA4335"
            />
          </svg>
          Continue with Google
        </a>
        <p className="privacy-note">
          OmniRoute stores your account identity and a hashed session—not your
          Google access token.
        </p>
      </section>
    </main>
  );
}
