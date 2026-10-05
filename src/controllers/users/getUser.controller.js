const escape = require("escape-html");
const QueryDatabase = require("../../utils/queryDatabase");
const logger = require("../../loggers/loggers.config");
const {IsAdmin} = require("../../middlewares/authorize");

const GetUser = async (req, res, next) => {
  try {
    // Admin: every user. Normal user: only their own row
    const isAdmin = await IsAdmin(req);
    const sql = isAdmin
      ? `
      SELECT * FROM "user";
    `
      : `
      SELECT * FROM "user" WHERE email = $1;
    `;

    const data = await QueryDatabase(sql, isAdmin ? [] : [req.user.email]);
    res.send(
      data.rows.map((row) => {
        delete row.password;
        return row;
      }),
    );
  } catch (error) {
    logger.error(error);
    res.status(500);
    return {code: 500, message: "Internal Server Error"};
  }
};

const GetUserById = async (req, res, next) => {
  try {
    const id = escape(req.params.id);
    // Admin: any user. Normal user: only their own row (empty list for anyone else)
    const isAdmin = await IsAdmin(req);
    const sql = isAdmin
      ? `
      SELECT * FROM "user" WHERE id = $1
    `
      : `
      SELECT * FROM "user" WHERE id = $1 AND email = $2
    `;

    const data = await QueryDatabase(sql, isAdmin ? [id] : [id, req.user.email]);
    res.send(
      data.rows.map((row) => {
        delete row.password;
        return row;
      }),
    );
  } catch (error) {
    logger.error(error);
    res.status(500);
    return {code: 500, message: "Internal Server Error"};
  }
};

module.exports = {
  GetUser,
  GetUserById,
};
