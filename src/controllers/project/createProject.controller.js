const escape = require("escape-html");
const logger = require("../../loggers/loggers.config");
const QueryDatabase = require("../../utils/queryDatabase");

const CreateProject = async (req, res, next) => {
  try {
    const name = escape(req.body.name);
    const payment = escape(req.body.payment);
    const time_start = escape(req.body.time_start);
    const time_end = escape(req.body.time_end);
    const note = escape(req.body.note);
    const priority = escape(req.body.priority);

    // Check name của project tạo mới ko được trùng với cái đã có trong hệ thống (so với name đã escape như lúc lưu)
    const checkName = await QueryDatabase(`SELECT id FROM project WHERE name = $1`, [name]);
    if (checkName.rowCount > 0) {
      res.status(400);
      return {code: 400, message: "Project name already exists"};
    }

    const sql = `
      INSERT INTO project (name, payment, time_start , time_end, note, priority) 
      VALUES ($1, $2, $3, $4, $5, $6);
    `;

    await QueryDatabase(sql, [name, payment, time_start, time_end, note, priority]);
    return {code: 200, message: "Create project success"};
  } catch (error) {
    logger.error(error);
    res.status(500);
    return {code: 500, message: "Internal Server Error"};
  }
};

module.exports = CreateProject;
