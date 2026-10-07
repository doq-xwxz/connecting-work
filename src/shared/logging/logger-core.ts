
type LogEvent = {
  requestId: string;
  action: string;
  outcome: "success" | "failure" | "blocked";
  actorId?: string;
  resourceType?: string;
  resourceId?: string;
  durationMs?: number;
};

// Fixed fields, not arbitrary context/objects. Only opaque IDs and static action names.
// Runtime keys are allowlisted too, since JS callers can bypass TypeScript.
export function createLogger(write: (line: string) => void = console.info) {
  return {
    event(input: LogEvent) {
      write(JSON.stringify({
        timestamp: new Date().toISOString(),
        requestId: input.requestId,
        action: input.action,
        outcome: input.outcome,
        actorId: input.actorId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        durationMs: input.durationMs,
      }));
    },
  };
}
