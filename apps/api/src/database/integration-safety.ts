import { Client } from 'pg';

export const INTEGRATION_DATABASES = [
  'omniroute_integration',
  'omniroute_integration_upgrade',
] as const;
export const INTEGRATION_MARKER = 'omniroute:disposable-integration:v1';

function checkedUrl(value: string | undefined): URL {
  const refuse = () =>
    new Error(
      'Refusing integration database: use the dedicated local integration URL, role, and database name.',
    );
  if (!value || !URL.canParse(value)) throw refuse();
  const url = new URL(value);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]', 'postgres-integration'].includes(
      url.hostname,
    ) ||
    url.username !== 'omniroute_integration' ||
    !INTEGRATION_DATABASES.some((name) => url.pathname === `/${name}`) ||
    url.search ||
    url.hash
  )
    throw refuse();
  url.protocol = 'postgresql:';
  return url;
}

/** Validate *both* variables before overwriting any environment or connecting. */
export function integrationDatabaseUrl(source: NodeJS.ProcessEnv): string {
  if (source.NODE_ENV && source.NODE_ENV !== 'test') {
    throw new Error('Refusing integration tests outside NODE_ENV=test.');
  }
  const target = checkedUrl(source.DATABASE_TEST_URL);
  if (
    source.DATABASE_URL &&
    checkedUrl(source.DATABASE_URL).href !== target.href
  ) {
    throw new Error(
      'Refusing integration tests: DATABASE_URL and DATABASE_TEST_URL must identify the same isolated target.',
    );
  }
  return target.href;
}

export async function verifiedIntegrationUrl(
  source: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const url = integrationDatabaseUrl(source);
  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    const { rows } = await client.query<{
      name: string;
      role: string;
      marker: string;
      rolsuper: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
    }>(`SELECT current_database() AS name, current_user AS role,
        shobj_description(d.oid, 'pg_database') AS marker,
        r.rolsuper, r.rolcreatedb, r.rolcreaterole
        FROM pg_database d JOIN pg_roles r ON r.rolname = current_user
        WHERE d.datname = current_database()`);
    const row = rows[0];
    if (
      !row ||
      row.name !== new URL(url).pathname.slice(1) ||
      row.role !== 'omniroute_integration' ||
      row.marker !== INTEGRATION_MARKER ||
      row.rolsuper ||
      row.rolcreatedb ||
      row.rolcreaterole
    ) {
      throw new Error('Unrecognized database identity');
    }
  } catch {
    throw new Error(
      'Refusing integration writes: isolated database identity/marker could not be verified.',
    );
  } finally {
    await client.end();
  }
  return url;
}
