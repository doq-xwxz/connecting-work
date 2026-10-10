import { expect, it } from "vitest";
import { productEvent } from "./contracts";
const resourceId = "69ab105b-4795-4913-b95b-aa0bf37e5ca5";
const input = { name: "message_sent", actorRole: "WORKER", resourceId, properties: {} };
it("projects a stable v1 event without identity/content", () => {
  const event = productEvent(input, "test")!;
  expect(event.schemaVersion).toBe(1);
  expect(event.eventKey).toBe(`v1:message_sent:${resourceId}:once`);
  expect(event).not.toHaveProperty("actorId");
  expect(productEvent(input, "test")?.eventKey).toBe(event.eventKey);
});
it("rejects PII/payload/version injection and unknown event names", () => {
  for (const key of ["email", "phone", "token", "ip", "body", "schedule", "reason", "query", "schemaVersion", "actorId"]) {
    expect(productEvent({ ...input, [key]: "sensitive" }, "test")).toBeNull();
    expect(productEvent({ ...input, properties: { [key]: "sensitive" } }, "test")).toBeNull();
  }
  expect(productEvent({ ...input, name: "arbitrary_user_text" }, "test")).toBeNull();
  expect(productEvent({ ...input, resourceId: "name@example.invalid" }, "test")).toBeNull();
});
