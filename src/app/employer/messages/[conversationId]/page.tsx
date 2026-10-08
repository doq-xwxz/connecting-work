import { ConversationPage } from "@/modules/messaging/pages";
export default async function Page({ params }: { params: Promise<{ conversationId: string }> }) {
  return <ConversationPage side="EMPLOYER" id={(await params).conversationId} />;
}
