const {describe, it, before, after, beforeEach} = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const Module = require("node:module");
const path = require("node:path");
const jwt = require("jsonwebtoken");

// Put a fake module into the require cache so the code under test loads it instead of the real one
const stubSourceModule = (relativePath, fakeExports) => {
  const filename = require.resolve(path.join(__dirname, "../src", relativePath));
  const fakeModule = new Module(filename);
  fakeModule.filename = filename;
  fakeModule.loaded = true;
  fakeModule.exports = fakeExports;
  require.cache[filename] = fakeModule;
};

const API_BASE_URL = "https://api-taskmanager-v1.vantuankhanh.com";
const FRONTEND_ORIGIN = "https://taskmanagerv1.vantuankhanh.com";
const FOREIGN_ORIGIN = "https://kavauni.vantuankhanh.com";
const API_AUDIENCE = "https://api-taskmanager-v1.vantuankhanh.com/api";

const ADMIN_SUBJECT = "0190f000-0000-7000-8000-00000000000a";
const MEMBER_SUBJECT = "0190f000-0000-7000-8000-00000000000b";
const IMPORTED_SUBJECT = "0190f000-0000-7000-8000-00000000000c";
const NEW_SUBJECT = "0190f000-0000-7000-8000-00000000000d";

const ADMIN_ID = "55555555-5555-4555-8555-555555555555";
const MEMBER_ID = "44444444-4444-4444-8444-444444444444";
const IMPORTED_ID = "66666666-6666-4666-8666-666666666666";
const OWN_TASK_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_TASK_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";

// Stubbed pg pool: a small in-memory "user" table that answers the statements of utils/iamLocalUser.js
// the way PostgreSQL would (unique iam_sub, unique LOWER(email)) and records every query
const fakeDatabase = {
  queries: [],
  users: [],
  taskOwnerById: {},
  // The table iam_ended_session: {session_id, iam_sub, ended_at, remember_until}
  endedSessions: [],
  // Set by a test to make every statement on iam_ended_session fail, as when the table is missing
  endedSessionWriteError: null,
  reset() {
    this.queries = [];
    this.endedSessions = [];
    this.endedSessionWriteError = null;
    this.users = [
      {id: ADMIN_ID, name: "admin", email: "admin@gmail.com", role: 1, iam_sub: ADMIN_SUBJECT},
      {
        id: MEMBER_ID,
        name: "Tom &amp; Jerry",
        email: "tom&amp;jerry@gmail.com",
        role: 0,
        iam_sub: MEMBER_SUBJECT,
      },
      // Imported into the IAM, but the mapping was never loaded: no iam_sub yet. Stored with capital letters
      {id: IMPORTED_ID, name: "Minh", email: "Minh@Example.com", role: 0, iam_sub: null},
    ];
    this.taskOwnerById = {[OWN_TASK_ID]: "tom&amp;jerry@gmail.com", [OTHER_TASK_ID]: "admin@gmail.com"};
  },
  publicColumns: ({id, name, email, role, iam_sub}) => ({id, name, email, role, iam_sub}),
  answer(sql, params) {
    if (/INSERT INTO iam_ended_session \(session_id, iam_sub, ended_at, remember_until\)/.test(sql)) {
      if (this.endedSessionWriteError) {
        throw this.endedSessionWriteError;
      }
      assert.match(sql, /ON CONFLICT \(session_id\) DO UPDATE SET remember_until = GREATEST/);
      const [sessionId, subject, endedAt, rememberUntil] = params;
      const knownSession = this.endedSessions.find((endedSession) => endedSession.session_id === sessionId);
      if (knownSession) {
        knownSession.remember_until = new Date(Math.max(knownSession.remember_until, rememberUntil));
      } else {
        this.endedSessions.push({session_id: sessionId, iam_sub: subject, ended_at: endedAt, remember_until: rememberUntil});
      }
      return [];
    }
    if (/DELETE FROM iam_ended_session WHERE remember_until < NOW\(\)/.test(sql)) {
      this.endedSessions = this.endedSessions.filter((endedSession) => endedSession.remember_until >= new Date());
      return [];
    }
    if (/SELECT 1 FROM iam_ended_session WHERE session_id = \$1 AND remember_until > NOW\(\) LIMIT 1/.test(sql)) {
      if (this.endedSessionWriteError) {
        throw this.endedSessionWriteError;
      }
      return this.endedSessions
        .filter((endedSession) => endedSession.session_id === params[0] && endedSession.remember_until > new Date())
        .map(() => ({}));
    }
    if (/FROM "user" WHERE iam_sub = \$1 LIMIT 1/.test(sql)) {
      return this.users.filter((user) => user.iam_sub === params[0]).map(this.publicColumns);
    }
    if (/UPDATE "user" SET iam_sub = \$1 WHERE LOWER\(email\) = LOWER\(\$2\) AND iam_sub IS NULL/.test(sql)) {
      const matches = this.users.filter((user) => user.email.toLowerCase() === params[1].toLowerCase() && user.iam_sub === null);
      matches.forEach((user) => (user.iam_sub = params[0]));
      return matches.map(this.publicColumns);
    }
    if (/INSERT INTO "user" \(name, email, role, iam_sub\)/.test(sql)) {
      assert.match(sql, /ON CONFLICT DO NOTHING/);
      const [name, email, role, iamSubject] = params;
      if (this.users.some((user) => user.iam_sub === iamSubject || user.email.toLowerCase() === email.toLowerCase())) {
        return [];
      }
      const createdUser = {id: crypto.randomUUID(), name, email, role, iam_sub: iamSubject};
      this.users.push(createdUser);
      return [this.publicColumns(createdUser)];
    }
    if (/UPDATE "user" SET role = \$1 WHERE iam_sub = \$2/.test(sql)) {
      this.users.filter((user) => user.iam_sub === params[1]).forEach((user) => (user.role = params[0]));
      return [];
    }
    if (/SELECT id FROM task WHERE id = \$1 AND user_mail = \$2/.test(sql)) {
      return this.taskOwnerById[params[0]] === params[1] ? [{id: params[0]}] : [];
    }
    if (/SELECT role FROM "user" WHERE id = \$1/.test(sql)) {
      return this.users.filter((user) => user.id === params[0]).map(({role}) => ({role}));
    }
    if (/SELECT id FROM project WHERE name = \$1/.test(sql)) {
      return [];
    }
    return [{id: MEMBER_ID, name: "user", email: "user@gmail.com", role: 0}];
  },
  async connect() {
    return {
      query: async (sql, params) => {
        fakeDatabase.queries.push({sql, params});
        const rows = fakeDatabase.answer(sql, params);
        return {rows, rowCount: rows.length};
      },
      release: () => {},
    };
  },
};

