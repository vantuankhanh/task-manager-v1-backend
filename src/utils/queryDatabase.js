const db = require("../connection/database.connection");
const logger = require("../loggers/loggers.config");

// sql holds only placeholders ($1, $2, ...); every value goes in params, never into the sql string
const QueryDatabase = async (sql, params = []) => {
  let client;
  try {
    client = await db.connect();
    const data = await client.query(sql, params);
    return data;
  } catch (err) {
    console.error("Database Query Error 🔥:: ");
    logger.error(err);
    throw err; // Ném lại lỗi để xử lý ở nơi gọi hàm
  } finally {
    if (client) client.release(); // Giải phóng client sau khi sử dụng, kể cả khi query lỗi
  }
};

module.exports = QueryDatabase;
