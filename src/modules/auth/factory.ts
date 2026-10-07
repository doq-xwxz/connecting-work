import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthEmailSender } from "@/shared/email/contract";
import type { AuthConfig } from "./config";

// Dependency injection is only for operator tests; production entrypoint is server-only.
export function createAuth(db: PrismaClient, config: AuthConfig, email: AuthEmailSender,
  backgroundTask?: (promise: Promise<unknown>) => void) {
  return betterAuth({
    appName: "Connecting Work",
    baseURL: config.origin,
    secret: config.secret,
    trustedOrigins: [config.origin],
    database: prismaAdapter(db, { provider: "postgresql", transaction: true }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 1800,
      revokeSessionsOnPasswordReset: true,
      async sendResetPassword({ user, token }) {
        await email.send({ to: user.email, kind: "password-reset", url: `${config.origin}/reset-password#token=${encodeURIComponent(token)}` });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: false,
      autoSignInAfterVerification: false,
      expiresIn: 3600,
      async sendVerificationEmail({ user, token }) {
        await email.send({ to: user.email, kind: "verification", url: `${config.origin}/verify-email#token=${encodeURIComponent(token)}` });
      },
    },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
    user: { additionalFields: { status: { type: ["ACTIVE", "SUSPENDED", "BANNED"], defaultValue: "ACTIVE", input: false, returned: false } } },
    verification: { storeIdentifier: "hashed" },
    rateLimit: {
      enabled: true, storage: "database", window: 60, max: 100,
      customRules: {
        "/sign-up/email": { window: 60, max: 5 },
        "/sign-in/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 60, max: 3 },
        "/send-verification-email": { window: 60, max: 3 },
      },
    },
    advanced: {
      useSecureCookies: config.production,
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", secure: config.production },
      ...(backgroundTask ? { backgroundTasks: { handler: backgroundTask } } : {}),
    },
    logger: { disabled: true }, // Never forward library exception/request payloads to logs.
    telemetry: { enabled: false },
  });
}

export type Auth = ReturnType<typeof createAuth>;
