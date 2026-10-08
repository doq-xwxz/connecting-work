-- CreateEnum
CREATE TYPE "MessageSide" AS ENUM ('WORKER', 'EMPLOYER');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('NEW_MESSAGE');

-- Text-only immutable history; account deletion cannot cascade marketplace data.

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "workerProfileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastMessageAt" TIMESTAMP(3),

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderUserId" TEXT NOT NULL,
    "senderSide" "MessageSide" NOT NULL,
    "body" TEXT NOT NULL,
    "creationKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationReadState" (
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadMessageId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationReadState_pkey" PRIMARY KEY ("conversationId","userId")
);

-- CreateTable
CREATE TABLE "UserBlock" (
    "blockerUserId" TEXT NOT NULL,
    "blockedUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserBlock_pkey" PRIMARY KEY ("blockerUserId","blockedUserId")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL DEFAULT 'NEW_MESSAGE',
    "conversationId" TEXT NOT NULL,
    "lastMessageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_applicationId_key" ON "Conversation"("applicationId");

-- CreateIndex
CREATE INDEX "Conversation_workerProfileId_id_idx" ON "Conversation"("workerProfileId", "id");

-- CreateIndex
CREATE INDEX "Conversation_jobId_id_idx" ON "Conversation"("jobId", "id");

-- CreateIndex
CREATE INDEX "Conversation_lastMessageAt_id_idx" ON "Conversation"("lastMessageAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_jobId_workerProfileId_key" ON "Conversation"("jobId", "workerProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_applicationId_jobId_workerProfileId_key" ON "Conversation"("applicationId", "jobId", "workerProfileId");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_id_idx" ON "Message"("conversationId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Message_senderUserId_idx" ON "Message"("senderUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Message_conversationId_senderUserId_creationKey_key" ON "Message"("conversationId", "senderUserId", "creationKey");

-- CreateIndex
CREATE UNIQUE INDEX "Message_id_conversationId_key" ON "Message"("id", "conversationId");

-- CreateIndex
CREATE INDEX "ConversationReadState_userId_conversationId_idx" ON "ConversationReadState"("userId", "conversationId");

-- CreateIndex
CREATE INDEX "UserBlock_blockedUserId_blockerUserId_idx" ON "UserBlock"("blockedUserId", "blockerUserId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_id_idx" ON "Notification"("userId", "readAt", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Notification_conversationId_idx" ON "Notification"("conversationId");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_applicationId_jobId_workerProfileId_fkey" FOREIGN KEY ("applicationId", "jobId", "workerProfileId") REFERENCES "Application"("id", "jobId", "workerProfileId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_workerProfileId_fkey" FOREIGN KEY ("workerProfileId") REFERENCES "WorkerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationReadState" ADD CONSTRAINT "ConversationReadState_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationReadState" ADD CONSTRAINT "ConversationReadState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationReadState" ADD CONSTRAINT "ConversationReadState_lastReadMessageId_conversationId_fkey" FOREIGN KEY ("lastReadMessageId", "conversationId") REFERENCES "Message"("id", "conversationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_blockerUserId_fkey" FOREIGN KEY ("blockerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_blockedUserId_fkey" FOREIGN KEY ("blockedUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_lastMessageId_conversationId_fkey" FOREIGN KEY ("lastMessageId", "conversationId") REFERENCES "Message"("id", "conversationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_not_self" CHECK ("blockerUserId" <> "blockedUserId");
ALTER TABLE "Message" ADD CONSTRAINT "Message_body_bounds" CHECK (char_length("body") BETWEEN 1 AND 4000 AND char_length(btrim("body", E' \n\r\t')) > 0);
CREATE UNIQUE INDEX "Notification_one_unread_conversation" ON "Notification" ("conversationId", "userId") WHERE "readAt" IS NULL;

CREATE FUNCTION protect_message_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Immutable message';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Message_immutable" BEFORE UPDATE ON "Message" FOR EACH ROW EXECUTE FUNCTION protect_message_history();