stubSourceModule("connection/database.connection.js", fakeDatabase);
stubSourceModule("loggers/loggers.config.js", {error() {}, warn() {}, info() {}});

const {GetAuthConfig} = require("../src/utils/authConfig");
const {RegisterIam} = require("../src/middlewares/iamAuthenticate");
const allRouter = require("../src/routes/routes");

// The signing key of the fake IAM. The verifier gets the public half as its key set, instead of a JWKS over the network
const signingKeys = crypto.generateKeyPairSync("rsa", {modulusLength: 2048});
const otherSigningKeys = crypto.generateKeyPairSync("rsa", {modulusLength: 2048});

// A fake IAM on a free local port: discovery, userinfo, revocation. Enough for the routes of the SDK to answer
const fakeIam = {
  server: null,
  issuer: "",
  userinfoRequests: 0,
  userinfoStatus: 200,
  // The nonce of the sign-in in progress, which the ID token of the next code grant carries
  expectedNonce: "",
  tokenStatus: 200,
  profileBySubject: {
    [IMPORTED_SUBJECT]: {name: "Lê Minh", email: "minh@example.com", email_verified: false},
    [NEW_SUBJECT]: {name: `Tom & Jerry's <friend>`, email: "new.user@example.com", email_verified: true},
  },
  reset() {
    this.userinfoRequests = 0;
    this.userinfoStatus = 200;
    this.expectedNonce = "";
    this.tokenStatus = 200;
  },
  answer(request) {
    const requestPath = new URL(request.url, this.issuer).pathname;
    if (requestPath === "/.well-known/openid-configuration") {
      return {
        status: 200,
        body: {
          issuer: this.issuer,
          authorization_endpoint: `${this.issuer}/oauth2/authorize`,
          token_endpoint: `${this.issuer}/oauth2/token`,
          userinfo_endpoint: `${this.issuer}/oauth2/userinfo`,
          revocation_endpoint: `${this.issuer}/oauth2/revoke`,
          end_session_endpoint: `${this.issuer}/oauth2/end_session`,
          jwks_uri: `${this.issuer}/oauth2/jwks`,
        },
      };
    }
    if (requestPath === "/oauth2/userinfo") {
      this.userinfoRequests += 1;
      if (this.userinfoStatus !== 200) {
        return {status: this.userinfoStatus, body: {error: "server_error"}};
      }
      const subject = jwt.decode((request.headers.authorization || "").replace("Bearer ", ""))?.sub;
      const profile = this.profileBySubject[subject];
      return profile ? {status: 200, body: {sub: subject, ...profile}} : {status: 401, body: {error: "invalid_token"}};
    }
    if (requestPath === "/oauth2/revoke") {
      return {status: 200, body: {}};
    }
    if (requestPath === "/oauth2/jwks") {
      // The SDK checks logout tokens against the published keys of the IAM
      return {
        status: 200,
        body: {keys: [{...signingKeys.publicKey.export({format: "jwk"}), kid: "k1", alg: "RS256", use: "sig"}]},
      };
    }
    if (requestPath === "/oauth2/token") {
      if (this.tokenStatus !== 200) {
        return {status: this.tokenStatus, body: {error: "invalid_grant", error_description: "the code is not valid"}};
      }
      const idToken = jwt.sign({nonce: this.expectedNonce}, signingKeys.privateKey, {
        algorithm: "RS256",
        keyid: "k1",
        issuer: this.issuer,
        audience: "taskmanager-v1",
        subject: MEMBER_SUBJECT,
        expiresIn: "5m",
      });
      return {
        status: 200,
        body: {
          access_token: signAccessToken(MEMBER_SUBJECT, ["member"]),
          token_type: "Bearer",
          expires_in: 600,
          refresh_token: "refresh-token-of-the-fake-iam",
          id_token: idToken,
        },
      };
    }
    return {status: 404, body: {error: "not_found"}};
  },
  async start() {
    this.server = http.createServer((request, response) => {
      const {status, body} = this.answer(request);
      response.statusCode = status;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(body));
    });
    await new Promise((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    this.issuer = `http://127.0.0.1:${this.server.address().port}`;
  },
  stop() {
    return new Promise((resolve) => this.server.close(resolve));
  },
};

// An access token as VTK IAM issues it: RS256, token_use "access", the roles of this application
const signAccessToken = (subject, roles, overrides = {}) =>
  jwt.sign(
    {token_use: "access", roles, scope: "openid profile email offline_access", ...overrides.claims},
    overrides.privateKey || signingKeys.privateKey,
    {
      algorithm: "RS256",
      keyid: "k1",
      issuer: fakeIam.issuer,
      audience: overrides.audience || API_AUDIENCE,
      subject,
      expiresIn: overrides.expiresIn || "10m",
    },
  );
// A logout token as VTK IAM posts it to the back-channel logout URI of the application
const BACKCHANNEL_LOGOUT_EVENT = "http://schemas.openid.net/event/backchannel-logout";
const signLogoutToken = (subject, sessionId, overrides = {}) =>
  jwt.sign(
    {sid: sessionId, events: {[BACKCHANNEL_LOGOUT_EVENT]: {}}, ...overrides.claims},
    overrides.privateKey || signingKeys.privateKey,
    {
      algorithm: "RS256",
      keyid: "k1",
      header: {typ: overrides.type || "logout+jwt"},
      issuer: fakeIam.issuer,
      audience: overrides.audience || "taskmanager-v1",
      subject,
      jwtid: crypto.randomUUID(),
      expiresIn: "2m",
    },
  );
const postLogoutToken = (logoutToken) =>
  iamApp.inject({
    method: "POST",
    url: "/api/auth/backchannel-logout",
    headers: {"content-type": "application/x-www-form-urlencoded"},
    payload: new URLSearchParams({logout_token: logoutToken}).toString(),
  });
const bearer = (token) => ({authorization: `Bearer ${token}`});
const adminHeaders = () => bearer(signAccessToken(ADMIN_SUBJECT, ["admin"]));
const memberHeaders = () => bearer(signAccessToken(MEMBER_SUBJECT, ["member"]));

const queriesMatching = (pattern) => fakeDatabase.queries.filter(({sql}) => pattern.test(sql));
const userBySubject = (subject) => fakeDatabase.users.find((user) => user.iam_sub === subject);

const taskBody = (id) => ({
  id,
  user_mail: "admin@gmail.com",
  project_id: PROJECT_ID,
  time_start: "2026-01-01",
  time_end: "2026-02-01",
  status: 3,
  note: "note",
});
const projectBody = {
  id: PROJECT_ID,
  name: "project",
  payment: 1,
  time_start: "2026-01-01",
  time_end: "2026-02-01",
  note: "",
  priority: 1,
};

// The admin-only routes of the route table
const adminOnlyRoutes = [
  {method: "DELETE", url: "/api/user", payload: {id: MEMBER_ID}},
  {method: "POST", url: "/api/project", payload: projectBody},
  {method: "PUT", url: "/api/project", payload: projectBody},
  {method: "DELETE", url: "/api/project", payload: {id: PROJECT_ID}},
  {method: "GET", url: "/api/task"},
  {method: "POST", url: "/api/task", payload: taskBody(undefined)},
  {method: "DELETE", url: "/api/task", payload: {id: OTHER_TASK_ID}},
  {method: "GET", url: `/api/gettaskbyprojectid/${PROJECT_ID}`},
];

// The endpoints of the sign-in this app did itself, removed in milestone M9 of VTK IAM
const removedRoutes = [
  {method: "POST", url: "/api/login", payload: {email: "admin@gmail.com", password: "x"}},
  {method: "GET", url: "/api/refresh-token"},
  {method: "POST", url: "/api/user", payload: {email: "new@gmail.com", name: "new", password: "x"}},
  {method: "PUT", url: "/api/user/changerole", payload: {email: "admin@gmail.com", role: 0}},
  {method: "GET", url: "/api/auth/config"},
];

let iamApp;

before(async () => {
  await fakeIam.start();

  const authConfig = GetAuthConfig({
    IAM_ISSUER: fakeIam.issuer,
    IAM_CLIENT_ID: "taskmanager-v1",
    IAM_CLIENT_SECRET: "test-client-secret",
    IAM_API_AUDIENCE: API_AUDIENCE,
    APP_BASE_URL: API_BASE_URL,
    FRONTEND_BASE_URL: FRONTEND_ORIGIN,
    COOKIE_SECRET: "test-cookie-secret-of-at-least-32-characters",
  });

  // The same wiring as src/server.js; only the key set is local
  iamApp = require("fastify")();
  const authenticate = RegisterIam(iamApp, authConfig.iam, {keySet: async () => signingKeys.publicKey});
  iamApp.register(allRouter, {prefix: "/api", authenticate});
  await iamApp.ready();
});

after(async () => {
  await iamApp.close();
  await fakeIam.stop();
});

beforeEach(() => {
  fakeDatabase.reset();
  fakeIam.reset();
});

describe("the sign-in settings", () => {
  const iamEnvironment = {
    IAM_ISSUER: "https://auth.vantuankhanh.com",
    IAM_CLIENT_ID: "taskmanager-v1",
    IAM_CLIENT_SECRET: "client-secret-value",
    IAM_API_AUDIENCE: API_AUDIENCE,
    APP_BASE_URL: API_BASE_URL,
    FRONTEND_BASE_URL: FRONTEND_ORIGIN,
    COOKIE_SECRET: "cookie-secret-value-of-at-least-32-characters",
  };

  it("refuse to start when a variable is missing, naming the variables and no value", () => {
    for (const missingName of Object.keys(iamEnvironment)) {
      assert.throws(
        () => GetAuthConfig({...iamEnvironment, [missingName]: " "}),
        (error) => {
          assert.ok(error.message.includes(missingName));
          assert.ok(!error.message.includes("secret-value"));
          return true;
        },
      );
    }
    assert.throws(
      () => GetAuthConfig({}),
      /IAM_ISSUER, IAM_CLIENT_ID, IAM_CLIENT_SECRET, IAM_API_AUDIENCE, APP_BASE_URL, FRONTEND_BASE_URL, COOKIE_SECRET/,
    );
  });

  it("refuses a COOKIE_SECRET shorter than 32 characters", () => {
    assert.throws(
      () => GetAuthConfig({...iamEnvironment, COOKIE_SECRET: "short"}),
      /COOKIE_SECRET must be at least 32 characters/,
    );
  });

  it("are read", () => {
    const authConfig = GetAuthConfig(iamEnvironment);
    assert.equal(authConfig.iam.clientId, "taskmanager-v1");
    assert.equal(authConfig.iam.frontendBaseUrl, FRONTEND_ORIGIN);
  });
});

describe("iam mode: access token", () => {
  const expectUnauthorized = async (headers) => {
    for (const url of ["/api/me", "/api/task", "/api/user"]) {
      const response = await iamApp.inject({method: "GET", url, headers});
      assert.equal(response.statusCode, 401, url);
    }
    assert.equal(fakeDatabase.queries.length, 0, "nothing may run after a failed token check");
  };

  it("answers 401 without a token", async () => {
    await expectUnauthorized({});
  });

  it("refuses a token of the old sign-in (HS256)", async () => {
    await expectUnauthorized(bearer(jwt.sign({name: "admin", email: "admin@gmail.com", role: 1}, "test-access-token-secret")));
  });

  it("refuses a token signed by another key, for another audience, expired, or that is not an access token", async () => {
    await expectUnauthorized(bearer(signAccessToken(ADMIN_SUBJECT, ["admin"], {privateKey: otherSigningKeys.privateKey})));
    await expectUnauthorized(
      bearer(signAccessToken(ADMIN_SUBJECT, ["admin"], {audience: "https://another-api.vantuankhanh.com/api"})),
    );
    await expectUnauthorized(bearer(signAccessToken(ADMIN_SUBJECT, ["admin"], {expiresIn: -120})));
    await expectUnauthorized(bearer(signAccessToken(ADMIN_SUBJECT, ["admin"], {claims: {token_use: "id"}})));
  });

  it("accepts the token from the access_token cookie as well as from the Authorization header", async () => {
    const fromCookie = await iamApp.inject({
      method: "GET",
      url: "/api/me",
      headers: {cookie: `other=1; access_token=${signAccessToken(MEMBER_SUBJECT, ["member"])}`},
    });
    assert.equal(fromCookie.statusCode, 200);

    const fromHeader = await iamApp.inject({method: "GET", url: "/api/me", headers: memberHeaders()});
    assert.equal(fromHeader.statusCode, 200);
  });
});

describe("iam mode: local user", () => {
  it("maps the token to the local user by iam_sub, without asking the IAM for the profile", async () => {
    const response = await iamApp.inject({method: "GET", url: "/api/me", headers: memberHeaders()});
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().id, MEMBER_ID);
    assert.equal(fakeIam.userinfoRequests, 0);
    assert.equal(fakeDatabase.queries.length, 1, "one lookup per request");
    assert.deepEqual(fakeDatabase.queries[0].params, [MEMBER_SUBJECT]);
  });

  it("links the row with the same email on first sight (stored with other letter case) and sets iam_sub", async () => {
    const headers = bearer(signAccessToken(IMPORTED_SUBJECT, ["member"]));
    const first = await iamApp.inject({method: "GET", url: "/api/me", headers});
    assert.equal(first.statusCode, 200);
    assert.deepEqual(first.json(), {id: IMPORTED_ID, name: "Minh", email: "Minh@Example.com", role: 0});
    assert.equal(userBySubject(IMPORTED_SUBJECT).id, IMPORTED_ID);
    assert.equal(fakeDatabase.users.length, 3, "no row is created");
    assert.equal(fakeIam.userinfoRequests, 1);

    const second = await iamApp.inject({method: "GET", url: "/api/me", headers});
    assert.equal(second.json().id, IMPORTED_ID);
    assert.equal(fakeIam.userinfoRequests, 1, "the profile is only needed the first time");
  });

  it("creates the row just in time on first sight, escaped like the rows the app wrote itself", async () => {
    const headers = bearer(signAccessToken(NEW_SUBJECT, ["admin"]));
    const response = await iamApp.inject({method: "GET", url: "/api/me", headers});
    assert.equal(response.statusCode, 200);

    const createdUser = userBySubject(NEW_SUBJECT);
    assert.equal(fakeDatabase.users.length, 4);
    assert.equal(createdUser.name, "Tom &amp; Jerry&#39;s &lt;friend&gt;");
    assert.equal(createdUser.email, "new.user@example.com");
    assert.equal(createdUser.role, 1);
    assert.equal("password" in createdUser, false, "no local password");
    assert.deepEqual(response.json(), {
      id: createdUser.id,
      name: `Tom & Jerry's <friend>`,
      email: "new.user@example.com",
      role: 1,
    });

    await iamApp.inject({method: "GET", url: "/api/me", headers});
    assert.equal(fakeDatabase.users.length, 4, "the second request finds the row");
  });

  it("ends with one row when two first requests arrive at the same moment", async () => {
    const headers = bearer(signAccessToken(NEW_SUBJECT, ["member"]));
    const [first, second] = await Promise.all([
      iamApp.inject({method: "GET", url: "/api/me", headers}),
      iamApp.inject({method: "GET", url: "/api/me", headers}),
    ]);
    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
    assert.equal(first.json().id, second.json().id);
    assert.equal(fakeDatabase.users.filter((user) => user.iam_sub === NEW_SUBJECT).length, 1);
  });

  it("refuses an account whose email already belongs to another linked account", async () => {
    fakeIam.profileBySubject["another-subject"] = {name: "x", email: "ADMIN@gmail.com"};
    const response = await iamApp.inject({
      method: "GET",
      url: "/api/me",
      headers: bearer(signAccessToken("another-subject", ["admin"])),
    });
    delete fakeIam.profileBySubject["another-subject"];
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().message, "This email is already linked to another account");
    assert.equal(fakeDatabase.users.length, 3);
  });

  it("answers 503 when the profile is needed and the IAM does not answer", async () => {
    fakeIam.userinfoStatus = 500;
    const response = await iamApp.inject({
      method: "GET",
      url: "/api/me",
      headers: bearer(signAccessToken(NEW_SUBJECT, ["member"])),
    });
    assert.equal(response.statusCode, 503);
    assert.equal(fakeDatabase.users.length, 3);
  });

  it("keeps the local role column in step with the role of the token", async () => {
    // Promoted at the IAM: the local row still says 0
    const promoted = await iamApp.inject({
      method: "GET",
      url: "/api/me",
      headers: bearer(signAccessToken(MEMBER_SUBJECT, ["member", "admin"])),
    });
    assert.equal(promoted.json().role, 1);
    assert.equal(userBySubject(MEMBER_SUBJECT).role, 1);

    // Demoted at the IAM
    const demoted = await iamApp.inject({
      method: "GET",
      url: "/api/me",
      headers: bearer(signAccessToken(ADMIN_SUBJECT, ["member"])),
    });
    assert.equal(demoted.json().role, 0);
    assert.equal(userBySubject(ADMIN_SUBJECT).role, 0);
  });
});

