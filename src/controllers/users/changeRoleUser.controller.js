const escape = require("escape-html");
const QueryDatabase = require("../../utils/queryDatabase");
const logger = require("../../loggers/loggers.config");
const {ROLE_ADMIN} = require("../../middlewares/authorize");

const ChangeRoleUser = async (req, res, next) => {
  try {
    const email = escape(req.body.email);
    const role = escape(req.body.role);

    // role: 0 is a normal user, 1 is an admin
    if (role !== "0" && role !== "1") {
      res.status(400);
      return {code: 400, message: "Role must be 0 or 1"};
    }

    // Check Email có trong CSDL hay không
    const checkEmail = await QueryDatabase(`SELECT role FROM "user" WHERE email = $1`, [email]);
    if (checkEmail.rowCount === 0) {
      res.status(400);
      return {code: 400, message: "Email not found"};
    }

    // The last admin cannot be turned into a normal user (nobody could manage users afterwards)
    if (Number(checkEmail.rows[0].role) === ROLE_ADMIN && Number(role) !== ROLE_ADMIN) {
      const countAdmin = await QueryDatabase(`SELECT COUNT(*) AS total FROM "user" WHERE role = $1`, [ROLE_ADMIN]);
      if (Number(countAdmin.rows[0].total) <= 1) {
        res.status(400);
        return {code: 400, message: "Cannot remove the last admin"};
      }
    }

    const sql = ` UPDATE "user" SET role = $1 WHERE email = $2 `;
    await QueryDatabase(sql, [role, email]);
    return {code: 200, message: "Change role user success"};
  } catch (error) {
    logger.error(error);
    res.status(500);
    return {code: 500, message: "Internal Server Error"};
  }
};

module.exports = ChangeRoleUser;
