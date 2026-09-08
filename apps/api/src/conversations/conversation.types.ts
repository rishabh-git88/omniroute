import type { ConversationMode } from '../generated/prisma/client.js';

export interface CreateConversationCommand {
  mode?: ConversationMode;
  title?: string;
}

export interface CreateMessageCommand {
  content: string;
  idempotencyKey: string;
  modelKey?: string;
}
