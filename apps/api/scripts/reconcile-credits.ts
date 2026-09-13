import { createDatabaseClient } from '../src/database/database-client.js';
import { MetricsService } from '../src/observability/metrics.service.js';
import { CreditBillingService } from '../src/usage/credit-billing.service.js';
import { CreditLedgerRepository } from '../src/usage/credit-ledger.repository.js';
import { CreditReconciliationService } from '../src/usage/credit-reconciliation.service.js';
import { UsageRepository } from '../src/usage/usage.repository.js';

const confirmation = 'reconcile-stale-credit-reservations';
if (process.env.CREDIT_RECONCILE_CONFIRM !== confirmation)
  throw new Error(
    'Refusing credit reconciliation without CREDIT_RECONCILE_CONFIRM.',
  );
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const batch = Number(process.env.CREDIT_RECONCILE_BATCH ?? '50');
if (!Number.isSafeInteger(batch) || batch < 1 || batch > 200)
  throw new Error('CREDIT_RECONCILE_BATCH must be an integer from 1 to 200.');

const client = createDatabaseClient(process.env.DATABASE_URL);
// The reconciliation service is deliberately constructed from the same durable
// repositories as the API. It has no provider transport, prompt, or secret use.
const database = { client };
const metrics = new MetricsService();
const ledger = new CreditLedgerRepository(database as never);
const usage = new UsageRepository(database as never);
const billing = new CreditBillingService(
  database as never,
  ledger,
  metrics,
  usage,
);
const reconciler = new CreditReconciliationService(
  billing,
  database as never,
  metrics,
);
try {
  const summary = await reconciler.reconcileBatch({ batchSize: batch });
  console.log(JSON.stringify(summary));
} finally {
  await client.$disconnect();
}
