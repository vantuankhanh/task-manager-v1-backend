const {describe, it} = require("node:test");
const assert = require("node:assert/strict");
const {Writable} = require("node:stream");
const pino = require("pino");
const {UrlForLog, PathForLog, RequestLogSerializers} = require("../src/loggers/requestLog");

describe("request log", () => {
  it("drops the query string of requests under /api/auth/", () => {
    assert.equal(UrlForLog("/api/auth/callback?code=one-time-code&state=secret-state"), "/api/auth/callback");
    assert.equal(UrlForLog("/api/auth/callback?error=access_denied&state=secret-state"), "/api/auth/callback");
    assert.equal(UrlForLog("/api/auth/login?returnTo=/tasks"), "/api/auth/login");
    assert.equal(UrlForLog("/api/auth/config"), "/api/auth/config");
  });

  it("logs every other URL as before", () => {
    assert.equal(UrlForLog("/api/task?page=2"), "/api/task?page=2");
    assert.equal(UrlForLog("/api/authors?code=kept"), "/api/authors?code=kept");
    assert.equal(UrlForLog("/?code=kept"), "/?code=kept");
    assert.equal(UrlForLog(undefined), undefined);
  });

  it("keeps the fields of the default req serializer of Fastify", () => {
    const serialized = RequestLogSerializers.req({
      method: "GET",
      url: "/api/auth/callback?code=one-time-code&state=secret-state",
      headers: {"accept-version": "1.x"},
      hostname: "api-taskmanager-v1.vantuankhanh.com",
      ip: "127.0.0.1",
      socket: {remotePort: 50000},
    });
    assert.deepEqual(serialized, {
      method: "GET",
      url: "/api/auth/callback",
      version: "1.x",
      hostname: "api-taskmanager-v1.vantuankhanh.com",
      remoteAddress: "127.0.0.1",
      remotePort: 50000,
    });
  });

  it("keeps code and state out of what Fastify writes, with the logger set up as in src/server.js", async () => {
    const logLines = [];
    const logStream = new Writable({
      write(chunk, encoding, done) {
        logLines.push(String(chunk));
        done();
      },
    });
    const app = require("fastify")({logger: pino({serializers: RequestLogSerializers}, logStream)});
    app.get("/api/auth/callback", async () => {
      throw new Error("failed on purpose, to get an error line with the request in it");
    });
    app.get("/api/task", async () => []);
    await app.ready();

    await app.inject({method: "GET", url: "/api/auth/callback?code=one-time-code&state=secret-state"});
    await app.inject({method: "GET", url: "/api/task?page=2"});
    await app.close();

    const writtenLog = logLines.join("");
    assert.ok(!writtenLog.includes("one-time-code"));
    assert.ok(!writtenLog.includes("secret-state"));
    const requestUrls = logLines.map((line) => JSON.parse(line)).flatMap((entry) => (entry.req ? [entry.req.url] : []));
    assert.ok(requestUrls.includes("/api/auth/callback"));
    // A matched route is logged as its pattern, so the query string of /api/task is gone as well (D49 (c))
    assert.ok(requestUrls.includes("/api/task"));
  });

  it("logs the route pattern when a route matched, the raw path otherwise", () => {
    assert.equal(
      PathForLog({url: "/api/getprojectbyuser/a@b.com", routeOptions: {url: "/api/getprojectbyuser/:email"}}),
      "/api/getprojectbyuser/:email",
    );
    assert.equal(PathForLog({url: "/nothing-here?x=1", routeOptions: {}}), "/nothing-here?x=1");
    assert.equal(PathForLog({url: "/api/auth/nothing?code=one-time-code"}), "/api/auth/nothing");
  });

  it("keeps the email and the name of a parameterised route out of every log line (D49 (c))", async () => {
    const logLines = [];
    const logStream = new Writable({
      write(chunk, encoding, done) {
        logLines.push(String(chunk));
        done();
      },
    });
    const app = require("fastify")({logger: pino({serializers: RequestLogSerializers}, logStream)});
    // The same prefix as src/server.js, because the pattern in the log must carry it
    app.register(
      async (prefixedApp) => {
        prefixedApp.get("/getprojectbyuser/:email", async () => []);
        prefixedApp.get("/gettaskbyuser/:name", async () => {
          throw new Error("failed on purpose, to get an error line with the request in it");
        });
      },
      {prefix: "/api"},
    );
    await app.ready();

    await app.inject({method: "GET", url: "/api/getprojectbyuser/person.one@example.com"});
    await app.inject({method: "GET", url: "/api/gettaskbyuser/Nguyen%20Van%20Person?page=2"});
    await app.close();

    const writtenLog = logLines.join("");
    assert.ok(!writtenLog.includes("person.one"));
    assert.ok(!writtenLog.includes("example.com"));
    assert.ok(!writtenLog.includes("Nguyen"));
    const requestUrls = logLines.map((line) => JSON.parse(line)).flatMap((entry) => (entry.req ? [entry.req.url] : []));
    assert.ok(requestUrls.includes("/api/getprojectbyuser/:email"));
    assert.ok(requestUrls.includes("/api/gettaskbyuser/:name"));
  });

  it("falls back to the raw path, without the query under /api/auth/, when no route matched", async () => {
    const logLines = [];
    const logStream = new Writable({
      write(chunk, encoding, done) {
        logLines.push(String(chunk));
        done();
      },
    });
    const app = require("fastify")({logger: pino({serializers: RequestLogSerializers}, logStream)});
    await app.ready();

    const missingResponse = await app.inject({method: "GET", url: "/api/auth/unknown?code=one-time-code"});
    await app.inject({method: "GET", url: "/api/missing?page=2"});
    await app.close();

    assert.equal(missingResponse.statusCode, 404);
    const requestUrls = logLines.map((line) => JSON.parse(line)).flatMap((entry) => (entry.req ? [entry.req.url] : []));
    assert.ok(requestUrls.includes("/api/auth/unknown"));
    assert.ok(requestUrls.includes("/api/missing?page=2"));
    // The "incoming request" line has no query under /api/auth/; Fastify's own "not found" message is not a req field
    assert.ok(!requestUrls.some((url) => url.includes("one-time-code")));
  });
});
