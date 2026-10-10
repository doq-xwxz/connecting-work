import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { productEvent, operationSchema, durationBucket, type ProductEvent, type EventInput, type Operation } from "./contracts";

export interface AnalyticsProvider { capture(event: ProductEvent, signal: AbortSignal): Promise<void> }
export interface ErrorReporter { captureException(error: Error, context: { action: Operation; requestId: string; code: "INTERNAL" }, signal: AbortSignal): Promise<void> }
export interface MonitoringProvider { observe(context: { action: Operation; duration: ReturnType<typeof durationBucket>; outcome: "success" | "failure" }, signal: AbortSignal): Promise<void> }
export type Telemetry = { analytics: AnalyticsProvider; errors: ErrorReporter; monitoring: MonitoringProvider };
const noop: Telemetry = Object.freeze({ analytics: Object.freeze({ async capture() {} }), errors: Object.freeze({ async captureException() {} }), monitoring: Object.freeze({ async observe() {} }) });
const context = new AsyncLocalStorage<Telemetry>();
// Dependency injection is request/test scoped; there is no mutable global provider or event store.
export function withTelemetry<T>(providers: Telemetry, work: () => T): T { return context.run(providers, work); }
async function bounded(work: (signal: AbortSignal) => Promise<void>) {
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([Promise.resolve().then(() => work(controller.signal)), new Promise<void>((resolve) => { timer = setTimeout(() => { controller.abort(); resolve(); }, 100); })]); }
  catch { /* Observability cannot change business results, including synchronous adapter errors. */ }
  finally { if (timer) clearTimeout(timer); controller.abort(); }
}
export async function publishEvents(events: readonly EventInput[]) {
  const provider = context.getStore() ?? noop;
  const environment = process.env.NODE_ENV === "production" ? "production" : process.env.NODE_ENV === "test" ? "test" : "development";
  // One bounded batch budget, not 100ms per event. Adapters must honor abort.
  await bounded(async (signal) => { await Promise.all(events.map(async (input) => { const event = productEvent(input, environment); if (event) await provider.analytics.capture(event, signal); })); });
}
export async function reportUnexpected(action: Operation, requestId: string) {
  if (!operationSchema.safeParse(action).success || !/^[a-f0-9-]{36}$/i.test(requestId)) return;
  await bounded((signal) => (context.getStore() ?? noop).errors.captureException(new Error("Unexpected application failure"), { action, requestId, code: "INTERNAL" }, signal));
}
export async function measured<T>(action: Operation, work: () => Promise<T>): Promise<T> {
  const start = performance.now(); let outcome: "success" | "failure" = "failure";
  try { const result = await work(); outcome = "success"; return result; }
  finally { if (operationSchema.safeParse(action).success) await bounded((signal) => (context.getStore() ?? noop).monitoring.observe({ action, duration: durationBucket(performance.now() - start), outcome }, signal)); }
}
