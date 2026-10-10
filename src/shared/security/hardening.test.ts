import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { transientTransactionFailure } from "@/shared/db/failures";
import { transaction } from "@/shared/db/transaction";
import type { PrismaClient } from "@/generated/prisma/client";
import { toClientError, AppError } from "@/shared/errors/app-error";
import { plainText } from "@/shared/validation/text";
import { securityHeaders } from "./headers";
import { testDatabase } from "../../../scripts/test-database";
import { readJsonBody, safeLocalRedirect } from "@/modules/auth/request-policy";
import { parseAuthEnv } from "@/modules/auth/config";

describe("hardening boundaries", () => {
  it.each(["//evil.example", "/%2f%2fevil.example", "/%5cevil.example", "/%252f%252fevil.example", "/%0aevil", "https%3a%2f%2fevil.example", "javascript:alert(1)", "/\\evil", "/%zz"])("rejects redirect %s", (value) => expect(safeLocalRedirect(value)).toBe("/account"));
  it.each(["Tiếng Việt", "Tiếng Việt".normalize("NFD"), "<script>alert(1)</script>", '<img src=x onerror="alert(1)">'])("accepts escaped plain text %s", (value) => expect(plainText(200).safeParse(value).success).toBe(true));
  it.each(["\ud800", "\udfff", "\u0000", "\u0085", "\u200b\u2060", "\u200b \t"])("rejects malformed/control/invisible %s", (value) => expect(plainText(200).safeParse(value).success).toBe(false));
  it("normalizes CRLF without changing Vietnamese", () => expect(plainText(100).parse("  Việt\r\nNam\r  ")).toBe("Việt\nNam"));
  it.each(["application/jsonp", "application/json-invalid", "text/plain"])("rejects content type %s", async (type) => {
    await expect(readJsonBody(new Request("https://app.invalid", { method: "POST", headers: { "content-type": type }, body: "{}" }))).rejects.toThrow();
  });
  it("rejects malformed UTF8 instead of replacement characters", async () => {
    await expect(readJsonBody(new Request("https://app.invalid", { method: "POST", headers: { "content-type": "application/json" }, body: new Uint8Array([123,34,120,34,58,34,0xc0,0xaf,34,125]) }))).rejects.toThrow();
  });
  it("accepts JSON charset and ignores dishonest small length for size enforcement", async () => {
    const req = (body: string) => new Request("https://app.invalid", { method: "POST", headers: { "content-type": "application/json; charset=utf-8", "content-length": "2" }, body });
    expect(await readJsonBody(req('{"name":"Việt"}'))).toEqual({ name: "Việt" });
    await expect(readJsonBody(req(JSON.stringify({ x: "a".repeat(17000) })))).rejects.toThrow();
  });
  it.each([{}, { DATABASE_URL: "postgresql://test@localhost/test" }, { TEST_DATABASE_URL: "postgresql://test@localhost/production", AUTH_TEST_DATABASE: "disposable" }, { TEST_DATABASE_URL: "postgresql://test@localhost/test", AUTH_TEST_DATABASE: "disposable", NODE_ENV: "production" }])("refuses unsafe test configuration", (env) => expect(() => testDatabase(env)).toThrow());
  it("accepts explicitly disposable remote DB without assuming loopback means safe", () => expect(testDatabase({ TEST_DATABASE_URL: "postgresql://test@db.example.invalid/phase10_disposable", AUTH_TEST_DATABASE: "disposable" }).DATABASE_URL).toContain("phase10_disposable"));
  it.each(["localhost", "app.localhost", "127.0.0.1", "127.0.0.2", "[::1]", "0.0.0.0"])("rejects production loopback/bind address %s even HTTPS", (host) => expect(() => parseAuthEnv({ APP_URL: `https://${host}`, BETTER_AUTH_SECRET: "x".repeat(48), NODE_ENV: "production" })).toThrow());
  it("uses production CSP without eval and opt-in HTTPS HSTS", () => {
    const env = { NODE_ENV: "production", APP_URL: "https://app.example.invalid" };
    const header = (e: Record<string,string>) => Object.fromEntries(securityHeaders(e).map((h) => [h.key,h.value]));
    expect(header(env)["Content-Security-Policy"]).not.toContain("unsafe-eval");
    expect(header(env)["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(header(env)["Strict-Transport-Security"]).toBeUndefined();
    expect(header({ ...env, ENABLE_HSTS: "1" })["Strict-Transport-Security"]).toBe("max-age=31536000");
    expect(header({ ...env, APP_URL: "http://localhost", ENABLE_HSTS: "1" })["Strict-Transport-Security"]).toBeUndefined();
  });
});
describe("DB error contract and bounded retries", () => {
  it.each(["P2002", "P2003", "P2004", "23505", "23503", "23514", "40P01", "40001", "P2034"])("maps %s to safe conflict", (code) => {
    const result = toClientError({ meta: { driverAdapterError: { cause: { originalCode: code, message: "secret SQL" } } } }, "generated-id");
    expect(result.code).toBe("CONFLICT"); expect(JSON.stringify(result)).not.toMatch(/SQL|secret|cause/);
  });
  it.each(["P2028", "57014", "55P03", "08006", "23505"])("does not retry %s", (code) => expect(transientTransactionFailure({ code })).toBe(false));
  it("bounds retries to three complete attempts", async () => {
    const run = vi.fn().mockRejectedValue({ code: "P2034" });
    await expect(transaction({ $transaction: run } as unknown as PrismaClient, async () => "ok")).rejects.toEqual({ code: "P2034" });
    expect(run).toHaveBeenCalledTimes(3);
  });
  it("does not retry authorization or messages that only mention deadlocks", async () => {
    for (const error of [new AppError("FORBIDDEN"), new Error("40P01 secret SQL")]) {
      const run = vi.fn().mockRejectedValue(error);
      await expect(transaction({ $transaction: run } as unknown as PrismaClient, async () => "ok")).rejects.toBe(error);
      expect(run).toHaveBeenCalledTimes(1);
    }
  });
});
