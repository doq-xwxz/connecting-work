import { z } from "zod";

const id = z.uuid();
const empty = z.strictObject({});
const definitions = {
  job_created: { type: "JOB", properties: empty }, job_published: { type: "JOB", properties: z.strictObject({ publication: z.enum(["FIRST", "RESUME"]) }) },
  job_paused: { type: "JOB", properties: empty }, job_closed: { type: "JOB", properties: empty }, job_cancelled: { type: "JOB", properties: empty },
  application_created: { type: "APPLICATION", properties: empty }, application_shortlisted: { type: "APPLICATION", properties: empty }, application_rejected: { type: "APPLICATION", properties: empty },
  offer_created: { type: "OFFER", properties: empty }, offer_accepted: { type: "OFFER", properties: empty },
  engagement_created: { type: "ENGAGEMENT", properties: empty }, engagement_started: { type: "ENGAGEMENT", properties: empty },
  completion_requested: { type: "ENGAGEMENT", properties: empty }, engagement_completed: { type: "ENGAGEMENT", properties: z.strictObject({ provenance: z.enum(["ORGANIC", "ADMIN_FORCED"]) }) },
  engagement_cancelled: { type: "ENGAGEMENT", properties: z.strictObject({ provenance: z.enum(["PARTICIPANT", "ADMIN_FORCED"]) }) },
  conversation_opened: { type: "CONVERSATION", properties: empty }, message_sent: { type: "MESSAGE", properties: empty },
  review_submitted: { type: "REVIEW", properties: z.strictObject({ direction: z.enum(["WORKER_TO_EMPLOYER", "EMPLOYER_TO_WORKER"]) }) },
  report_created: { type: "REPORT", properties: z.strictObject({ targetType: z.enum(["USER", "COMPANY", "JOB", "REVIEW", "ENGAGEMENT", "MESSAGE"]) }) },
  moderation_action_applied: { type: "AUDIT", properties: z.strictObject({ action: z.enum(["JOB_HIDDEN", "JOB_UNHIDDEN", "REVIEW_HIDDEN", "REVIEW_UNHIDDEN", "USER_SUSPENDED", "USER_UNSUSPENDED", "USER_BANNED", "ENGAGEMENT_FORCE_COMPLETED", "ENGAGEMENT_FORCE_CANCELLED"]) }) },
  job_search_performed: { type: "REQUEST", properties: z.strictObject({ queryPresent: z.boolean(), resultBucket: z.enum(["ZERO", "ONE_TO_TEN", "ELEVEN_PLUS"]) }) },
  worker_recommendation_viewed: { type: "REQUEST", properties: z.strictObject({ resultBucket: z.enum(["ZERO", "ONE_TO_TEN", "ELEVEN_PLUS"]) }) },
  employer_candidate_recommendation_viewed: { type: "REQUEST", properties: z.strictObject({ resultBucket: z.enum(["ZERO", "ONE_TO_TEN", "ELEVEN_PLUS"]) }) },
} as const;
export type EventName = keyof typeof definitions;
export type EventInput = { [N in EventName]: { name: N; resourceId: string; actorRole: "WORKER" | "EMPLOYER" | "ADMIN" | "ANONYMOUS"; occurrenceId?: string; occurredAt?: string; properties: z.input<typeof definitions[N]["properties"]> } }[EventName];
export type ProductEvent = { schemaVersion: 1; name: EventName; eventKey: string; resourceType: string; resourceId: string; actorRole: EventInput["actorRole"]; occurredAt: string; environment: "production" | "development" | "test"; properties: Record<string, unknown> };
// Reject extra runtime keys; do not spread payloads into provider calls.
export function productEvent(raw: unknown, environment: ProductEvent["environment"]): ProductEvent | null {
  try {
    const base = z.strictObject({ name: z.enum(Object.keys(definitions) as [EventName, ...EventName[]]), resourceId: id,
      actorRole: z.enum(["WORKER", "EMPLOYER", "ADMIN", "ANONYMOUS"]), occurrenceId: z.string().regex(/^[a-zA-Z0-9-]{1,80}$/).optional(),
      occurredAt: z.iso.datetime().optional(), properties: z.record(z.string(), z.unknown()) }).parse(raw);
    const definition = definitions[base.name], properties = definition.properties.parse(base.properties);
    return { schemaVersion: 1, name: base.name, eventKey: `v1:${base.name}:${base.resourceId}:${base.occurrenceId ?? "once"}`,
      resourceType: definition.type, resourceId: base.resourceId, actorRole: base.actorRole, occurredAt: base.occurredAt ?? new Date().toISOString(), environment, properties };
  } catch { return null; }
}
export const operationSchema = z.enum(["job_search", "worker_recommendation", "candidate_recommendation", "apply", "offer_accept", "message_send", "admin_action", "http_boundary", "readiness"]);
export type Operation = z.infer<typeof operationSchema>;
export const durationBucket = (ms: number) => ms < 100 ? "UNDER_100_MS" : ms < 500 ? "UNDER_500_MS" : ms < 2000 ? "UNDER_2_S" : "AT_LEAST_2_S";
