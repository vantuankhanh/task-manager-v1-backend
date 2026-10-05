const escape = require("escape-html");
const logger = require("../../loggers/loggers.config");
const QueryDatabase = require("../../utils/queryDatabase");
const {IsAdmin} = require("../../middlewares/authorize");
const {v4: uuidv4, validate: validateUuid} = require("uuid");

const PutTask = async (req, res, next) => {
  try {
    const user_mail = escape(req.body.user_mail);
    const project_id = escape(req.body.project_id);
    const time_start = escape(req.body.time_start);
    const time_end = escape(req.body.time_end);
    const status = escape(req.body.status);
    const note = escape(req.body.note);
    const id = escape(req.body.id);

    // Check có truyền vào id hay ko
    if (!id) {
      res.status(400);
      return {code: 400, message: "Missing id"};
    }
    // Kiểm tra xem project_id đúng định dạng uuid ko
    const isValidUuid = validateUuid(id);
    if (isValidUuid == false) {
      res.status(400);
      return {code: 400, message: "Wrong format uuid"};
    }

    // Normal user: only the status of their own task (the only field the frontend lets them edit)
    if (!(await IsAdmin(req))) {
      const checkOwnTask = await QueryDatabase(`SELECT id FROM task WHERE id = $1 AND user_mail = $2`, [id, req.user.email]);
      if (checkOwnTask.rowCount === 0) {
        res.status(403);
        return {code: 403, message: "Forbidden"};
      }

      await QueryDatabase(`UPDATE task SET status = $1 WHERE id = $2`, [status, id]);
      return {code: 200, message: "Update task success"};
    }

    const sql = `
      UPDATE task 
      SET user_mail = $1,
      project_id = $2,
      time_start = $3,
      time_end = $4,
      status = $5,
      note = $6
      WHERE id = $7
    `;
    await QueryDatabase(sql, [user_mail, project_id, time_start, time_end, status, note, id]);
    return {code: 200, message: "Update task success"};
  } catch (error) {
    logger.error(error);
    res.status(500);
    return {code: 500, message: "Internal Server Error"};
  }
};

module.exports = PutTask;
