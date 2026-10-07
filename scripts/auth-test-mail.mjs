// Loaded only by the HTTP test child process, never imported by application code.
// Intercept the external mail transport; real Next/Better Auth/DB code still runs.
if (process.env.AUTH_HTTP_TEST !== "1" || process.env.AUTH_TEST_DATABASE !== "disposable" || process.env.NODE_ENV !== "development") {
  throw new Error("HTTP mail fixture requires explicit disposable development test configuration.");
}
const inbox = new URL(process.env.AUTH_HTTP_TEST_MAIL_URL);
if (inbox.protocol !== "http:" || inbox.hostname !== "127.0.0.1") throw new Error("HTTP mail fixture must be loopback.");
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.origin === "https://api.resend.com") {
    if (url.pathname !== "/emails" || init?.method !== "POST") throw new Error("Unexpected test email request.");
    return originalFetch(inbox, { method: "POST", headers: {
      "content-type": "application/json", authorization: `Bearer ${process.env.AUTH_HTTP_TEST_MAIL_SECRET}`,
    }, body: init.body, signal: init.signal });
  }
  return originalFetch(input, init);
};
// The Next CLI handles SIGINT and shuts down its development worker gracefully.
process.on("message", (message) => { if (message === "phase2-test-stop") process.emit("SIGINT"); });