describe("iam mode: GET /api/me", () => {
  it("answers id, name, email and role, with name and email unescaped for display", async () => {
    const member = await iamApp.inject({method: "GET", url: "/api/me", headers: memberHeaders()});
    assert.equal(member.statusCode, 200);
    assert.deepEqual(member.json(), {id: MEMBER_ID, name: "Tom & Jerry", email: "tom&jerry@gmail.com", role: 0});

    const admin = await iamApp.inject({method: "GET", url: "/api/me", headers: adminHeaders()});
    assert.deepEqual(admin.json(), {id: ADMIN_ID, name: "admin", email: "admin@gmail.com", role: 1});
  });
});

describe("iam mode: the route rules", () => {
  for (const route of adminOnlyRoutes) {
    it(`${route.method} ${route.url} answers a member with 403 and lets an admin through`, async () => {
      const member = await iamApp.inject({...route, headers: memberHeaders()});
      assert.equal(member.statusCode, 403);
      assert.deepEqual(member.json(), {code: 403, message: "Forbidden"});
      assert.equal(fakeDatabase.queries.length, 1, "only the iam_sub lookup ran");

      const admin = await iamApp.inject({...route, headers: adminHeaders()});
      assert.equal(admin.statusCode, 200, admin.body);
    });
  }

  it("takes the role from the token, not from the local column", async () => {
    // The local row says admin, the token says member
    const staleLocalAdmin = await iamApp.inject({
      method: "GET",
      url: "/api/task",
      headers: bearer(signAccessToken(ADMIN_SUBJECT, ["member"])),
    });
    assert.equal(staleLocalAdmin.statusCode, 403);

    // The local row says normal user, the token says admin
    const tokenAdmin = await iamApp.inject({
      method: "GET",
      url: "/api/task",
      headers: bearer(signAccessToken(MEMBER_SUBJECT, ["admin"])),
    });
    assert.equal(tokenAdmin.statusCode, 200);

    assert.deepEqual(
      queriesMatching(/SELECT role FROM "user" WHERE email = \$1 LIMIT 1/),
      [],
      "no role is read from the database",
    );
  });

  it("treats a token without the admin role, or without roles, as a normal user", async () => {
    for (const roles of [[], ["member"], ["Admin"], ["administrator"]]) {
      const response = await iamApp.inject({
        method: "GET",
        url: "/api/task",
        headers: bearer(signAccessToken(MEMBER_SUBJECT, roles)),
      });
      assert.equal(response.statusCode, 403, JSON.stringify(roles));
    }
  });

  it("lets a member read only their own tasks and projects, by the email /api/me gave them", async () => {
    const ownEmail = (await iamApp.inject({method: "GET", url: "/api/me", headers: memberHeaders()})).json().email;

    for (const url of ["/api/gettaskbyuser", "/api/getprojectbyuser"]) {
      const own = await iamApp.inject({method: "GET", url: `${url}/${encodeURIComponent(ownEmail)}`, headers: memberHeaders()});
      assert.equal(own.statusCode, 200, url);
      assert.deepEqual(fakeDatabase.queries.at(-1).params, ["tom&amp;jerry@gmail.com"]);

      const other = await iamApp.inject({method: "GET", url: `${url}/admin@gmail.com`, headers: memberHeaders()});
      assert.equal(other.statusCode, 403, url);

      const admin = await iamApp.inject({method: "GET", url: `${url}/${encodeURIComponent(ownEmail)}`, headers: adminHeaders()});
      assert.equal(admin.statusCode, 200, url);
    }
  });

  it("lets a member change only the status of their own task", async () => {
    const other = await iamApp.inject({
      method: "PUT",
      url: "/api/task",
      payload: taskBody(OTHER_TASK_ID),
      headers: memberHeaders(),
    });
    assert.equal(other.statusCode, 403);
    assert.deepEqual(queriesMatching(/UPDATE task/), []);

    const own = await iamApp.inject({method: "PUT", url: "/api/task", payload: taskBody(OWN_TASK_ID), headers: memberHeaders()});
    assert.equal(own.statusCode, 200);
    const updates = queriesMatching(/UPDATE task/);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].sql, "UPDATE task SET status = $1 WHERE id = $2");
  });

  it("gives a member only their own row from GET /api/user", async () => {
    await iamApp.inject({method: "GET", url: "/api/user", headers: memberHeaders()});
    const listQuery = fakeDatabase.queries.at(-1);
    assert.match(listQuery.sql, /WHERE email = \$1/);
    assert.deepEqual(listQuery.params, ["tom&amp;jerry@gmail.com"]);
  });
});

