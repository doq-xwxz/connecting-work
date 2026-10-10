import "server-only";
import type { EventInput } from "./contracts";
const buffers = new WeakMap<object, EventInput[]>();
export function beginObservation(tx: object, events: EventInput[]) { buffers.set(tx, events); }
export function endObservation(tx: object) { buffers.delete(tx); }
export function committedEvent(tx: object, event: EventInput) {
  // Missing context (e.g. a foreign provider transaction) means no event, never an action failure.
  buffers.get(tx)?.push(event);
}
