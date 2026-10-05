const {describe, it, beforeEach, afterEach, mock} = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const bcrypt = require("bcryptjs");
const escape = require("escape-html");
const jwt = require("jsonwebtoken");

// Test-only secrets; the real .env is never loaded here
process.env.ACCESS_TOKEN = "test-access-token-secret";
process.env.REFRESH_TOKEN = "test-refresh-token-secret";
process.env.EXPIRES_ACCESS_TOKEN = "15m";
process.env.EXPIRES_REFRESH_TOKEN = "7d";

// Put a fake module into the require cache so the code under test loads it instead of the real one
const stubSourceModule = (relativePath, fakeExports) => {
  const filename = require.resolve(path.join(__dirname, "../src", relativePath));
  const fakeModule = new Module(filename);
  fakeModule.filename = filename;
  fakeModule.loaded = true;
  fakeModule.exports = fakeExports;
  require.cache[filename] = fakeModule;
};

// Stubbed pg pool: records every query and never touches a real database
const fakeDatabase = {
  queries: [],
  rows: [],
  error: null,
  releasedClients: 0,
  reset() {
    this.queries = [];
    this.rows = [];
    this.error = null;
    this.releasedClients = 0;
  },
  async connect() {
    return {
      query: async (sql, params) => {
        fakeDatabase.queries.push({sql, params});
        if (fakeDatabase.error) throw fakeDatabase.error;
        return {rows: fakeDatabase.rows, rowCount: fakeDatabase.rows.length};
      },
      release: () => {
        fakeDatabase.releasedClients += 1;
      },
    };
  },
};

stubSourceModule("connection/database.connection.js", fakeDatabase);
stubSourceModule("loggers/loggers.config.js", {error() {}, warn() {}, info() {}});

const {Login} = require("../src/controllers/auth/auth.controller");

// Minimal Fastify reply: Login only calls reply.status()
const createReply = () => ({
  statusCode: 200,
  status(code) {
    this.statusCode = code;
    return this;
  },
});

const login = async (email, password) => {
  const reply = createReply();
  const body = await Login({body: {email, password}}, reply);
  return {status: reply.statusCode, body};
};

// v1 hashes escape-html(password) with bcrypt cost 10 (CreateUser + hashPassword)
const v1PasswordHash = (plainPassword) => bcrypt.hashSync(escape(plainPassword), 10);

const existingUser = {
  name: "test",
  email: "test@gmail.com",
  password: v1PasswordHash(`p&ss<'w"rd>`),
  role: 0,
};

describe("Login (SEC-08)", () => {
  beforeEach(() => fakeDatabase.reset());
  afterEach(() => mock.restoreAll());

  it("looks the user up with a parameter, never by building SQL from the input or loading the whole table", async () => {
    const injectedEmail = `admin@gmail.com' OR '1'='1`;
    await login(injectedEmail, "anything");

    assert.equal(fakeDatabase.queries.length, 1);
    const [{sql, params}] = fakeDatabase.queries;
    assert.match(sql, /WHERE email = \$1/);
    assert.match(sql, /LIMIT 1/);
    assert.ok(!sql.includes("admin@gmail.com"), "the email must not be part of the SQL text");
    assert.deepEqual(params, [escape(injectedEmail)]);
    assert.equal(fakeDatabase.releasedClients, 1);
  });

  it("signs in with a v1 hash (bcrypt of the escape-html'd password) and puts name, email and role in both tokens", async () => {
    fakeDatabase.rows = [existingUser];
    const {status, body} = await login("test@gmail.com", `p&ss<'w"rd>`);

    assert.equal(status, 200);
    const accessClaims = jwt.verify(body.access_token, process.env.ACCESS_TOKEN, {algorithms: ["HS256"]});
    const refreshClaims = jwt.verify(body.refresh_token, process.env.REFRESH_TOKEN, {algorithms: ["HS256"]});
    for (const claims of [accessClaims, refreshClaims]) {
      assert.equal(claims.name, "test");
      assert.equal(claims.email, "test@gmail.com");
      assert.equal(claims.role, 0);
    }
  });

  it("keeps the escape-html step (a v1 hash does not match the raw password) and refuses the hash string as a password", async () => {
    // The raw password does not match the v1 hash without escaping, which proves the escape step is still applied
    assert.equal(bcrypt.compareSync(`p&ss<'w"rd>`, existingUser.password), false);

    fakeDatabase.rows = [existingUser];
    const {status} = await login("test@gmail.com", existingUser.password);
    assert.equal(status, 401);
  });

  it("answers an unknown email and a wrong password with the same status and body", async () => {
    fakeDatabase.rows = [];
    const unknownEmail = await login("nobody@gmail.com", "whatever");

    fakeDatabase.reset();
    fakeDatabase.rows = [existingUser];
    const wrongPassword = await login("test@gmail.com", "wrong-password");

    assert.equal(unknownEmail.status, 401);
    assert.equal(wrongPassword.status, unknownEmail.status);
    assert.deepEqual(wrongPassword.body, unknownEmail.body);
    assert.equal(unknownEmail.body.access_token, undefined);
  });

  it("still runs one bcrypt compare at cost 10 when the email is unknown, so timing does not reveal the account", async () => {
    const compareSpy = mock.method(bcrypt, "compare");

    fakeDatabase.rows = [];
    const {status} = await login("nobody@gmail.com", "whatever");

    assert.equal(status, 401);
    assert.equal(compareSpy.mock.callCount(), 1);
    const [comparedPassword, comparedHash] = compareSpy.mock.calls[0].arguments;
    assert.equal(comparedPassword, "whatever");
    assert.match(comparedHash, /^\$2[aby]\$10\$/);
  });

  it("refuses even if the dummy hash were to match, because no account was found", async () => {
    mock.method(bcrypt, "compare", async () => true);

    fakeDatabase.rows = [];
    const {status, body} = await login("nobody@gmail.com", "whatever");

    assert.equal(status, 401);
    assert.equal(body.access_token, undefined);
  });

  it("answers a database error with a generic 500 and releases the client", async () => {
    mock.method(console, "error", () => {});
    fakeDatabase.error = new Error("connection refused");

    const {status, body} = await login("test@gmail.com", "whatever");

    assert.equal(status, 500);
    assert.deepEqual(body, {code: 500, message: "Internal Server Error"});
    assert.equal(fakeDatabase.releasedClients, 1);
  });
});
