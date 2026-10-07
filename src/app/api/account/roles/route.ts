import { activateRole } from "@/modules/auth/roles";
import { getAuthConfig } from "@/modules/auth/server";
import { readJsonBody, requireSameOrigin } from "@/modules/auth/request-policy";
import { safeFailure } from "@/modules/auth/http";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    requireSameOrigin(request, getAuthConfig().origin);
    const result = await activateRole(request.headers, await readJsonBody(request));
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return safeFailure(error); }
}
