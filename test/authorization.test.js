const {describe, it, before, after, beforeEach} = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const jwt = require("jsonwebtoken");

// The route rules, on their own. The sign-in is a stand-in hook: what VTK IAM's hook does is tested in
// iam-mode.test.js. The stand-in reads a token signed with this test-only secret
const TEST_TOKEN_SECRET = "test-token-secret";

// Put a fake module into the require cache so the code under test loads it instead of the real one
const stubSourceModule = (relativePath, fakeExports) => {
  const filename = require.resolve(path.join(__dirname, "../src", relativePath));
  const fakeModule = new Module(filename);
  fakeModule.filename = filename;
  fakeModule.loaded = true;
  fakeModule.exports = fakeExports;
  require.cache[filename] = fakeModule;
};

const ADMIN_EMAIL = "admin@gmail.com";
const USER_EMAIL = "user@gmail.com";
const OTHER_USER_EMAIL = "other@gmail.com";
const OWN_TASK_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_TASK_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "44444444-4444-4444-8444-444444444444";
const ADMIN_ID = "55555555-5555-4555-8555-555555555555";
const OTHER_USER_ID = "66666666-6666-4666-8666-666666666666";

// Stubbed pg pool: answers from a small in-memory picture of the database and records every query
const fakeDatabase = {
  queries: [],
  roleByEmail: {},
  emailsByUserId: {},
  taskOwnerById: {},
  reset() {
    this.queries = [];
    this.roleByEmail = {[ADMIN_EMAIL]: 1, [USER_EMAIL]: 0, [OTHER_USER_EMAIL]: 0};
    this.emailsByUserId = {[ADMIN_ID]: [ADMIN_EMAIL], [USER_ID]: [USER_EMAIL], [OTHER_USER_ID]: [OTHER_USER_EMAIL]};
    this.taskOwnerById = {[OWN_TASK_ID]: USER_EMAIL, [OTHER_TASK_ID]: OTHER_USER_EMAIL};
  },
  answer(sql, params) {
    if (/SELECT role FROM "user" WHERE email = \$1/.test(sql)) {
      const role = this.roleByEmail[params[0]];
      return role === undefined ? [] : [{role}];
    }
    if (/SELECT role FROM "user" WHERE id = \$1/.test(sql)) {
      return (this.emailsByUserId[params[0]] ?? []).map((email) => ({role: this.roleByEmail[email]}));
    }
    if (/COUNT\(\*\) AS total FROM "user" WHERE role = \$1 AND id <> \$2/.test(sql)) {
      const emailsToDelete = this.emailsByUserId[params[1]] ?? [];
      const adminsLeft = Object.entries(this.roleByEmail).filter(
        ([email, role]) => role === 1 && !emailsToDelete.includes(email),
      );
      return [{total: String(adminsLeft.length)}];
    }
    if (/COUNT\(\*\)/.test(sql)) {
      return [{total: String(Object.values(this.roleByEmail).filter((role) => role === 1).length)}];
    }
    if (/SELECT id FROM task WHERE id = \$1 AND user_mail = \$2/.test(sql)) {
      return this.taskOwnerById[params[0]] === params[1] ? [{id: params[0]}] : [];
    }
    if (/SELECT id FROM project WHERE name = \$1/.test(sql)) {
      return [];
    }
    return [{id: USER_ID, name: "user", email: USER_EMAIL, role: 0}];
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

const allRouter = require("../src/routes/routes");

// Sets req.user the way the IAM hook does: the role (and so isAdmin) comes with the token
const authenticate = async (req, res) => {
  try {
    const token = String(req.headers.authorization || "").replace(/^Bearer /, "");
    const {name, email, role} = jwt.verify(token, TEST_TOKEN_SECRET, {algorithms: ["HS256"]});
    req.user = {name, email, role, isAdmin: role === 1};
  } catch {
    return res.status(401).send({code: 401, message: "Unauthorized"});
  }
};

const signAccessToken = (email, role) => jwt.sign({name: "test", email, role}, TEST_TOKEN_SECRET, {expiresIn: "15m"});
const bearer = (token) => ({authorization: `Bearer ${token}`});
const adminHeaders = () => bearer(signAccessToken(ADMIN_EMAIL, 1));
const userHeaders = () => bearer(signAccessToken(USER_EMAIL, 0));

// The queries a route ran. The role comes with the token, so the authorization hooks read nothing
const routeQueries = () => fakeDatabase.queries;

const taskBody = (id) => ({
  id,
  user_mail: OTHER_USER_EMAIL,
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

// Every route the frontend offers to admins only
const adminOnlyRoutes = [
  {method: "DELETE", url: "/api/user", payload: {id: USER_ID}},
  {method: "POST", url: "/api/project", payload: projectBody},
  {method: "PUT", url: "/api/project", payload: projectBody},
  {method: "DELETE", url: "/api/project", payload: {id: PROJECT_ID}},
  {method: "GET", url: "/api/task"},
  {method: "POST", url: "/api/task", payload: taskBody(undefined)},
  {method: "DELETE", url: "/api/task", payload: {id: OTHER_TASK_ID}},
  {method: "GET", url: `/api/gettaskbyprojectid/${PROJECT_ID}`},
];

let app;

before(async () => {
  app = require("fastify")();
  app.register(allRouter, {prefix: "/api", authenticate});
  await app.ready();
});

after(async () => {
  await app.close();
});

beforeEach(() => fakeDatabase.reset());

describe("Admin-only routes", () => {
  for (const route of adminOnlyRoutes) {
    it(`${route.method} ${route.url} answers a normal user with 403 and runs nothing`, async () => {
      const response = await app.inject({...route, headers: userHeaders()});
      assert.equal(response.statusCode, 403);
      assert.deepEqual(response.json(), {code: 403, message: "Forbidden"});
      assert.deepEqual(routeQueries(), []);
    });

    it(`${route.method} ${route.url} lets an admin through`, async () => {
      const response = await app.inject({...route, headers: adminHeaders()});
      assert.equal(response.statusCode, 200, response.body);
      assert.ok(routeQueries().length > 0);
    });
  }
});

describe("Routes limited to the caller's own data", () => {
  for (const url of ["/api/gettaskbyuser", "/api/getprojectbyuser"]) {
    it(`GET ${url}/:email answers a normal user asking for another user with 403`, async () => {
      const response = await app.inject({method: "GET", url: `${url}/${OTHER_USER_EMAIL}`, headers: userHeaders()});
      assert.equal(response.statusCode, 403);
      assert.deepEqual(routeQueries(), []);
    });

    it(`GET ${url}/:email lets a normal user read their own data and an admin read anyone's`, async () => {
      const own = await app.inject({method: "GET", url: `${url}/${USER_EMAIL}`, headers: userHeaders()});
      assert.equal(own.statusCode, 200);
      assert.deepEqual(routeQueries().at(-1).params, [USER_EMAIL]);

      const admin = await app.inject({method: "GET", url: `${url}/${OTHER_USER_EMAIL}`, headers: adminHeaders()});
      assert.equal(admin.statusCode, 200);
      assert.deepEqual(routeQueries().at(-1).params, [OTHER_USER_EMAIL]);
    });
  }

  it("PUT /api/user lets a normal user rename only themselves", async () => {
    const other = await app.inject({
      method: "PUT",
      url: "/api/user",
      payload: {email: OTHER_USER_EMAIL, name: "x"},
      headers: userHeaders(),
    });
    assert.equal(other.statusCode, 403);
    assert.deepEqual(routeQueries(), []);

    const own = await app.inject({
      method: "PUT",
      url: "/api/user",
      payload: {email: USER_EMAIL, name: "x"},
      headers: userHeaders(),
    });
    assert.equal(own.statusCode, 200);

    const admin = await app.inject({
      method: "PUT",
      url: "/api/user",
      payload: {email: OTHER_USER_EMAIL, name: "x"},
      headers: adminHeaders(),
    });
    assert.equal(admin.statusCode, 200);
  });

  it("PUT /api/task lets a normal user change only the status of their own task", async () => {
    const other = await app.inject({method: "PUT", url: "/api/task", payload: taskBody(OTHER_TASK_ID), headers: userHeaders()});
    assert.equal(other.statusCode, 403);
    assert.ok(!fakeDatabase.queries.some(({sql}) => /UPDATE/.test(sql)));

    const own = await app.inject({method: "PUT", url: "/api/task", payload: taskBody(OWN_TASK_ID), headers: userHeaders()});
    assert.equal(own.statusCode, 200);
    const updates = fakeDatabase.queries.filter(({sql}) => /UPDATE/.test(sql));
    assert.equal(updates.length, 1);
    assert.equal(updates[0].sql, "UPDATE task SET status = $1 WHERE id = $2");
    assert.deepEqual(updates[0].params, ["3", OWN_TASK_ID]);
  });

  it("PUT /api/task lets an admin change every field of any task", async () => {
    const response = await app.inject({
      method: "PUT",
      url: "/api/task",
      payload: taskBody(OTHER_TASK_ID),
      headers: adminHeaders(),
    });
    assert.equal(response.statusCode, 200);
    const update = fakeDatabase.queries.find(({sql}) => /UPDATE/.test(sql));
    assert.match(update.sql, /SET user_mail = \$1/);
    assert.equal(update.params.at(-1), OTHER_TASK_ID);
  });

  it("GET /api/user gives a normal user only their own row and an admin every row", async () => {
    await app.inject({method: "GET", url: "/api/user", headers: userHeaders()});
    const userQuery = routeQueries().at(-1);
    assert.match(userQuery.sql, /WHERE email = \$1/);
    assert.deepEqual(userQuery.params, [USER_EMAIL]);

    await app.inject({method: "GET", url: "/api/user", headers: adminHeaders()});
    assert.ok(!/WHERE/.test(routeQueries().at(-1).sql));
  });

  it("GET /api/user/:id gives a normal user only their own row", async () => {
    await app.inject({method: "GET", url: `/api/user/${USER_ID}`, headers: userHeaders()});
    const userQuery = routeQueries().at(-1);
    assert.match(userQuery.sql, /WHERE id = \$1 AND email = \$2/);
    assert.deepEqual(userQuery.params, [USER_ID, USER_EMAIL]);
  });

  it("GET /api/project and /api/project/:id give a normal user only the projects they have a task in", async () => {
    await app.inject({method: "GET", url: "/api/project", headers: userHeaders()});
    const listQuery = routeQueries().at(-1);
    assert.match(listQuery.sql, /WHERE a\.user_mail = \$1/);
    assert.deepEqual(listQuery.params, [USER_EMAIL]);

    await app.inject({method: "GET", url: `/api/project/${PROJECT_ID}`, headers: userHeaders()});
    const oneQuery = routeQueries().at(-1);
    assert.match(oneQuery.sql, /a\.user_mail = \$2/);
    assert.deepEqual(oneQuery.params, [PROJECT_ID, USER_EMAIL]);

    await app.inject({method: "GET", url: "/api/project", headers: adminHeaders()});
    assert.ok(!/WHERE/.test(routeQueries().at(-1).sql));
  });

  it("GET /api/task/:id gives a normal user only their own task", async () => {
    await app.inject({method: "GET", url: `/api/task/${OWN_TASK_ID}`, headers: userHeaders()});
    const taskQuery = routeQueries().at(-1);
    assert.match(taskQuery.sql, /a\."user_mail" = \$2/);
    assert.deepEqual(taskQuery.params, [OWN_TASK_ID, USER_EMAIL]);
  });
});

describe("DELETE /api/user", () => {
  const deleteUser = (id, headers = adminHeaders()) => app.inject({method: "DELETE", url: "/api/user", payload: {id}, headers});
  const userDeletes = () => fakeDatabase.queries.filter(({sql}) => /DELETE FROM "user"/.test(sql));

  it("refuses to delete the last admin, themselves included", async () => {
    const response = await deleteUser(ADMIN_ID);
    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), {code: 400, message: "Cannot remove the last admin"});
    assert.deepEqual(userDeletes(), []);
  });

  it("lets an admin delete one of two admins", async () => {
    fakeDatabase.roleByEmail[OTHER_USER_EMAIL] = 1;
    const response = await deleteUser(OTHER_USER_ID);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(userDeletes()[0].params, [OTHER_USER_ID]);
  });

  it("refuses a delete that would remove every admin at once (one id matching several admin rows)", async () => {
    fakeDatabase.roleByEmail[OTHER_USER_EMAIL] = 1;
    fakeDatabase.emailsByUserId[ADMIN_ID] = [ADMIN_EMAIL, OTHER_USER_EMAIL];
    const response = await deleteUser(ADMIN_ID);
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().message, "Cannot remove the last admin");
    assert.deepEqual(userDeletes(), []);
  });

  it("refuses several ids in one request instead of deleting any of them", async () => {
    fakeDatabase.roleByEmail[OTHER_USER_EMAIL] = 1;
    const response = await deleteUser([ADMIN_ID, OTHER_USER_ID]);
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().message, "Wrong format uuid");
    assert.deepEqual(routeQueries(), []);
    assert.deepEqual(userDeletes(), []);
  });

  it("deletes a normal user without counting admins", async () => {
    const response = await deleteUser(USER_ID);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(userDeletes()[0].params, [USER_ID]);
    assert.ok(!fakeDatabase.queries.some(({sql}) => /COUNT/.test(sql)));
  });

  it("answers a normal user with 403 before any query", async () => {
    const response = await deleteUser(ADMIN_ID, userHeaders());
    assert.equal(response.statusCode, 403);
    assert.deepEqual(routeQueries(), []);
  });
});
