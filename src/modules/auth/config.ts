import { z } from "zod";

const originSchema = z.url().refine((value) => {
  const url = new URL(value);
  return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password &&
    url.pathname === "/" && !url.search && !url.hash;
});

export function parseAuthEnv(env: Record<string, string | undefined>) {
  const result = z.object({
    APP_URL: originSchema,
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: originSchema.optional(),
  }).safeParse(env);
  if (!result.success) throw new Error("Auth configuration is missing or invalid.");
  const origin = new URL(result.data.APP_URL).origin;
  if (result.data.BETTER_AUTH_URL && new URL(result.data.BETTER_AUTH_URL).origin !== origin) {
    throw new Error("Auth URLs must have the same origin.");
  }
  if (env.NODE_ENV === "production" && !origin.startsWith("https://")) {
    throw new Error("Production auth requires HTTPS.");
  }
  const host = new URL(origin).hostname;
  if (env.NODE_ENV === "production" && (host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0" || /^127\./.test(host) || host === "[::1]")) throw new Error("Production auth requires a public application origin.");
  return { origin, secret: result.data.BETTER_AUTH_SECRET, production: env.NODE_ENV === "production" };
}

export type AuthConfig = ReturnType<typeof parseAuthEnv>;
