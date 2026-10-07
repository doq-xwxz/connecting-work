import "server-only";
import { after } from "next/server";
import { getDb } from "@/shared/db/client";
import { getAuthEmailSender } from "@/shared/email/sender";
import { logger } from "@/shared/logging/logger";
import { parseAuthEnv } from "./config";
import { createAuth, type Auth } from "./factory";

let instance: Auth | undefined;
export function getAuthConfig() { return parseAuthEnv(process.env); }
export function getAuth() {
  if (instance) return instance;
  const config = getAuthConfig();
  // Resolve provider when sending; session reads/sign-in need no email credentials.
  instance = createAuth(getDb(), config, { send: (message) => getAuthEmailSender().send(message) }, (promise) => {
    const guarded = promise.catch(() => {
      logger.event({ requestId: crypto.randomUUID(), action: "auth.background", outcome: "failure" });
    });
    after(async () => { await guarded; });
  });
  return instance;
}