describe("endpoints of the old sign-in", () => {
  for (const route of removedRoutes) {
    it(`${route.method} ${route.url} no longer exists`, async () => {
      const response = await iamApp.inject({...route, headers: adminHeaders()});
      assert.equal(response.statusCode, 404);
      assert.equal(fakeDatabase.queries.length, 0);
    });
  }
});

describe("iam mode: sign-in routes of the SDK", () => {
  it("GET /api/auth/login sends the browser to the IAM with the callback on the API host", async () => {
    const response = await iamApp.inject({method: "GET", url: "/api/auth/login?returnTo=/tasks"});
    assert.equal(response.statusCode, 303);
    const authorizationUrl = new URL(response.headers.location);
    assert.equal(authorizationUrl.origin + authorizationUrl.pathname, `${fakeIam.issuer}/oauth2/authorize`);
    assert.equal(authorizationUrl.searchParams.get("redirect_uri"), `${API_BASE_URL}/api/auth/callback`);
    assert.equal(authorizationUrl.searchParams.get("client_id"), "taskmanager-v1");
    assert.match(String(response.headers["set-cookie"]), /iam_login=.*HttpOnly/);
    assert.equal(authorizationUrl.searchParams.has("prompt"), false, "a normal sign-in may reuse the session at the IAM");
  });

  it("GET /api/auth/login?prompt=login asks the IAM for its sign-in form and changes nothing else of the request", async () => {
    const response = await iamApp.inject({method: "GET", url: "/api/auth/login?returnTo=/tasks&prompt=login"});
    assert.equal(response.statusCode, 303);
    const authorizationUrl = new URL(response.headers.location);
    assert.equal(authorizationUrl.origin + authorizationUrl.pathname, `${fakeIam.issuer}/oauth2/authorize`);
    assert.deepEqual(authorizationUrl.searchParams.getAll("prompt"), ["login"]);
    assert.equal(authorizationUrl.searchParams.get("redirect_uri"), `${API_BASE_URL}/api/auth/callback`);
    assert.equal(authorizationUrl.searchParams.get("client_id"), "taskmanager-v1");
    assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
    for (const parameterName of ["state", "nonce", "code_challenge"]) {
      assert.ok(authorizationUrl.searchParams.get(parameterName), parameterName);
    }
    assert.match(String(response.headers["set-cookie"]), /iam_login=.*HttpOnly/);
  });

  it("GET /api/auth/login passes no other prompt and no other parameter of its query string on to the IAM", async () => {
    const parameterNamesOfNormalSignIn = [
      ...new URL((await iamApp.inject({method: "GET", url: "/api/auth/login"})).headers.location).searchParams.keys(),
    ].sort();
    const refusedQueries = [
      "prompt=none",
      "prompt=select_account",
      "prompt=consent",
      "prompt=LOGIN",
      "prompt=",
      "prompt=login%20none",
      "prompt=login&prompt=login",
      "prompt=login&prompt=none",
      "prompt[]=login",
      `prompt=${encodeURIComponent("login&redirect_uri=https://evil.example/")}`,
      "max_age=0&login_hint=someone%40evil.example&redirect_uri=https%3A%2F%2Fevil.example%2F&scope=openid",
    ];
    for (const refusedQuery of refusedQueries) {
      const response = await iamApp.inject({method: "GET", url: `/api/auth/login?returnTo=/tasks&${refusedQuery}`});
      assert.equal(response.statusCode, 303, refusedQuery);
      const authorizationUrl = new URL(response.headers.location);
      assert.deepEqual([...authorizationUrl.searchParams.keys()].sort(), parameterNamesOfNormalSignIn, refusedQuery);
      assert.equal(authorizationUrl.searchParams.get("redirect_uri"), `${API_BASE_URL}/api/auth/callback`, refusedQuery);
    }

    // With the allowed prompt, the rest of the query string still stays behind
    const response = await iamApp.inject({
      method: "GET",
      url: "/api/auth/login?prompt=login&redirect_uri=https%3A%2F%2Fevil.example%2F&login_hint=someone%40evil.example",
    });
    const authorizationUrl = new URL(response.headers.location);
    assert.deepEqual([...authorizationUrl.searchParams.keys()].sort(), [...parameterNamesOfNormalSignIn, "prompt"].sort());
    assert.equal(authorizationUrl.searchParams.get("redirect_uri"), `${API_BASE_URL}/api/auth/callback`);
  });

  it("POST /api/auth/refresh exists: 401 session_ended without a refresh cookie, from the frontend origin", async () => {
    const response = await iamApp.inject({method: "POST", url: "/api/auth/refresh", headers: {origin: FRONTEND_ORIGIN}});
    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), {error: "session_ended"});
    assert.equal(response.headers["access-control-allow-origin"], FRONTEND_ORIGIN);
  });

  it("POST /api/auth/logout exists: clears the cookies and answers the IAM sign-out URL back to the sign-in page of the frontend", async () => {
    const response = await iamApp.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: {origin: FRONTEND_ORIGIN, accept: "application/json"},
    });
    assert.equal(response.statusCode, 200);
    const signOutUrl = new URL(response.json().redirectUrl);
    assert.equal(signOutUrl.origin + signOutUrl.pathname, `${fakeIam.issuer}/oauth2/end_session`);
    assert.equal(signOutUrl.searchParams.get("post_logout_redirect_uri"), `${FRONTEND_ORIGIN}/auth/login`);
    assert.match(String(response.headers["set-cookie"]), /access_token=;.*Max-Age=0/);
  });

  it("refuses refresh and logout from a foreign origin", async () => {
    for (const url of ["/api/auth/refresh", "/api/auth/logout"]) {
      for (const origin of [FOREIGN_ORIGIN, "null"]) {
        const response = await iamApp.inject({method: "POST", url, headers: {origin}});
        assert.equal(response.statusCode, 403, `${url} from ${origin}`);
        assert.deepEqual(response.json(), {error: "cross_origin"});
        assert.equal(response.headers["access-control-allow-origin"], undefined);
      }
    }
  });
});

