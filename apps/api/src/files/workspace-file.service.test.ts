import { describe, expect, it, vi } from 'vitest';
import { WorkspaceFileService } from './workspace-file.service.js';

describe('file processing recovery', () => {
  it('recovers only a bounded stale processing batch without reading objects', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const metrics = { recordFileEvent: vi.fn() };
    const service = new WorkspaceFileService(
      { client: { workspaceFile: { findMany, updateMany } } } as never,
      {} as never,
      {} as never,
      {} as never,
      { get: vi.fn(), put: vi.fn(), delete: vi.fn(), exists: vi.fn() },
      metrics as never,
    );
    const result = await service.recoverStaleProcessing(500);
    expect(result).toBe(2);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 200 }),
    );
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          processingErrorCode: 'FILE_PROCESSING_INTERRUPTED',
          processingStatus: 'FAILED',
        }),
      }),
    );
    expect(metrics.recordFileEvent).toHaveBeenCalledTimes(2);
  });
});
