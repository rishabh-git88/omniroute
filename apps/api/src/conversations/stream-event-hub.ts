import { Injectable } from '@nestjs/common';

export interface ConversationStreamEvent {
  data: Record<string, unknown>;
  id: number;
  type: 'content.delta' | 'run.status' | 'run.error';
}

type Subscriber = (event: ConversationStreamEvent) => void;

@Injectable()
export class StreamEventHub {
  private readonly events = new Map<string, ConversationStreamEvent[]>();
  private readonly subscribers = new Map<string, Set<Subscriber>>();
  private nextId = 1;

  public history(groupId: string, afterId = 0): ConversationStreamEvent[] {
    return (this.events.get(groupId) ?? []).filter(
      (event) => event.id > afterId,
    );
  }

  public publish(
    groupId: string,
    type: ConversationStreamEvent['type'],
    data: ConversationStreamEvent['data'],
  ): ConversationStreamEvent {
    const event = { data, id: this.nextId++, type };
    const history = this.events.get(groupId) ?? [];
    history.push(event);
    // The database is canonical; the hub only supplies the short replay window.
    if (history.length > 500) history.shift();
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