describe("iam mode: back-channel logout", () => {
  const SESSION_ID = "0190f000-0000-7000-8000-0000000000e1";
  const OTHER_SESSION_ID = "0190f000-0000-7000-8000-0000000000e2";
  const tokenOfSession = (sessionId) => signAccessToken(MEMBER_SUBJECT, ["member"], {claims: {sid: sessionId}});

  it("refuses the access tokens of a session at once when the IAM reports its end, and no other session", async () => {
    const lockedOutToken = tokenOfSession(SESSION_ID);
    const otherDeviceToken = tokenOfSession(OTHER_SESSION_ID);
    assert.equal((await iamApp.inject({url: "/api/me", headers: bearer(lockedOutToken)})).statusCode, 200);

    const logoutResponse = await postLogoutToken(signLogoutToken(MEMBER_SUBJECT, SESSION_ID));
    assert.equal(logoutResponse.statusCode, 204);
    assert.equal(logoutResponse.headers["cache-control"], "no-store");
    assert.equal(logoutResponse.headers["set-cookie"], undefined);
    assert.equal(fakeDatabase.endedSessions.length, 1);
    assert.equal(fakeDatabase.endedSessions[0].session_id, SESSION_ID);
    assert.equal(fakeDatabase.endedSessions[0].iam_sub, MEMBER_SUBJECT);

    // Still a valid JWT for nine more minutes, and refused: from the header and from the cookie
    const refused = await iamApp.inject({url: "/api/me", headers: bearer(lockedOutToken)});
    assert.equal(refused.statusCode, 401);
    assert.equal((await iamApp.inject({url: "/api/me", headers: {cookie: `access_token=${lockedOutToken}`}})).statusCode, 401);
    assert.equal((await iamApp.inject({url: "/api/me", headers: bearer(otherDeviceToken)})).statusCode, 200);
    // The session is looked up by its primary key, with the value as a parameter
    assert.ok(queriesMatching(/SELECT 1 FROM iam_ended_session WHERE session_id = \$1/).every(({params}) => params.length === 1));
  });

  it("needs no cookie, no token and no Origin: the IAM calls it from server to server", async () => {
    const logoutResponse = await postLogoutToken(signLogoutToken(MEMBER_SUBJECT, SESSION_ID));
    assert.equal(logoutResponse.statusCode, 204);
    assert.equal(logoutResponse.headers["access-control-allow-origin"], undefined);
  });

  it("answers 400 to anything but one valid logout token of this application, and records nothing", async () => {
    const refusedTokens = [
      "not-a-jwt",
      // An access token or an ID token replayed as a logout: the type is not logout+jwt
      tokenOfSession(SESSION_ID),
      signLogoutToken(MEMBER_SUBJECT, SESSION_ID, {type: "JWT"}),
      signLogoutToken(MEMBER_SUBJECT, SESSION_ID, {audience: "another-application"}),
      signLogoutToken(MEMBER_SUBJECT, SESSION_ID, {privateKey: otherSigningKeys.privateKey}),
      signLogoutToken(MEMBER_SUBJECT, SESSION_ID, {claims: {nonce: "n-1"}}),
      signLogoutToken(MEMBER_SUBJECT, SESSION_ID, {claims: {events: {}}}),
    ];
    for (const refusedToken of refusedTokens) {
      const response = await postLogoutToken(refusedToken);
      assert.equal(response.statusCode, 400, `token ${refusedTokens.indexOf(refusedToken)} must be refused`);
      assert.equal(response.json().error, "invalid_request");
    }
    const emptyBody = await iamApp.inject({
      method: "POST",
      url: "/api/auth/backchannel-logout",
      headers: {"content-type": "application/x-www-form-urlencoded"},
      payload: "",
    });
    assert.equal(emptyBody.statusCode, 400);
    assert.equal(fakeDatabase.endedSessions.length, 0);
    assert.equal((await iamApp.inject({url: "/api/me", headers: bearer(tokenOfSession(SESSION_ID))})).statusCode, 200);
  });

  it("answers 500 when the table cannot be written, so that the IAM tries again", async () => {
    fakeDatabase.endedSessionWriteError = new Error('relation "iam_ended_session" does not exist');
    const response = await postLogoutToken(signLogoutToken(MEMBER_SUBJECT, SESSION_ID));
    assert.equal(response.statusCode, 500);
    assert.ok(!response.body.includes("iam_ended_session"), "the answer must not describe the database");
  });

  it("keeps the API working when the table is missing: tokens are valid until they expire, as before", async () => {
    fakeDatabase.endedSessionWriteError = new Error('relation "iam_ended_session" does not exist');
    const response = await iamApp.inject({url: "/api/me", headers: bearer(tokenOfSession(SESSION_ID))});
    assert.equal(response.statusCode, 200);
  });

  it("forgets a session once its tokens have expired by themselves", async () => {
    await postLogoutToken(signLogoutToken(MEMBER_SUBJECT, SESSION_ID));
    assert.ok(fakeDatabase.endedSessions[0].remember_until - Date.now() > 55 * 60 * 1000, "remembered for about an hour");
    // An hour later: the row is past its time, and the next report removes it
    fakeDatabase.endedSessions[0].remember_until = new Date(Date.now() - 1000);
    assert.equal((await iamApp.inject({url: "/api/me", headers: bearer(tokenOfSession(SESSION_ID))})).statusCode, 200);
    await postLogoutToken(signLogoutToken(MEMBER_SUBJECT, OTHER_SESSION_ID));
    assert.deepEqual(
      fakeDatabase.endedSessions.map((endedSession) => endedSession.session_id),
      [OTHER_SESSION_ID],
    );
  });
});

