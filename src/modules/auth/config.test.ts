import { expect, it } from "vitest";
import { parseAuthEnv } from "./config";

const env = { APP_URL: "https://app.example.invalid", BETTER_AUTH_SECRET: "test-only-configuration-value-32-characters", NODE_ENV: "production" };
it("uses an explicit production HTTPS origin without localhost fallback", () => {
  expect(parseAuthEnv(env).origin).toBe("https://app.example.invalid");
});
it.each([{ ...env, APP_URL: "http://localhost:3000" }, { ...env, APP_URL: "https://app.example.invalid/path" },
  { ...env, BETTER_AUTH_URL: "https://other.example.invalid" }, { ...env, BETTER_AUTH_SECRET: "private" },
  { ...env, APP_URL: "https://name:password@app.example.invalid" }, {}])("fails safely on invalid config", (input) => {
  expect(() => parseAuthEnv(input)).toThrow();
  try { parseAuthEnv(input); } catch (error) { expect(String(error)).not.toMatch(/private|password@app|test-only/); }
});
