import { createDatabaseClient } from '../src/database/database-client.js';
import { WorkspaceFileRepository } from '../src/files/workspace-file.repository.js';
import { WorkspaceFileService } from '../src/files/workspace-file.service.js';
import { MetricsService } from '../src/observability/metrics.service.js';

if (process.env.FILE_RECOVERY_CONFIRM !== 'recover-stale-file-processing')
  throw new Error(
    'Refusing file recovery without FILE_RECOVERY_CONFIRM=recover-stale-file-processing.',
  );
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const batch = Number(process.env.FILE_RECOVERY_BATCH ?? '50');
if (!Number.isSafeInteger(batch) || batch < 1 || batch > 200)
  throw new Error('FILE_RECOVERY_BATCH must be an integer from 1 to 200.');

const client = createDatabaseClient(process.env.DATABASE_URL);
const database = { client };
const metrics = new MetricsService();
// Recovery updates only durable file state; it neither reads source objects nor
// invokes extraction, embeddings, provider APIs, or document content logging.
const files = new WorkspaceFileService(
  database as never,
  new WorkspaceFileRepository(database as never),
  {} as never,
  {} as never,
  {} as never,
  metrics,
);
try {
  console.log(
    JSON.stringify({ recovered: await files.recoverStaleProcessing(batch) }),
  );
} finally {
  await client.$disconnect();
}
