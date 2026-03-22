const bcrypt = require("bcryptjs");
const logger = require("../loggers/loggers.config");

// Sử dụng hàm hash của bcrypt để băm mật khẩu
async function hashPassword(password) {
  try {
    const hash = await bcrypt.hash(password, 10);
    return hash;
  } catch (error) {
    console.log("Không thể băm mật khẩu 🔥:: ");
    logger.error(error);
    throw new Error("Không thể băm mật khẩu");
  }
}

// So sánh mật khẩu nhập vào với mật khẩu đã được băm
async function compareHashPassword(inputPassword, hashedPassword) {
  try {
    const match = await bcrypt.compare(inputPassword, hashedPassword);
    return match;
  } catch (error) {
    console.log("Không thể so sánh mật khẩu 🔥:: ");
    logger.error(error);
    throw new Error("Không thể so sánh mật khẩu");
  }
}

module.exports = {hashPassword, compareHashPassword};
