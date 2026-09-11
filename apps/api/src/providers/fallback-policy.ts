/** Only failures that may succeed elsewhere, before visible output. No retries of one attempt. */
export function permitsFallback(
  code: string | undefined,
  content: string,
  count: number,
): boolean {
  return (
    content.length === 0 &&
    count < 2 &&
    [
      'PROVIDER_DISABLED',
      'PROVIDER_MISSING_CREDENTIALS',
      'PROVIDER_UNAVAILABLE',
      'PROVIDER_TIMEOUT',
      'ROUTER_TIMEOUT',
      'NETWORK_ERROR',
      'PROVIDER_TEMPORARY_ERROR',
      'RATE_LIMITED',
      'STREAM_TRUNCATED',
      'PROVIDER_PROTOCOL_ERROR',
      'USAGE_MISSING',
    ].includes(code ?? '')
  );
}
