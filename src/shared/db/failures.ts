// Inspect only documented codes in bounded adapter cause chains; never messages.
export function databaseCodes(error: unknown): Set<string> {
  const codes = new Set<string>(), seen = new Set<unknown>();
  const pending: unknown[] = [error];
  for (let i = 0; i < pending.length && i < 12; i++) {
    const item = pending[i];
    if (!item || typeof item !== "object" || seen.has(item)) continue;
    seen.add(item);
    const row = item as Record<string, unknown>;
    for (const key of ["code", "originalCode", "sqlState"]) if (typeof row[key] === "string") codes.add(row[key]);
    for (const key of ["cause", "meta", "driverAdapterError"]) if (row[key]) pending.push(row[key]);
  }
  return codes;
}
export function transientTransactionFailure(error: unknown) {
  return [...databaseCodes(error)].some((code) => ["40001", "40P01", "P2034"].includes(code));
}
export function databaseErrorCode(error: unknown): "CONFLICT" | "INTERNAL" {
  return [...databaseCodes(error)].some((code) => ["23505", "23503", "23514", "23P01", "40001", "40P01", "P2002", "P2003", "P2004", "P2034"].includes(code)) ? "CONFLICT" : "INTERNAL";
}
