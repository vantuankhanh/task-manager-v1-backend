const escape = require("escape-html");
const QueryDatabase = require("../../utils/queryDatabase");
const logger = require("../../loggers/loggers.config");
const {ROLE_ADMIN} = require("../../middlewares/authorize");
const {validate: validateUuid} = require("uuid");

const DeleteUser = async (req, res, next) => {
  try {
    const id = await escape(req.body.id);

    // Check có truyền vào id hay không
    if (!id || id == undefined) {
      res.status(400);
      return {code: 400, message: "Missing id"};
    }
    // Kiểm tra xem id đúng định dạng uuid ko (một id duy nhất, không nhận danh sách)
    if (validateUuid(id) == false) {
      res.status(400);
      return {code: 400, message: "Wrong format uuid"};
    }

    // Check id có trong CSDL hay không
    const checkId = await QueryDatabase(`SELECT role FROM "user" WHERE id = $1`, [id]);
    if (checkId.rowCount === 0) {
      res.status(400);
      return {code: 400, message: "User not found"};
    }

    // The last admin cannot be deleted, by themselves or by anyone else (nobody could manage users afterwards).
    // Counted as "admins left after this delete", so it also holds if the id matches more than one row
    const deletesAdmin = checkId.rows.some((row) => Number(row.role) === ROLE_ADMIN);
    if (deletesAdmin) {
      const countAdminLeft = await QueryDatabase(`SELECT COUNT(*) AS total FROM "user" WHERE role = $1 AND id <> $2`, [
        ROLE_ADMIN,
        id,
      ]);
      if (Number(countAdminLeft.rows[0].total) < 1) {
        res.status(400);
        return {code: 400, message: "Cannot remove the last admin"};
      }
    }

    const sql = `
      DELETE FROM "user" WHERE id = $1;
    `;
    await QueryDatabase(sql, [id]);
    return {code: 200, message: "Delete user success"};
  } catch (error) {
    logger.error(error);
    res.status(500);
    return {code: 500, message: "Internal Server Error"};
  }
};

module.exports = DeleteUser;
