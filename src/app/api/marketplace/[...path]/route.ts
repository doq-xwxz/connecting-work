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
    if (request.method === "GET") {
      if (area === "worker" && path.length === 1) result = await getWorker(db, actor);
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
      if (request.method === "POST" && path.length === 1 && area === "worker") result = await saveWorker(db, actor, body);
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
