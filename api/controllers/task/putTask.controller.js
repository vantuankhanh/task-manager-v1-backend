import escape from "escape-html";
import logger from "../../loggers/loggers.config.js";
import QueryDatabase from "../../utils/queryDatabase.js";
import {v4 as uuidv4, validate as validateUuid} from "uuid";

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

    const sql = `
      UPDATE task 
      SET user_mail = '${user_mail}', 
      project_id = '${project_id}', 
      time_start = '${time_start}', 
      time_end = '${time_end}', 
      status = '${status}', 
      note = '${note}'
      WHERE id = '${id}'
    `;
    await QueryDatabase(sql);
    return {code: 200, message: "Update task success"};
  } catch (error) {
    logger.error(error);
    res.status(500);
    return {code: 500, message: "Internal Server Error"};
  }
};

export default PutTask;
