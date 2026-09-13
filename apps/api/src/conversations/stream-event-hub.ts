import { Injectable } from '@nestjs/common';

export interface ConversationStreamEvent {
  data: Record<string, unknown>;
  id: number;
  /** Monotonic hub position used as the SSE Last-Event-ID cursor. */
  position: number;
  /** Monotonic sequence within an individual model run, when the event has one. */
  runSequence?: number;
  type:
    | 'content.delta'
    | 'run.status'
    | 'run.error'
    | 'fallback.started'
    | 'stream.reset';
}

type Subscriber = (event: ConversationStreamEvent) => void;

@Injectable()
export class StreamEventHub {
  /** The hub is a bounded convenience cache; PostgreSQL remains authoritative. */
  public static readonly MAX_REPLAY_EVENTS = 500;
  private readonly events = new Map<string, ConversationStreamEvent[]>();
  private readonly subscribers = new Map<string, Set<Subscriber>>();
  private readonly runSequences = new Map<string, number>();
  private nextId = 1;

  public history(groupId: string, afterId = 0): ConversationStreamEvent[] {
    return (this.events.get(groupId) ?? []).filter(
      (event) => event.id > afterId,
    );
  }

  public replay(
    groupId: string,
    afterId = 0,
  ): {
    events: ConversationStreamEvent[];
    resetRequired: boolean;
  } {
    const history = this.events.get(groupId) ?? [];
    const first = history.at(0)?.id;
    // A process restart has no history. A cursor into a discarded buffer must
    // reload the durable representation rather than risk an incomplete replay.
    const latest = history.at(-1)?.id;
    const resetRequired =
      afterId > 0 &&
      (!first ||
        first > afterId + 1 ||
        (latest !== undefined && afterId > latest));
    return {
      events: resetRequired
        ? []
        : history.filter((event) => event.id > afterId),
      resetRequired,
    };
  }

  public latestId(groupId: string): number {
    return this.events.get(groupId)?.at(-1)?.id ?? 0;
  }

  public publish(
    groupId: string,
    type: ConversationStreamEvent['type'],
    data: ConversationStreamEvent['data'],
  ): ConversationStreamEvent {
    const runId = typeof data.runId === 'string' ? data.runId : undefined;
    const event: ConversationStreamEvent = {
      data,
      id: this.nextId++,
      position: this.nextId - 1,
      type,
      ...(runId
        ? {
            runSequence: (this.runSequences.get(runId) ?? 0) + 1,
          }
        : {}),
    };
    if (runId) {
      this.runSequences.set(runId, event.runSequence!);
      event.data = {
        ...data,
        eventPosition: event.position,
        runSequence: event.runSequence,
      };
    }
    const history = this.events.get(groupId) ?? [];
    history.push(event);
    // The database is canonical; the hub only supplies the short replay window.
    if (history.length > StreamEventHub.MAX_REPLAY_EVENTS) history.shift();
    this.events.set(groupId, history);
    for (const subscriber of this.subscribers.get(groupId) ?? [])
      subscriber(event);
    return event;
  }

  public subscribe(groupId: string, subscriber: Subscriber): () => void {
    const subscribers = this.subscribers.get(groupId) ?? new Set<Subscriber>();
    subscribers.add(subscriber);
    this.subscribers.set(groupId, subscribers);
    return () => {
      subscribers.delete(subscriber);
      if (subscribers.size === 0) this.subscribers.delete(groupId);
    };
  }
}
