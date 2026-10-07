import "server-only";
import { getDb } from "@/shared/db/client";
import { grantNormalRole } from "./service";
import { requireAuthenticatedUser } from "./principal";

export async function activateRole(headers: Headers, input: unknown) {
  const principal = await requireAuthenticatedUser(headers);
  return grantNormalRole(getDb(), principal, input);
}
