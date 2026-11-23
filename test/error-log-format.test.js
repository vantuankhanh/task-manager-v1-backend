const {describe, it} = require("node:test");
const assert = require("node:assert/strict");
const {Writable} = require("node:stream");
const {createLogger, format, transports} = require("winston");
const {errorLogFormat, DescribeErrorForLog} = require("../src/loggers/errorLogFormat");

// A logger with the same error format as src/loggers/loggers.config.js, writing into memory instead of the log file
const createCapturingLogger = () => {
  const writtenLines = [];
  const memoryStream = new Writable({
    write(chunk, encoding, done) {
      writtenLines.push(chunk.toString().trimEnd());
      done();
    },
  });
  const logger = createLogger({
    format: format.combine(
      errorLogFormat(),
      format.printf(({level, message}) => `${level}: ${message}`),
    ),
    transports: [new transports.Stream({stream: memoryStream})],
  });
  return {logger, writtenLines};
};

const createDatabaseLikeError = () => {
  const databaseError = new Error('duplicate key value violates unique constraint "users_email_key" for someone@example.com');
  databaseError.name = "error";
  databaseError.detail = "Key (email)=(someone@example.com) already exists.";
  databaseError.query = "INSERT INTO users (email) VALUES ('someone@example.com')";
  return databaseError;
};

describe("error log format", () => {
  it("writes the error name and stack frames but not the message, detail or query", () => {
    const {logger, writtenLines} = createCapturingLogger();
    logger.error(createDatabaseLikeError());

    const written = writtenLines.join("");
    assert.ok(!written.includes("someone@example.com"), written);
    assert.ok(!written.includes("duplicate key"), written);
    assert.ok(!written.includes("INSERT INTO"), written);
    assert.match(written, /^error: error\n/);
    assert.match(written, /\n\s+at .*error-log-format\.test\.js:\d+:\d+/);
  });

  it("does not change the Error object of the caller", () => {
    const {logger} = createCapturingLogger();
    const databaseError = createDatabaseLikeError();
    const originalMessage = databaseError.message;
    logger.error(databaseError);

    assert.equal(databaseError.message, originalMessage);
    assert.equal(databaseError.detail, "Key (email)=(someone@example.com) already exists.");
  });

  it("drops the lines of a multi-line message because they are not stack frames", () => {
    const {logger, writtenLines} = createCapturingLogger();
    logger.error(new Error("first line\nsomeone@example.com on the second line"));

    assert.ok(!writtenLines.join("").includes("someone@example.com"));
    assert.ok(!writtenLines.join("").includes("second line"));
  });

  it("keeps the own text of logger.error(text, error) and removes the error message", () => {
    const {logger, writtenLines} = createCapturingLogger();
    logger.error("Sending the mail failed", createDatabaseLikeError());

    const written = writtenLines.join("");
    assert.ok(!written.includes("someone@example.com"), written);
    assert.match(written, /^error: Sending the mail failed error\n/);
    assert.match(written, /\n\s+at /);
  });

  it("logs strings and undefined without crashing", () => {
    const {logger, writtenLines} = createCapturingLogger();
    assert.doesNotThrow(() => logger.error("plain text"));
    assert.doesNotThrow(() => logger.error(undefined));
    assert.doesNotThrow(() => logger.error(null));
    assert.doesNotThrow(() => logger.error({message: "a plain object"}));
    assert.equal(writtenLines[0], "error: plain text");
    assert.equal(writtenLines[3], "error: a plain object");
  });

  it("keeps a safe error code next to the name but still drops the email address", () => {
    const {logger, writtenLines} = createCapturingLogger();
    const databaseError = createDatabaseLikeError();
    databaseError.code = "23505";
    logger.error(databaseError);

    const written = writtenLines.join("");
    assert.ok(!written.includes("someone@example.com"), written);
    assert.match(written, /^error: error code=23505\n/);
    assert.match(written, /\n\s+at /);
  });

  it("keeps a safe error code in the form logger.error(text, error)", () => {
    const {logger, writtenLines} = createCapturingLogger();
    const connectionError = new Error("connect failed for someone@example.com");
    connectionError.code = "ECONNREFUSED";
    logger.error("Connecting failed", connectionError);

    const written = writtenLines.join("");
    assert.ok(!written.includes("someone@example.com"), written);
    assert.match(written, /^error: Connecting failed Error code=ECONNREFUSED\n/);
  });

  it("leaves out an error code that is free text or has an unsafe type", () => {
    const unsafeCodes = ["someone@example.com", "has some spaces", "", "a".repeat(33), {value: "23505"}, ["23505"], null, undefined];
    for (const unsafeCode of unsafeCodes) {
      const {logger, writtenLines} = createCapturingLogger();
      const databaseError = createDatabaseLikeError();
      databaseError.code = unsafeCode;
      logger.error(databaseError);

      const written = writtenLines.join("");
      assert.ok(!written.includes("someone@example.com"), written);
      assert.ok(!written.includes("code="), written);
      assert.match(written, /^error: error\n/);
    }
  });

  it("accepts a numeric error code", () => {
    assert.equal(DescribeErrorForLog("Error", "", 500), "Error code=500");
    assert.equal(DescribeErrorForLog("Error", "", undefined), "Error");
  });

  it("describes an error whose stack is missing or has no frames", () => {
    assert.equal(DescribeErrorForLog("TypeError", ""), "TypeError");
    const errorWithoutStack = new Error("someone@example.com");
    errorWithoutStack.stack = undefined;
    const {logger, writtenLines} = createCapturingLogger();
    assert.doesNotThrow(() => logger.error(errorWithoutStack));
    assert.ok(!writtenLines.join("").includes("someone@example.com"));
  });
});
