export type RoutingMode = 'economy' | 'smart' | 'max';

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
