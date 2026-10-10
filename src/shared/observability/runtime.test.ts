import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { measured, publishEvents, reportUnexpected, withTelemetry, type Telemetry } from "./runtime";
const event = { name: "message_sent" as const, actorRole: "WORKER" as const, resourceId: "69ab105b-4795-4913-b95b-aa0bf37e5ca5", properties: {} };
const providers = (): Telemetry => ({ analytics: { async capture() {} }, errors: { async captureException() {} }, monitoring: { async observe() {} } });
it("isolates throwing and hanging providers with a bounded wait", async () => {
  const p = providers(); p.analytics.capture = async () => { throw new Error("private SQL token"); };
  await expect(withTelemetry(p, () => publishEvents([event]))).resolves.toBeUndefined();
  p.analytics.capture = () => new Promise(() => {});
  vi.useFakeTimers();
  try { const work = withTelemetry(p, () => publishEvents([event])); await vi.advanceTimersByTimeAsync(101); await expect(work).resolves.toBeUndefined(); }
  finally { vi.useRealTimers(); }
});
it("captures only a constructed safe exception and bounded static context", async () => {
  const p = providers(), capture = vi.fn< Parameters<typeof withTelemetry>[0]["errors"]["captureException"] >(async () => {}); p.errors.captureException = capture;
  await withTelemetry(p, () => reportUnexpected("http_boundary", crypto.randomUUID()));
  expect(capture).toHaveBeenCalledOnce();
  expect(capture.mock.calls[0][0].message).toBe("Unexpected application failure");
});
it("monitoring failure preserves success and the original business exception", async () => {
  const p = providers(); p.monitoring.observe = async () => { throw new Error("adapter"); };
  await expect(withTelemetry(p, () => measured("apply", async () => 42))).resolves.toBe(42);
  const error = new Error("original"); await expect(withTelemetry(p, () => measured("apply", async () => { throw error; }))).rejects.toBe(error);
  await expect(publishEvents([event])).resolves.toBeUndefined();
});
it("error reporting throw and timeout remain contained", async () => {
  const p = providers(); p.errors.captureException = async () => { throw new Error("provider secret"); };
  await expect(withTelemetry(p, () => reportUnexpected("http_boundary", crypto.randomUUID()))).resolves.toBeUndefined();
  p.errors.captureException = () => new Promise(() => {});
  vi.useFakeTimers();
  try { const work = withTelemetry(p, () => reportUnexpected("http_boundary", crypto.randomUUID())); await vi.advanceTimersByTimeAsync(101); await expect(work).resolves.toBeUndefined(); }
  finally { vi.useRealTimers(); }
});
