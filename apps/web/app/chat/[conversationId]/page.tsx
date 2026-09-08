import { ConversationWorkspace } from '../../conversation-workspace';

export default async function ChatPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  return <ConversationWorkspace initialConversationId={conversationId} />;
}