describe("iam mode: CORS", () => {
  it("answers the frontend origin with credentials, never with a wildcard", async () => {
    const response = await iamApp.inject({method: "GET", url: "/api/me", headers: {origin: FRONTEND_ORIGIN, ...adminHeaders()}});
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["access-control-allow-origin"], FRONTEND_ORIGIN);
    assert.equal(response.headers["access-control-allow-credentials"], "true");
    assert.match(String(response.headers.vary), /Origin/);
  });

  it("gives another origin no CORS header", async () => {
    const response = await iamApp.inject({method: "GET", url: "/api/me", headers: {origin: FOREIGN_ORIGIN, ...adminHeaders()}});
    assert.equal(response.headers["access-control-allow-origin"], undefined);
    assert.equal(response.headers["access-control-allow-credentials"], undefined);
  });

  it("answers the preflight of the frontend and refuses the preflight of another origin", async () => {
    const allowed = await iamApp.inject({
      method: "OPTIONS",
      url: "/api/task",
      headers: {
        origin: FRONTEND_ORIGIN,
        "access-control-request-method": "PUT",
        "access-control-request-headers": "content-type",
      },
    });
    assert.equal(allowed.statusCode, 204);
    assert.equal(allowed.headers["access-control-allow-origin"], FRONTEND_ORIGIN);
    assert.match(allowed.headers["access-control-allow-methods"], /PUT/);
    assert.match(allowed.headers["access-control-allow-headers"], /Content-Type/);

    const refused = await iamApp.inject({
      method: "OPTIONS",
      url: "/api/task",
      headers: {origin: FOREIGN_ORIGIN, "access-control-request-method": "PUT"},
    });
    assert.equal(refused.statusCode, 403);
    assert.equal(refused.headers["access-control-allow-origin"], undefined);
  });

  it("refuses a write from another origin before the route, even with a valid admin token", async () => {
    const response = await iamApp.inject({
      method: "DELETE",
      url: "/api/user",
      payload: {id: MEMBER_ID},
      headers: {...adminHeaders(), origin: FOREIGN_ORIGIN},
    });
    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.json(), {error: "cross_origin"});
    assert.equal(fakeDatabase.queries.length, 0);

    const fromFrontend = await iamApp.inject({
      method: "DELETE",
      url: "/api/user",
      payload: {id: MEMBER_ID},
      headers: {...adminHeaders(), origin: FRONTEND_ORIGIN},
    });
    assert.equal(fromFrontend.statusCode, 200);
  });
});

