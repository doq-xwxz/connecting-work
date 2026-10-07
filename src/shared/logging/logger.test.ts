import { expect, it } from "vitest";
import { createLogger } from "./logger-core";

it("logs operational identifiers while dropping arbitrary sensitive context", () => {
  const lines: string[] = [];
  const input = { requestId: "req-1", action: "foundation.check", outcome: "success" as const, durationMs: 12,
    password: "private-password", token: "private-token", email: "private-email", body: "private-message", context: { secret: "private" } };
  createLogger((line) => lines.push(line)).event(input);
  expect(JSON.parse(lines[0])).toMatchObject({ requestId: "req-1", action: "foundation.check", durationMs: 12 });
  expect(lines[0]).not.toMatch(/private|password|token|email|body|context/);
});
