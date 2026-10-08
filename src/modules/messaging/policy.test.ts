import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { bodySchema, chatPolicy, messagesSchema, newer, pageSchema, readSchema, requireSameBody, sendSchema } from "./contracts";
import { messageDto, notificationDto } from "./projection";
const context = { actorStatus: "ACTIVE", counterpartyBanned: false, application: "APPLIED", engagement: null as string | null, job: "PUBLISHED", blocked: false };
describe("contextual chat policy", () => {
  for (const application of ["APPLIED", "VIEWED", "SHORTLISTED", "OFFERED"]) it(`allows current ${application} relationship including pending offers`, () => expect(chatPolicy({ ...context, application })).toBeNull());
  for (const application of ["REJECTED", "WITHDRAWN", "CANCELLED", "ACCEPTED"]) it(`makes ${application} without active work read-only`, () => expect(chatPolicy({ ...context, application })).toBe("RELATIONSHIP_ENDED"));
  for (const engagement of ["COMPLETED", "CANCELLED"]) it(`makes terminal ${engagement} read-only`, () => expect(chatPolicy({ ...context, engagement })).toBe("RELATIONSHIP_ENDED"));
  for (const engagement of ["ACCEPTED", "IN_PROGRESS"]) it(`preserves scoped ${engagement} chat across block/closed/suspension`, () => expect(chatPolicy({ ...context, application: "ACCEPTED", engagement, blocked: true, job: "CANCELLED", actorStatus: "SUSPENDED" })).toBeNull());
  for (const engagement of [null, "ACCEPTED", "IN_PROGRESS"]) it(`fails closed for banned actor/counterparty with ${engagement}`, () => {
    expect(chatPolicy({ ...context, engagement, actorStatus: "BANNED" })).toBe("ACCOUNT_RESTRICTED"); expect(chatPolicy({ ...context, engagement, counterpartyBanned: true })).toBe("ACCOUNT_RESTRICTED");
  });
  it("blocks pre-engagement contact in either direction", () => expect(chatPolicy({ ...context, blocked: true })).toBe("BLOCKED"));
  it("disallows suspended pre-engagement send", () => expect(chatPolicy({ ...context, actorStatus: "SUSPENDED" })).toBe("ACCOUNT_RESTRICTED"));
  it("keeps CLOSED pending-offer context", () => expect(chatPolicy({ ...context, application: "OFFERED", job: "CLOSED" })).toBeNull());
});
describe("message boundaries", () => {
  for (const body of ["", " \n\t", "\u200b\u200d", "x".repeat(4001), "hello\0", "\x7f", "\ud800"]) it(`rejects invalid text length ${body.length}`, () => expect(bodySchema.safeParse(body).success).toBe(false));
  it("normalizes CRLF/CR and preserves explicit plain HTML text", () => expect(bodySchema.parse("<script>x</script>\r\ny\rz")).toBe("<script>x</script>\ny\nz"));
  it("allows Unicode and maximum length", () => expect(bodySchema.parse("á".repeat(4000))).toHaveLength(4000));
  it("rejects forged author/side/status", () => { for (const key of ["senderUserId", "senderSide", "status"]) expect(sendSchema.safeParse({ creationKey: randomUUID(), body: "hello", [key]: "forged" }).success).toBe(false); });
  it("requires creation key", () => expect(sendSchema.safeParse({ body: "hello" }).success).toBe(false));
  it("bounds pages and disallows mixed cursor directions", () => { expect(messagesSchema.safeParse({ before: randomUUID(), after: randomUUID() }).success).toBe(false); expect(pageSchema.safeParse({ limit: 51 }).success).toBe(false); expect(messagesSchema.safeParse({ after: "x" }).success).toBe(false); });
  it("rejects browser clocks and unrelated read fields", () => expect(readSchema.safeParse({ messageId: randomUUID(), readAt: "now" }).success).toBe(false));
});
describe("read state and DTO", () => {
  const date = new Date("2026-10-08T00:00:00Z");
  it("orders tied timestamps by ID without moving an old tab backwards", () => { expect(newer({ id: "b", createdAt: date }, { id: "a", createdAt: date })).toBe(true); expect(newer({ id: "a", createdAt: date }, { id: "b", createdAt: date })).toBe(false); expect(newer({ id: "a", createdAt: date }, { id: "a", createdAt: date })).toBe(false); });
  it("omits sender identity/account/contact/internal fields", () => {
    const dto = messageDto({ id: randomUUID(), body: "plain text", createdAt: date, senderSide: "WORKER", senderUserId: "private-user", sender: { name: "Display" } }, "private-user");
    expect(dto.own).toBe(true); expect(dto.senderDisplay).toBe("Display"); expect(JSON.stringify(dto)).not.toContain("private-user"); expect(Object.keys(dto).sort()).toEqual(["id", "body", "createdAt", "senderSide", "senderDisplay", "own"].sort());
  });
  it("permits normalized identical retry and conflicts with changed body", () => {
    expect(() => requireSameBody("same\nbody", bodySchema.parse("same\r\nbody"))).not.toThrow();
    expect(() => requireSameBody("original", "changed")).toThrow();
  });
  it("derives only internal notification hrefs and never copies private payload", () => {
    const row = { id: randomUUID(), type: "NEW_MESSAGE" as const, readAt: null, createdAt: date, lastMessageId: randomUUID(), payload: { email: "secret@example.invalid", body: "private message" },
      conversation: { id: randomUUID(), job: { title: "https://untrusted.invalid" }, worker: { userId: "private-user" } } };
    const dto = notificationDto(row, "private-user"); expect(dto.href).toBe(`/worker/messages/${row.conversation.id}`);
    expect(notificationDto(row, "other").href).toBe(`/employer/messages/${row.conversation.id}`);
    expect(JSON.stringify(dto)).not.toMatch(/private-user|secret@example|private message|payload/);
  });
});