describe("iam mode: GET /api/auth/callback", () => {
  const ACCESS_DENIED_PAGE = `${FRONTEND_ORIGIN}/auth/access?reason=access_denied`;
  const SIGN_IN_FAILED_PAGE = `${FRONTEND_ORIGIN}/auth/access?reason=sign_in_failed`;

  // Starts a sign-in the way a browser does: the state cookie, and the state and nonce of the authorization request
  const startSignIn = async (loginQuery = "returnTo=/tasks") => {
    const response = await iamApp.inject({method: "GET", url: `/api/auth/login?${loginQuery}`});
    const authorizationUrl = new URL(response.headers.location);
    return {
      cookie: []
        .concat(response.headers["set-cookie"])
        .map((setCookie) => setCookie.split(";")[0])
        .join("; "),
      state: authorizationUrl.searchParams.get("state"),
      nonce: authorizationUrl.searchParams.get("nonce"),
    };
  };
  const callback = (query, cookie) =>
    iamApp.inject({method: "GET", url: `/api/auth/callback?${query}`, headers: cookie ? {cookie} : {}});
  const expectRedirectTo = (response, expectedLocation) => {
    assert.equal(response.statusCode, 303);
    assert.equal(response.headers.location, expectedLocation);
    assert.equal(response.body, "");
    assert.doesNotMatch(String(response.headers["set-cookie"]), /access_token=[^;]/, "a failed sign-in sets no token");
  };

  it("leaves a successful callback as it is: token cookies and a 303 to the page the sign-in asked for", async () => {
    const signIn = await startSignIn();
    fakeIam.expectedNonce = signIn.nonce;
    const response = await callback(`code=one-time-code&state=${signIn.state}`, signIn.cookie);

    assert.equal(response.statusCode, 303);
    assert.equal(response.headers.location, `${FRONTEND_ORIGIN}/tasks`);
    const setCookies = [].concat(response.headers["set-cookie"]).join("\n");
    assert.match(setCookies, /access_token=[^;]+; Path=\/; .*HttpOnly/);
    assert.match(setCookies, /refresh_token=[^;]+; Path=\/api\/auth; .*HttpOnly/);
  });

  it("finishes a sign-in with another account (prompt=login) through the same callback", async () => {
    const signIn = await startSignIn("returnTo=/tasks&prompt=login");
    fakeIam.expectedNonce = signIn.nonce;
    const response = await callback(`code=one-time-code&state=${signIn.state}`, signIn.cookie);

    assert.equal(response.statusCode, 303);
    assert.equal(response.headers.location, `${FRONTEND_ORIGIN}/tasks`);
    assert.match([].concat(response.headers["set-cookie"]).join("\n"), /access_token=[^;]+; Path=\/; .*HttpOnly/);
  });

  it("sends a sign-in the IAM refused (no role in this application) to the frontend with reason=access_denied", async () => {
    const signIn = await startSignIn();
    const response = await callback(`error=access_denied&error_description=no+role&state=${signIn.state}`, signIn.cookie);
    expectRedirectTo(response, ACCESS_DENIED_PAGE);
  });

  it("sends a callback without the sign-in cookie to the frontend with reason=sign_in_failed", async () => {
    expectRedirectTo(await callback("code=x&state=y"), SIGN_IN_FAILED_PAGE);
  });

  it("sends a state mismatch and a failed token exchange to the frontend with reason=sign_in_failed", async () => {
    const signIn = await startSignIn();
    expectRedirectTo(await callback("code=x&state=another-state", signIn.cookie), SIGN_IN_FAILED_PAGE);

    fakeIam.tokenStatus = 400;
    expectRedirectTo(await callback(`code=x&state=${signIn.state}`, signIn.cookie), SIGN_IN_FAILED_PAGE);
  });

  it("copies nothing of the query string into the redirect", async () => {
    const signIn = await startSignIn();
    const hostileQueries = [
      `error=${encodeURIComponent("<script>alert(1)</script>")}&error_description=${encodeURIComponent("https://evil.example/")}&state=${signIn.state}`,
      `error=server_error&error_description=reflected-text&error_uri=${encodeURIComponent("https://evil.example/")}&state=${signIn.state}`,
      `error=access_denied%26reason%3Dok&state=${signIn.state}`,
      "reason=ok&returnTo=https%3A%2F%2Fevil.example%2F",
    ];
    for (const hostileQuery of hostileQueries) {
      const response = await callback(hostileQuery, signIn.cookie);
      expectRedirectTo(response, SIGN_IN_FAILED_PAGE);
    }

    const denied = await callback(
      `error=access_denied&error_description=${encodeURIComponent("reflected <b>text</b>")}&state=${signIn.state}`,
      signIn.cookie,
    );
    expectRedirectTo(denied, ACCESS_DENIED_PAGE);
  });

  it("keeps JSON answers on every other route", async () => {
    const refresh = await iamApp.inject({method: "POST", url: "/api/auth/refresh", headers: {origin: FRONTEND_ORIGIN}});
    assert.equal(refresh.statusCode, 401);
    assert.deepEqual(refresh.json(), {error: "session_ended"});

    const foreignLogout = await iamApp.inject({method: "POST", url: "/api/auth/logout", headers: {origin: FOREIGN_ORIGIN}});
    assert.equal(foreignLogout.statusCode, 403);
    assert.deepEqual(foreignLogout.json(), {error: "cross_origin"});

    const forbidden = await iamApp.inject({method: "GET", url: "/api/task", headers: memberHeaders()});
    assert.equal(forbidden.statusCode, 403);
    assert.deepEqual(forbidden.json(), {code: 403, message: "Forbidden"});

    const badRequest = await iamApp.inject({method: "GET", url: "/api/task/not-a-uuid", headers: memberHeaders()});
    assert.equal(badRequest.statusCode, 400);
    assert.deepEqual(badRequest.json(), {code: 400, message: "Wrong format uuid"});
  });
});
