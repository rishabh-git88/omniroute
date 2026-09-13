import { describe, expect, it } from 'vitest';
import { InMemoryObjectStorage } from './object-storage.js';
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
