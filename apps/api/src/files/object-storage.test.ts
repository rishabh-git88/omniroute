import { describe, expect, it } from 'vitest';
import {
  InMemoryObjectStorage,
  SupabaseObjectStorage,
} from './object-storage.js';
describe('private deterministic object storage', () => {
  it('does not expose an object after deletion', async () => {
    const storage = new InMemoryObjectStorage();
    await storage.put({
      key: 'workspace/a/files/b/source',
      contentType: 'text/plain',
      body: Buffer.from('private'),
    });
    expect(await storage.exists('workspace/a/files/b/source')).toBe(true);
    expect(
      (await storage.get('workspace/a/files/b/source')).body.toString(),
    ).toBe('private');
    await storage.delete('workspace/a/files/b/source');
    await expect(storage.get('workspace/a/files/b/source')).rejects.toThrow(
      'OBJECT_NOT_FOUND',
    );
  });
});

describe('native Supabase private object storage', () => {
  it('uses opaque caller-supplied keys without producing a public URL', async () => {
    const objects = new Map<string, { body: Blob; contentType: string }>();
    const client = {
      storage: {
        from: () => ({
          upload: async (
            key: string,
            body: Buffer,
            options: { contentType: string },
          ) => {
            objects.set(key, {
              body: new Blob([body.toString('utf8')], {
                type: options.contentType,
              }),
              contentType: options.contentType,
            });
            return { error: null };
          },
          download: async (key: string) => {
            const object = objects.get(key);
            return object
              ? { data: object.body, error: null }
              : { data: null, error: { statusCode: 404 } };
          },
          remove: async (keys: string[]) => {
            keys.forEach((key) => objects.delete(key));
            return { error: null };
          },
        }),
      },
    };
    const storage = new SupabaseObjectStorage(
      {
        bucket: 'omniroute-files',
        serviceRoleKey: 'not-a-real-secret',
        url: 'https://project.supabase.co',
      },
      client as never,
    );
    const key = 'workspace/workspace-a/files/file-a/source';
    await storage.put({
      body: Buffer.from('private'),
      contentType: 'text/plain',
      key,
    });
    expect(await storage.exists(key)).toBe(true);
    expect((await storage.get(key)).body.toString()).toBe('private');
    await storage.delete(key);
    expect(await storage.exists(key)).toBe(false);
  });

  it('normalizes Supabase failures without surfacing upstream details', async () => {
    const storage = new SupabaseObjectStorage(
      {
        bucket: 'omniroute-files',
        serviceRoleKey: 'not-a-real-secret',
        url: 'https://project.supabase.co',
      },
      {
        storage: {
          from: () => ({
            upload: async () => ({
              error: {
                message: 'sensitive upstream endpoint',
                statusCode: 500,
              },
            }),
          }),
        },
      } as never,
    );
    await expect(
      storage.put({
        body: Buffer.from('private'),
        contentType: 'text/plain',
        key: 'workspace/a/files/b/source',
      }),
    ).rejects.toThrow('SUPABASE_STORAGE_ERROR');
  });
});
