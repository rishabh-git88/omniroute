import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ContextBuilderService } from './context-builder.service.js';
import {
  estimateTokens,
  enforceBudget,
  modelBudget,
} from './context-budget.js';
import { contextHash, readFrozen, snapshotData } from './frozen-context.js';
import type { PrismaService } from '../database/prisma.service.js';
import type { MemoryRepository } from './memory.repository.js';
import type { SemanticRetrievalService } from './semantic-retrieval.service.js';

const ids = Array.from({ length: 8 }, () => randomUUID());
function fixture(parentContent = 'chosen answer') {
  const current = {
    id: ids[0],
    userContent: 'second question',
    parentResponseId: ids[1],
  };
  const parent = {
    id: ids[1],
    turnId: ids[2],
    content: parentContent,
    turn: { id: ids[2], userContent: 'first question', parentResponseId: null },
  };
  const db = {
    client: {
      turn: { findFirst: vi.fn().mockResolvedValue(current) },
      modelResponse: { findFirst: vi.fn().mockResolvedValue(parent) },
    },
  };
  const memories = { findActive: vi.fn().mockResolvedValue([]) };
  const retrieval = {
    retrieveSafely: vi
      .fn()
      .mockResolvedValue({ chunks: [], status: 'unavailable' }),
  };
  const builder = new ContextBuilderService(
    db as unknown as PrismaService,
    memories as unknown as MemoryRepository,
    retrieval as unknown as SemanticRetrievalService,
  );
  const input = {
    conversationId: ids[3]!,
    workspaceId: ids[4]!,
    userId: ids[5]!,
    turnId: ids[0]!,
    userRequest: 'untrusted supplied text',
    maxInputTokens: 2000,
  };
  return { builder, db, memories, retrieval, input, current, parent };
}
describe('canonical context', () => {
  it('preserves user/assistant chronology and loads the stored prompt', async () => {
    const f = fixture();
    const context = await f.builder.build(f.input);
    expect(context.messages).toEqual([
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: 'chosen answer' },
      { role: 'user', content: 'second question' },
    ]);
    expect(context.retrieval).toBe('unavailable');
    expect(context.provenance?.map((item) => item.id)).toEqual([
      ids[2],
      ids[1],
      ids[0],
    ]);
  });
  it('follows the persisted selected branch, never sibling answers', async () => {
    const f = fixture('selected alternative');
    const context = await f.builder.build(f.input);
    expect(context.messages[1]?.content).toBe('selected alternative');
    expect(f.db.client.modelResponse.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ids[1], turn: { conversationId: ids[3] } },
      }),
    );
  });
  it('rejects cyclic and missing ancestors', async () => {
    const f = fixture();
    f.parent.turn.parentResponseId = ids[1] as unknown as null;
    await expect(f.builder.build(f.input)).rejects.toThrow('cyclic');
    f.db.client.modelResponse.findFirst.mockResolvedValue(null);
    await expect(f.builder.build(f.input)).rejects.toThrow('invalid');
  });
  it('trims only whole history pairs and records omissions', async () => {
    const f = fixture();
    f.input.maxInputTokens = estimateTokens([
      { role: 'user', content: f.current.userContent },
    ]);
    const context = await f.builder.build(f.input);
    expect(context.messages).toEqual([
      { role: 'user', content: 'second question' },
    ]);
    expect(context.provenance?.map((item) => item.included)).toEqual([
      false,
      false,
      true,
    ]);
  });
  it('never truncates mandatory rules or the current prompt', async () => {
    const f = fixture();
    f.memories.findActive.mockResolvedValue([
      {
        id: ids[6],
        version: 1,
        kind: 'WORKSPACE_RULE',
        content: 'x'.repeat(3000),
      },
    ]);
    await expect(f.builder.build(f.input)).rejects.toThrow('exceed');
  });
  it('keeps oversized optional material out and records its provenance', async () => {
    const f = fixture();
    f.retrieval.retrieveSafely.mockResolvedValue({
      chunks: [{ id: ids[6], fileId: ids[7], content: 'x'.repeat(3000) }],
      status: 'semantic',
    });
    const context = await f.builder.build(f.input);
    expect(context.tokenEstimate).toBeLessThanOrEqual(f.input.maxInputTokens);
    expect(context.provenance?.at(-1)?.included).toBe(false);
  });
  it('round-trips frozen input independently of live memory and JSON key order', async () => {
    const f = fixture();
    const context = await f.builder.build(f.input);
    const snapshot = snapshotData(ids[7]!, context, {
      contextWindow: 4000,
      maxOutputTokens: 512,
    });
    f.current.userContent = 'changed';
    const persisted = JSON.parse(JSON.stringify(snapshot));
    expect(readFrozen(persisted)).toEqual(context);
    expect(
      contextHash({
        ...context,
        messages: context.messages.map((message) => ({
          content: message.content,
          role: message.role,
        })),
      }),
    ).toBe(snapshot.snapshotHash);
    persisted.payload.context.messages[0].content = 'tampered';
    expect(() => readFrozen(persisted)).toThrow('integrity');
    expect(() => readFrozen({ payload: null, snapshotHash: 'legacy' })).toThrow(
      'legacy',
    );
  });
});
describe('model context budgets', () => {
  it('uses a conservative UTF-8 bound for code, CJK, emoji and unbroken text', () => {
    for (const text of [
      '漢字'.repeat(100),
      '😀'.repeat(100),
      'x'.repeat(1000),
      'const x={a:1};',
    ]) {
      expect(
        estimateTokens([{ role: 'user', content: text }]),
      ).toBeGreaterThanOrEqual(Buffer.byteLength(text));
    }
  });
  it('rejects missing, invalid, and impossible registry limits', () => {
    for (const capabilities of [
      {},
      { contextWindow: 1000 },
      { contextWindow: 1000, maxOutputTokens: 2000 },
      { contextWindow: 100, maxOutputTokens: 100 },
    ])
      expect(() => modelBudget(capabilities)).toThrow();
  });
  it('rejects a smaller alternative without altering the frozen context', async () => {
    const f = fixture();
    const context = await f.builder.build(f.input);
    const before = JSON.stringify(context);
    expect(() =>
      enforceBudget(
        context,
        modelBudget({ contextWindow: 700, maxOutputTokens: 512 }),
      ),
    ).toThrow('does not fit');
    expect(JSON.stringify(context)).toBe(before);
    expect(() =>
      enforceBudget(
        { ...context, tokenEstimate: 0 },
        modelBudget({ contextWindow: 4000, maxOutputTokens: 512 }),
      ),
    ).toThrow();
  });
});
