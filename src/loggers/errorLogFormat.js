"use strict";
const {format} = require("winston");

// Winston keeps the level it filters on under this symbol, next to the visible level field
const LEVEL_SYMBOL = Symbol.for("level");

// Matches the stack frame lines ("    at file:line:column") of a V8 stack. The first line of a stack is "Name: message", so it is
// never matched, and neither is any continuation line of a multi-line message
const STACK_FRAME_LINE = /^\s+at /;

// Only a short code made of letters, digits, underscore, dot and hyphen is accepted (PostgreSQL SQLSTATE such as 23505, Node codes
// such as ECONNREFUSED). A code that is free text could carry an email address, so anything else is left out
const SAFE_ERROR_CODE = /^[A-Za-z0-9_.-]{1,32}$/;

// What is written for a logged error: the error name and the stack frames, never the message. PostgreSQL and Mailtrap errors put
// free text in the message and in extra fields (detail, query, where), and that text can hold an email address; personal data
// must not reach the logs when it can be avoided (D49 (c) of VTK IAM). The name is read from the stack when the error object is
// not at hand: it is the text before the first colon, which the message cannot change. The error code is kept when it passes
// SAFE_ERROR_CODE, because it is not personal data and helps debugging (17.48 (b) of VTK IAM)
const DescribeErrorForLog = (errorName, stack, errorCode) => {
  const stackLines = stack.split("\n");
  const frameLines = stackLines.filter((stackLine) => STACK_FRAME_LINE.test(stackLine));
  const nameToLog = typeof errorName === "string" && errorName !== "" ? errorName : stackLines[0].split(":")[0];
  const isErrorCodeAllowed = (typeof errorCode === "string" || typeof errorCode === "number") && SAFE_ERROR_CODE.test(String(errorCode));
  const codeToLog = isErrorCodeAllowed ? ` code=${String(errorCode)}` : "";
  return [`${nameToLog}${codeToLog}`, ...frameLines].join("\n");
};

// Winston format that turns an Error into its safe description. logger.error(error) hands the Error itself to the format, and
// the message of the Error is copied into a new object so the caller's Error is never changed (controllers still read
// error.message after logging). Values that are not errors (strings, undefined, plain objects) pass through untouched, so
// logging never throws on them
const errorLogFormat = format((info) => {
  if (info instanceof Error) {
    // Only the level is copied: detail, query and the other extra fields of the Error stay out of the log record
    const safeInfo = {level: info.level, [LEVEL_SYMBOL]: info[LEVEL_SYMBOL]};
    safeInfo.message = DescribeErrorForLog(info.name, typeof info.stack === "string" ? info.stack : "", info.code);
    return safeInfo;
  }

  if (typeof info.stack === "string") {
    // The form logger.error("text", error): Winston has appended the error message to "text" and copied the stack. Only the
    // error message is removed, the caller's own text stays
    const [loggedError] = info[Symbol.for("splat")] || [];
    const errorMessage = loggedError instanceof Error ? loggedError.message : "";
    const callerText = errorMessage === "" ? info.message : String(info.message).split(errorMessage).join("").trim();
    const errorName = loggedError instanceof Error ? loggedError.name : undefined;
    const errorCode = loggedError instanceof Error ? loggedError.code : undefined;
    info.message = [callerText, DescribeErrorForLog(errorName, info.stack, errorCode)].filter((part) => part).join(" ");
    delete info.stack;
  }
  return info;
});

module.exports = {errorLogFormat, DescribeErrorForLog};
