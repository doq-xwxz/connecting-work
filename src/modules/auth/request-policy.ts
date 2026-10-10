import { AppError } from "@/shared/errors/app-error";
import { z } from "zod";
import { plainText } from "@/shared/validation/text";

export function requireSameOrigin(request: Request, origin: string) {
  // Fail closed on absent/null/spoofed-origin browser requests. No wildcard CORS.
  if (request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new AppError("FORBIDDEN");
  }
}

export function safeLocalRedirect(value: unknown, fallback = "/account"): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") ||
      /[\\\u0000-\u0020\u007f]/.test(value)) return fallback;
  try {
    let decoded = value;
    for (let i = 0; i < 3; i++) {
      const next = decodeURIComponent(decoded);
      if (next.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(next)) return fallback;
      if (next === decoded) break;
      decoded = next;
    }
    const url = new URL(value, "https://redirect.invalid");
    return url.origin === "https://redirect.invalid" ? url.pathname + url.search : fallback;
  } catch { return fallback; }
}

const email = z.email().max(254);
const password = z.string().min(12).max(128);
const callback = z.string().optional().refine((value) => value === undefined || value === "/account", "Invalid callback");
const schemas = {
  "/sign-up/email": z.strictObject({ name: plainText(100).refine((value) => value.length > 0), email, password, callbackURL: callback }),
  "/sign-in/email": z.strictObject({ email, password: z.string().min(1).max(128), callbackURL: callback, rememberMe: z.boolean().optional() }),
  "/sign-out": z.strictObject({}),
  "/send-verification-email": z.strictObject({ email, callbackURL: callback }),
  "/request-password-reset": z.strictObject({ email, redirectTo: z.literal("/reset-password").optional() }),
  "/reset-password": z.strictObject({ token: z.string().min(1).max(4096), newPassword: password }),
  "/verify-email": z.strictObject({ token: z.string().min(1).max(4096) }),
} as const;

export function parseAuthBody(path: string, input: unknown) {
  const schema = schemas[path as keyof typeof schemas];
  if (!schema) throw new AppError("NOT_FOUND");
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new AppError("VALIDATION");
  return parsed.data;
}

export const emailPaths = new Set(["/sign-up/email", "/send-verification-email", "/request-password-reset"]);

export async function readJsonBody(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") throw new AppError("VALIDATION");
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > 16_384)) throw new AppError("VALIDATION");
  // Bound streamed input too, not only the untrusted Content-Length header.
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("VALIDATION");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 16_384) { await reader.cancel(); throw new AppError("VALIDATION"); }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch { throw new AppError("VALIDATION"); }
}
