import "server-only";
import { getDb } from "@/shared/db/client";
import { getAuth } from "./server";
import { resolvePrincipal } from "./service";

export async function requireAuthenticatedUser(headers: Headers) {
  return resolvePrincipal(getAuth(), getDb(), headers);
}
