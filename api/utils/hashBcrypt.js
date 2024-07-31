import {hash as _hash, compare} from "bcrypt";
import logger from "../loggers/loggers.config.js";

// Sử dụng hàm hash của bcrypt để băm mật khẩu
export async function hashPassword(password) {
  try {
    const hash = await _hash(password, 10);
    return hash;
  } catch (error) {
    console.log("Không thể băm mật khẩu 🔥:: ");
    logger.error(error);
    throw new Error("Không thể băm mật khẩu");
  }
}

// So sánh mật khẩu nhập vào với mật khẩu đã được băm
export async function compareHashPassword(inputPassword, hashedPassword) {
  try {
    const match = await compare(inputPassword, hashedPassword);
    return match;
  } catch (error) {
    console.log("Không thể so sánh mật khẩu 🔥:: ");
    _error(error);
    throw new Error("Không thể so sánh mật khẩu");
  }
}
