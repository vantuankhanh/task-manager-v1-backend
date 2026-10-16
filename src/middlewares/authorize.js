const escape = require("escape-html");
const logger = require("../loggers/loggers.config");

// "user".role: 0 is a normal user, 1 is an admin
const ROLE_ADMIN = 1;

const replyForbidden = (res) => res.status(403).send({code: 403, message: "Forbidden"});

// The IAM hook sets req.user.isAdmin from the roles of the access token (the IAM reads roles at every token
// issue), so nothing is read here. Use after that hook
const IsAdmin = async (req) => req.user.isAdmin === true;

// Hook for admin-only routes. Use after the IAM hook
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
// must be the caller's own email, unless the caller is an admin. Use after the IAM hook; as a preHandler
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
