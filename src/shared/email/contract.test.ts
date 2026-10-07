import { expect, it, vi } from "vitest";
import { createResendSender } from "./contract";

it("sends auth mail through injected transport without exposing provider errors", async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response("private-provider-body", { status: 403 }));
  const sender = createResendSender("test-only-key", "sender@example.invalid", transport);
  await expect(sender.send({ to: "recipient@example.invalid", kind: "verification", url: "https://app.example.invalid/verify-email#token=test-only-token" })).rejects.toThrow("Auth email delivery failed.");
  expect(transport).toHaveBeenCalledOnce();
});
