import { NodeSDK } from '@opentelemetry/sdk-node';

let sdk: NodeSDK | undefined;

/**
 * Starts the vendor-neutral OpenTelemetry SDK before Nest loads application
 * modules. Export is configured entirely through standard OTEL_* variables.
 */
export function startTelemetry(): void {
  if (process.env.OTEL_SDK_DISABLED === 'true' || sdk) return;

  sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'omniroute-api',
  });
  sdk.start();
}

export async function stopTelemetry(): Promise<void> {
  await sdk?.shutdown();
  sdk = undefined;
}
