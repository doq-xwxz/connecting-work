import { z } from "zod";
import { getDb } from "@/shared/db/client";
import { requireAuthenticatedUser } from "@/modules/auth/principal";
import { getAuthConfig } from "@/modules/auth/server";
import { readJsonBody, requireSameOrigin } from "@/modules/auth/request-policy";
import { safeFailure } from "@/modules/auth/http";
import { AppError } from "@/shared/errors/app-error";
import { adminAnalytics } from "@/modules/analytics/service";
import { parse } from "@/modules/profiles/contracts";
import { moderationActions } from "@/modules/moderation/contracts";
import { actOnCase, attachReport, caseDetail, caseReports, caseTimeline, createCase, inspectCase, listAdminReports, listCases, progressCase } from "@/modules/moderation/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  try {
    if (request.method !== "GET") requireSameOrigin(request, getAuthConfig().origin);
    const actor = await requireAuthenticatedUser(request.headers), db = getDb();
    const { path } = await context.params;
    const [area, id, action, command] = path;
    const query: Record<string, string> = {};
    for (const [key, value] of new URL(request.url).searchParams) {
      if (key in query) throw new AppError("VALIDATION");
      query[key] = value;
    }
    let result: unknown;
    if (request.method === "GET") {
      if (path.length === 1 && area === "analytics") result = await adminAnalytics(db, actor, query);
      else if (path.length === 1 && area === "reports") result = await listAdminReports(db, actor, query);
      else if (path.length === 1 && area === "cases") result = await listCases(db, actor, query);
      else if (area === "cases" && path.length === 2) { parse(z.strictObject({}), query); result = await caseDetail(db, actor, id); }
      else if (area === "cases" && path.length === 3 && action === "audit") result = await caseTimeline(db, actor, id, query);
      else if (area === "cases" && path.length === 3 && action === "reports") result = await caseReports(db, actor, id, query);
      else throw new AppError("NOT_FOUND");
    } else {
      parse(z.strictObject({}), query);
      const body = await readJsonBody(request);
      if (path.length === 1 && area === "cases") result = await createCase(db, actor, body);
      else if (area === "cases" && path.length === 3 && action === "reports") result = await attachReport(db, actor, id, body);
      else if (area === "cases" && path.length === 3 && (action === "investigate" || action === "close")) result = await progressCase(db, actor, id, action, body);
      else if (area === "cases" && path.length === 3 && action === "context") result = await inspectCase(db, actor, id, body);
      else if (area === "cases" && path.length === 4 && action === "actions" && (moderationActions as readonly string[]).includes(command)) result = await actOnCase(db, actor, id, command as typeof moderationActions[number], body);
      else throw new AppError("NOT_FOUND");
    }
    return Response.json(result, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return safeFailure(error); }
}
export const GET = handle;
export const POST = handle;
