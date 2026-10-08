import { ConversationPage } from "@/modules/messaging/pages";
export default async function Page({ params }: { params: Promise<{ conversationId: string }> }) {
  return <ConversationPage side="WORKER" id={(await params).conversationId} />;
}
