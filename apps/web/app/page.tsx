import { parseWebEnvironment } from '@omniroute/config/web';
import { Button } from '@omniroute/ui';

const services = [
  ['Next.js web', 'Workspace and streaming presentation'],
  ['NestJS API', 'Identity, conversations, credits, and durable state'],
  ['FastAPI router', 'Provider-neutral orchestration boundary'],
] as const;

export default function Home() {
  const environment = parseWebEnvironment({
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col justify-center px-6 py-16 sm:px-10">
      <p className="mb-4 font-mono text-sm uppercase tracking-[0.3em] text-cyan-300">
        Phase 1 foundation
      </p>
      <h1 className="max-w-4xl text-5xl font-semibold tracking-tight sm:text-7xl">
        Your conversation stays. Your AI can change.
      </h1>
      <p className="mt-6 max-w-2xl text-lg leading-8 text-zinc-400">
        OmniRoute is starting with explicit service boundaries, provider-neutral
        contracts, and durable state before provider integrations are enabled.
      </p>

      <section
        className="mt-12 grid gap-4 md:grid-cols-3"
        aria-label="Service boundaries"
      >
        {services.map(([name, responsibility]) => (
          <article
            className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-6"
            key={name}
          >
            <h2 className="font-semibold text-zinc-100">{name}</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              {responsibility}
            </p>
          </article>
        ))}
      </section>

      <div className="mt-10 flex flex-wrap items-center gap-4">
        <Button disabled>Start a conversation</Button>
        <span className="font-mono text-xs text-zinc-500">
          API: {environment.NEXT_PUBLIC_API_BASE_URL}
        </span>
      </div>
    </main>
  );
}
