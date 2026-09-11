import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Client } from 'pg';

export async function verifyMigrationHistory(
  client: Client,
  directory: string,
  requireAll = true,
): Promise<void> {
  const migrations = (await readdir(directory))
    .filter((name) => /^\d+_/.test(name))
    .sort();
  const exists = await client.query(
    "SELECT to_regclass('public._prisma_migrations') AS table_name",
  );
  const rows = exists.rows[0]?.table_name
    ? (
        await client.query<{
          migration_name: string;
          checksum: string;
          finished_at: Date | null;
          rolled_back_at: Date | null;
        }>(
          'SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY started_at',
        )
      ).rows
    : [];
  for (const row of rows.filter((item) => !item.rolled_back_at)) {
    if (!migrations.includes(row.migration_name) || !row.finished_at)
      throw new Error(
        'Migration history contains an unknown or failed migration; refusing automatic repair.',
      );
    const checksum = createHash('sha256')
      .update(
        await readFile(join(directory, row.migration_name, 'migration.sql')),
      )
      .digest('hex');
    if (checksum !== row.checksum)
      throw new Error(
        `Applied migration checksum differs: ${row.migration_name}`,
      );
  }
  if (
    requireAll &&
    migrations.some(
      (name) =>
        !rows.some(
          (row) =>
            row.migration_name === name &&
            row.finished_at &&
            !row.rolled_back_at,
        ),
    )
  ) {
    throw new Error('Expected migrations have not all been applied.');
  }
}

export async function verifyMemorySchema(client: Client): Promise<void> {
  const { rows } = await client.query(`SELECT
    EXISTS (SELECT 1 FROM pg_extension WHERE extname='vector') AS vector,
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='memories' AND column_name='source_hash') AS source_hash,
    to_regclass('public.embeddings_file_chunk_id_embedding_model_model_version_key') IS NOT NULL AS embedding_identity,
    to_regclass('public.embeddings_source_kind_content_hash_embedding_model_model_v_key') IS NULL AS old_identity_removed,
    to_regclass('public.file_chunks_content_fts_idx') IS NOT NULL AS text_index,
    to_regclass('public.embeddings_workspace_vector_cosine_idx') IS NOT NULL AS vector_index,
    to_regclass('public.memories_conversation_id_valid_version_idx') IS NOT NULL AS memory_index`);
  if (!Object.values(rows[0] ?? {}).every((value) => value === true))
    throw new Error('Workspace memory schema verification failed.');
}
