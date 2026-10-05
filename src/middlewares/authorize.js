const escape = require("escape-html");
const QueryDatabase = require("../utils/queryDatabase");
const logger = require("../loggers/loggers.config");

// "user".role: 0 is a normal user, 1 is an admin
const ROLE_ADMIN = 1;

const replyForbidden = (res) => res.status(403).send({code: 403, message: "Forbidden"});

// The role inside the token is the one from sign-in time and survives every refresh, so it can be stale
// after a role change or a deleted account. The current role is read from the database instead
// (one lookup per request, kept on req.user). Use after VerifyToken
const IsAdmin = async (req) => {
  if (req.user.isAdmin === undefined) {
    const data = await QueryDatabase(`SELECT role FROM "user" WHERE email = $1 LIMIT 1`, [req.user.email]);
    req.user.isAdmin = data.rows.length > 0 && Number(data.rows[0].role) === ROLE_ADMIN;
  }
  return req.user.isAdmin;
};

// Hook for admin-only routes. Use after VerifyToken
const RequireAdmin = async (req, res) => {
  try {
    if (!(await IsAdmin(req))) {
      return replyForbidden(res);
    }
  } catch (error) {
    logger.error(error);
    return res.status(500).send({code: 500, message: "Internal Server Error"});
  }
};

// Hook for routes where a normal user may only act on their own data: the email picked by getEmail(req)
// must be the caller's own email, unless the caller is an admin. Use after VerifyToken; as a preHandler
// when the email is in the body. Emails are stored escaped, so the input is escaped before comparing
const RequireOwnEmailOrAdmin = (getEmail) => async (req, res) => {
  try {
    if (escape(getEmail(req)) === req.user.email) {
      return;
    }
    if (!(await IsAdmin(req))) {
      return replyForbidden(res);
    }
  } catch (error) {
    logger.error(error);
    return res.status(500).send({code: 500, message: "Internal Server Error"});
  }
};

module.exports = {ROLE_ADMIN, IsAdmin, RequireAdmin, RequireOwnEmailOrAdmin};
