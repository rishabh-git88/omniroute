'use client';

import Link from 'next/link';

import { AuthUnavailable } from './auth-unavailable';

export function LandingPage() {
  return (
    <main className="landing-page">
      <nav className="landing-nav" aria-label="Main navigation">
        <Link className="brand brand-dark" href="/">
          <span className="brand-mark">O</span>
          OmniRoute
        </Link>
        <Link className="nav-sign-in" href="/login">
          Sign in
        </Link>
      </nav>
      <AuthUnavailable />

      <section className="landing-hero" aria-labelledby="landing-title">
        <p className="landing-kicker">
          One calm place for every AI conversation
        </p>
        <h1 id="landing-title">Choose the answer, not the provider.</h1>
        <p>
          Ask naturally. OmniRoute handles the routing underneath, lets you
          compare when it matters, and keeps the context you chose intact.
        </p>
        <div className="landing-actions">
          <Link className="landing-primary" href="/login">
            Continue with Google
          </Link>
          <a className="landing-secondary" href="#how-it-works">
            See how it works
          </a>
        </div>
      </section>

      <section
        className="landing-proof"
        id="how-it-works"
        aria-label="How OmniRoute works"
      >
        <article>
          <span>01</span>
          <h2>Start with a question</h2>
          <p>
            Use Smart for a focused answer, or choose a different route when the
            task calls for it.
          </p>
        </article>
        <article>
          <span>02</span>
          <h2>See the reasoning</h2>
          <p>
            Every response keeps its model label and a plain-language routing
            explanation.
          </p>
        </article>
        <article>
          <span>03</span>
          <h2>Keep the good thread</h2>
          <p>
            Continue with the answer you prefer. Your selected context follows
            without the noise.
          </p>
        </article>
      </section>
    </main>
  );
}
