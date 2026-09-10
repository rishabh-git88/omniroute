import { z } from 'zod';

/** Origins only: never accept credentials, paths, queries, or fragments. */
export const httpOriginSchema = z
  .url()
  .refine((value) => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash &&
      !value.includes('?') &&
      !value.includes('#')
    );
  }, 'must be an HTTP(S) origin without credentials, path, query, or fragment')
  .transform((value) => new URL(value).origin);

export function isProductionOrigin(value: string): boolean {
  const url = new URL(value);
  const hostname = url.hostname.replace(/\.$/, '');
  return (
    url.protocol === 'https:' &&
    hostname !== 'localhost' &&
    !hostname.endsWith('.localhost') &&
    !hostname.endsWith('.local') &&
    hostname.includes('.') &&
    !/^[\d.]+$/.test(hostname) &&
    !hostname.includes(':')
  );
}
