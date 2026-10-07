import { AppError } from "@/shared/errors/app-error";
import { z } from "zod";

export type Role = "WORKER" | "EMPLOYER" | "ADMIN";
export type AccountStatus = "ACTIVE" | "SUSPENDED" | "BANNED";
export type Principal = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  status: AccountStatus;
  roles: Role[];
};

const activationSchema = z.strictObject({ role: z.enum(["WORKER", "EMPLOYER"]) });
export function parseRoleActivation(input: unknown) {
  const parsed = activationSchema.safeParse(input);
  if (!parsed.success) throw new AppError("VALIDATION");
  return parsed.data;
}

export function hasRole(user: Principal, ...roles: Role[]) {
  return roles.some((role) => user.roles.includes(role));
}
export function requireRole(user: Principal, ...roles: Role[]) {
  if (!hasRole(user, ...roles)) throw new AppError("FORBIDDEN");
  return user;
}
export function requireVerifiedEmail(user: Principal) {
  if (!user.emailVerified) throw new AppError("FORBIDDEN");
  return user;
}
// Authentication alone retains account access. Resource-scoped obligations belong
// to future services; this guard never grants them or treats ADMIN as a bypass.
export function requireCanCreateActivity(user: Principal) {
  if (user.status !== "ACTIVE") throw new AppError("FORBIDDEN");
  return user;
}
