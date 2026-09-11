export function developmentDatabaseUrl(source: NodeJS.ProcessEnv): string {
  const value = source.DATABASE_URL;
  if (source.NODE_ENV === 'production' || !value || !URL.canParse(value))
    throw new Error('Explicit local development DATABASE_URL required.');
  const url = new URL(value);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.pathname !== '/omniroute' ||
    url.username !== 'omniroute' ||
    url.search ||
    url.hash
  )
    throw new Error(
      'Refusing development operation on an unrecognized database.',
    );
  return url.href;
}
