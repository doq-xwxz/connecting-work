import { z } from "zod";
import { getDb } from "@/shared/db/client";
import { requireAuthenticatedUser } from "@/modules/auth/principal";
import { getAuthConfig } from "@/modules/auth/server";
import { readJsonBody, requireSameOrigin } from "@/modules/auth/request-policy";
import { safeFailure } from "@/modules/auth/http";
import { AppError, toClientError } from "@/shared/errors/app-error";
import { InputError, parse } from "@/modules/profiles/contracts";
import { discoverWorkers, getEmployer, getWorker, listSkills, saveEmployer, saveWorker, setDiscoverable } from "@/modules/profiles/service";
import { createCompany, getCompany, listCompanies, listMembers, removeManager, updateCompany } from "@/modules/companies/service";
import { createJob, duplicateJob, editJob, getManagedJob, getPublicJob, listManagedJobs, listPublicJobs, transitionJob } from "@/modules/jobs/service";
import { actions } from "@/modules/jobs/contracts";
import { actOnApplication, actOnEngagement, actOnOffer, applyToJob, createOffer, getApplication, listApplications, listOffers } from "@/modules/hiring/service";
import { applicationActions, engagementActions, offerActions } from "@/modules/hiring/contracts";
import { recommendedJobs, recommendedCandidates } from "@/modules/matching/service";
import { getConversation, listConversations, listMessages, listNotifications, markConversationRead, openConversation, readNotification, sendMessage, setBlock } from "@/modules/messaging/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  try {
    if (request.method !== "GET") requireSameOrigin(request, getAuthConfig().origin);
    const db = getDb();
    const { path } = await context.params;
    const [area, id, action, memberId] = path;
    const url = new URL(request.url);
    const query: Record<string, string> = {};
    for (const [key, value] of url.searchParams) {
      if (key in query) throw new AppError("VALIDATION");
      query[key] = value;
    }
    if (request.method === "GET" && area === "jobs" && path.length <= 2) {
      if (path.length === 2) parse(z.strictObject({}), query);
      return Response.json(path.length === 1 ? await listPublicJobs(db, query) : await getPublicJob(db, id), { headers: { "Cache-Control": "no-store" } });
    }
    const actor = await requireAuthenticatedUser(request.headers);
    let result: unknown;
    const chatSide = area === "worker-conversations" ? "WORKER" : area === "employer-conversations" ? "EMPLOYER" : null;
    if (request.method !== "GET" && (chatSide || area === "notifications")) parse(z.strictObject({}), query);
    if (["worker-applications", "employer-applications", "offers", "worker-engagements", "employer-engagements"].includes(area) && (request.method !== "GET" || path.length === 2)) parse(z.strictObject({}), query);
    if (request.method === "GET") {
      if (chatSide && path.length === 1) result = await listConversations(db, actor, chatSide, query);
      else if (chatSide && path.length === 2) { parse(z.strictObject({}), query); result = await getConversation(db, actor, chatSide, id); }
      else if (chatSide && path.length === 3 && action === "messages") result = await listMessages(db, actor, chatSide, id, query);
      else if (area === "notifications" && path.length === 1) result = await listNotifications(db, actor, query);
      else if (area === "worker-recommendations" && path.length === 1) result = await recommendedJobs(db, actor, query);
      else if (area === "employer-jobs" && path.length === 3 && action === "candidates") result = await recommendedCandidates(db, actor, id, query);
      else if (area === "worker-applications" && path.length === 1) result = await listApplications(db, actor, "WORKER", query);
      else if (["worker-applications", "employer-applications"].includes(area) && path.length === 3 && action === "offers") result = await listOffers(db, actor, area === "worker-applications" ? "WORKER" : "EMPLOYER", id, query);
      else if (["worker-applications", "employer-applications"].includes(area) && path.length === 2) result = await getApplication(db, actor, area === "worker-applications" ? "WORKER" : "EMPLOYER", id);
      else if (area === "employer-jobs" && path.length === 3 && action === "applications") result = await listApplications(db, actor, "EMPLOYER", query, id);
      else if (area === "worker" && path.length === 1) result = await getWorker(db, actor);
      else if (area === "skills" && path.length === 1) result = await listSkills(db, actor);
      else if (area === "employer" && path.length === 1) result = await getEmployer(db, actor);
      else if (area === "workers" && path.length === 1) result = await discoverWorkers(db, actor, query);
      else if (area === "companies" && path.length === 1) result = await listCompanies(db, actor, query);
      else if (area === "companies" && path.length === 2) result = await getCompany(db, actor, id);
      else if (area === "company" && action === "members" && path.length === 3) result = await listMembers(db, actor, id, query);
      else if (area === "employer-jobs" && path.length === 1) result = await listManagedJobs(db, actor, query);
      else if (area === "employer-jobs" && path.length === 2) { parse(z.strictObject({}), query); result = await getManagedJob(db, actor, id); }
      else throw new AppError("NOT_FOUND");
    } else {
      const body = await readJsonBody(request);
      if (area === "employer-jobs") parse(z.strictObject({}), query);
      if (request.method === "POST" && path.length === 3 && ["worker-applications", "employer-applications"].includes(area) && action === "conversation") result = await openConversation(db, actor, area === "worker-applications" ? "WORKER" : "EMPLOYER", id, body);
      else if (request.method === "POST" && chatSide && path.length === 3 && action === "messages") result = await sendMessage(db, actor, chatSide, id, body);
      else if (request.method === "POST" && chatSide && path.length === 3 && action === "read") result = await markConversationRead(db, actor, chatSide, id, body);
      else if (request.method === "POST" && chatSide && path.length === 3 && action === "block") result = await setBlock(db, actor, chatSide, id, body);
      else if (request.method === "POST" && area === "notifications" && path.length === 3 && action === "read") result = await readNotification(db, actor, id, body);
      else if (request.method === "POST" && path.length === 3 && area === "jobs" && action === "apply") { parse(z.strictObject({}), query); result = await applyToJob(db, actor, id, body); }
      else if (request.method === "POST" && path.length === 3 && ["worker-applications", "employer-applications"].includes(area) && (applicationActions as readonly string[]).includes(action)
        && (area === "worker-applications" ? action === "withdraw" : action !== "withdraw")) result = await actOnApplication(db, actor, id, action as typeof applicationActions[number], body);
      else if (request.method === "POST" && path.length === 3 && area === "employer-applications" && action === "offers") result = await createOffer(db, actor, id, body);
      else if (request.method === "POST" && path.length === 3 && area === "offers" && (offerActions as readonly string[]).includes(action)) result = await actOnOffer(db, actor, id, action as typeof offerActions[number], body);
      else if (request.method === "POST" && path.length === 3 && ["worker-engagements", "employer-engagements"].includes(area) && (engagementActions as readonly string[]).includes(action)) result = await actOnEngagement(db, actor, area === "worker-engagements" ? "WORKER" : "EMPLOYER", id, action as typeof engagementActions[number], body);
      else if (request.method === "POST" && path.length === 1 && area === "worker") result = await saveWorker(db, actor, body);
      else if (request.method === "PUT" && path.length === 2 && area === "worker") result = await saveWorker(db, actor, body, id);
      else if (request.method === "PATCH" && path.length === 3 && area === "worker" && action === "discoverability") result = await setDiscoverable(db, actor, id, body);
      else if (request.method === "POST" && path.length === 1 && area === "employer") result = await saveEmployer(db, actor, body);
      else if (request.method === "PUT" && path.length === 2 && area === "employer") result = await saveEmployer(db, actor, body, id);
      else if (request.method === "POST" && path.length === 1 && area === "companies") result = await createCompany(db, actor, body);
      else if (request.method === "PUT" && path.length === 2 && area === "company") result = await updateCompany(db, actor, id, body);
      else if (request.method === "POST" && path.length === 1 && area === "employer-jobs") result = await createJob(db, actor, body);
      else if (request.method === "PUT" && path.length === 2 && area === "employer-jobs") result = await editJob(db, actor, id, body);
      else if (request.method === "POST" && path.length === 3 && area === "employer-jobs" && action === "duplicate") result = await duplicateJob(db, actor, id, body);
      else if (request.method === "POST" && path.length === 3 && area === "employer-jobs" && (actions as readonly string[]).includes(action)) result = await transitionJob(db, actor, id, action as typeof actions[number], body);
      else if (request.method === "DELETE" && path.length === 4 && area === "company" && action === "members") {
        parse(z.strictObject({}), body);
        result = await removeManager(db, actor, id, memberId);
      } else throw new AppError("NOT_FOUND");
    }
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof InputError) return Response.json({ ...toClientError(error, crypto.randomUUID()),
      fieldErrors: Object.fromEntries(error.fields.map((field) => [field, "Dữ liệu không hợp lệ."])) },
    { status: 400, headers: { "Cache-Control": "no-store" } });
    return safeFailure(error);
  }
}
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
