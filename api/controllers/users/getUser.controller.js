import escape from "escape-html";
import QueryDatabase from "../../utils/queryDatabase.js";
import logger from "../../loggers/loggers.config.js";

const GetUser = async (req, res, next) => {
  try {
    const sql = `
      SELECT * FROM "user";
    `;

    const data = await QueryDatabase(sql);
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
    const sql = `
      SELECT * FROM "user" WHERE id = '${id}'
    `;

    const data = await QueryDatabase(sql);
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

export {GetUser, GetUserById};
