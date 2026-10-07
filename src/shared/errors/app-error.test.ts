import { describe, expect, it } from "vitest";
import { AppError, ERROR_STATUS, toClientError } from "./app-error";

describe("client-safe errors", () => {
  it.each(Object.entries(ERROR_STATUS))("maps %s without serializing cause", (code, status) => {
    const error = new AppError(code as keyof typeof ERROR_STATUS, { cause: new Error("password=PRIVATE SQL INSERT") });
    const result = toClientError(error, "request-1");
    expect(result).toMatchObject({ code, status, requestId: "request-1" });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|SQL|stack|cause/);
  });

  it.each([new Error("postgresql://secret"), { message: "token", code: "FORBIDDEN" }, null])("treats unknown errors as INTERNAL", (error) => {
    expect(toClientError(error, "req")).toMatchObject({ code: "INTERNAL", status: 500 });
    expect(JSON.stringify(toClientError(error, "req"))).not.toMatch(/postgresql|token/);
  });
});
