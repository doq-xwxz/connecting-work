import { AppError, toClientError } from "@/shared/errors/app-error";
import { emailPaths, parseAuthBody, readJsonBody, requireSameOrigin } from "./request-policy";
import type { Auth } from "./factory";
import { reportUnexpected } from "@/shared/observability/runtime";

export async function safeFailure(error: unknown) {
  const mapped = toClientError(error, crypto.randomUUID());
  if (mapped.code === "INTERNAL") await reportUnexpected("http_boundary", mapped.requestId);
  return Response.json(mapped, { status: mapped.status, headers: { "Cache-Control": "no-store" } });
}

// Explicit public endpoint surface. No update/delete/link/admin/social endpoints.
export async function handleAuthRequest(request: Request, deps: {
  origin: string; getAuth: () => Auth; assertEmailReady: () => void;
}) {
  try {
    const path = new URL(request.url).pathname.replace(/^\/api\/auth/, "");
    if (request.method === "GET") {
      if (!["/get-session", "/ok"].includes(path)) throw new AppError("NOT_FOUND");
      const response = await deps.getAuth().handler(request);
      if (!response.ok) return safeFailure(new AppError("UNAUTHENTICATED"));
      if (path === "/ok") return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
      const session = await response.json();
      const headers = new Headers({ "Cache-Control": "no-store" });
      for (const cookie of response.headers.getSetCookie()) headers.append("Set-Cookie", cookie);
      // Session tokens/credential fields never appear in the browser JSON DTO.
      return Response.json(session ? { user: { id: session.user.id, name: session.user.name, emailVerified: session.user.emailVerified } } : null, { headers });
    }
    if (request.method !== "POST") throw new AppError("NOT_FOUND");
    requireSameOrigin(request, deps.origin);
    const body = parseAuthBody(path, await readJsonBody(request));
    if (emailPaths.has(path)) {
      try { deps.assertEmailReady(); }
      catch { return Response.json({ message: "Email xác thực chưa sẵn sàng. Vui lòng thử lại sau." }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
    }
    let response: Response;
    if (path === "/verify-email") {
      // Public POST confirmation; the library's GET handler is internal only.
      // Public GET /verify-email is explicitly denied above. Retain BA rate limits.
      const token = (body as { token: string }).token;
      const target = new URL("/api/auth/verify-email", deps.origin);
      target.searchParams.set("token", token);
      const internalHeaders = new Headers(request.headers);
      internalHeaders.delete("content-type");
      internalHeaders.delete("content-length");
      response = await deps.getAuth().handler(new Request(target, { method: "GET", headers: internalHeaders }));
    } else {
      const forwardedHeaders = new Headers(request.headers);
      forwardedHeaders.delete("content-length");
      response = await deps.getAuth().handler(new Request(request.url, {
        method: "POST", headers: forwardedHeaders, body: JSON.stringify(body),
      }));
    }
    const headers = new Headers({ "Cache-Control": "no-store" });
    for (const cookie of response.headers.getSetCookie()) headers.append("Set-Cookie", cookie);
    const retry = response.headers.get("retry-after");
    if (retry) headers.set("Retry-After", retry);
    // No library payloads, tokens, password/SQL errors or redirect locations.
    if (!response.ok) {
      const code = response.status === 429 ? "RATE_LIMITED" : response.status >= 500 ? "INTERNAL" : "VALIDATION";
      const safe = toClientError(new AppError(code), crypto.randomUUID());
      return Response.json(safe, { status: safe.status, headers });
    }
    return Response.json({ ok: true }, { headers });
  } catch (error) { return safeFailure(error); }
}
