export type RoutingMode = 'economy' | 'smart' | 'max';
export type ConversationMode = 'SINGLE' | 'COMPARE';

/** The composer sends this server-owned mode when starting a new conversation. */
export function createConversationCommand(mode: ConversationMode) {
  return { mode };
}

export function conversationCommand(
  content: string,
  routingMode: RoutingMode,
  modelKey = '',
) {
  return { content, routingMode, ...(modelKey ? { modelKey } : {}) };
}

export function canAttemptModel(health: string): boolean {
  return ['enabled', 'available', 'ready'].includes(health);
}
