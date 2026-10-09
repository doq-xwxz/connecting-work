// Disposable integration fixtures ONLY. Never import into application runtime.
import type { PrismaClient } from "../src/generated/prisma/client";
export async function cleanupModerationFixtures(db: PrismaClient, userIds: string[]) {
  if (process.env.AUTH_TEST_DATABASE !== "disposable" || !process.env.TEST_DATABASE_URL) throw new Error("Disposable test database required");
  const cases = await db.moderationCase.findMany({ where: { openedByAdminUserId: { in: userIds } }, select: { id: true } });
  const ids = cases.map((c) => c.id);
  // ALTER takes a table lock; restores guard before commit, deletes only owned IDs.
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`ALTER TABLE "AuditEvent" DISABLE TRIGGER "Audit_immutable"`;
    await tx.auditEvent.deleteMany({ where: { caseId: { in: ids } } });
    await tx.$executeRaw`ALTER TABLE "AuditEvent" ENABLE TRIGGER "Audit_immutable"`;
    await tx.caseReport.deleteMany({ where: { caseId: { in: ids } } });
    await tx.moderationCase.deleteMany({ where: { id: { in: ids } } });
    await tx.report.deleteMany({ where: { reporterUserId: { in: userIds } } });
    await tx.rateLimit.deleteMany({ where: { key: { in: userIds.map((id) => `report:user:${id}`) } } });
  });
}
