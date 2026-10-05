const escape = require("escape-html");
const jwt = require("jsonwebtoken");
const {GenerateAccessToken, GenerateRefreshToken} = require("../../utils/generateJWT");
const QueryDatabase = require("../../utils/queryDatabase");
const {compareHashPassword} = require("../../utils/hashBcrypt");
const logger = require("../../loggers/loggers.config");

// bcrypt hash (cost 10, same as hashPassword) of a random value nobody knows. It is compared when the
// email is unknown, so "unknown email" costs the same bcrypt work as "wrong password"
const DUMMY_PASSWORD_HASH = "$2b$10$i.Jf5qNcbHtjpISl/O3Q9OWvt7Qc7ZFOlxR6w.Scdx0VvDB9VwIt.";

// One answer for both "unknown email" and "wrong password", so the response does not reveal which accounts exist
const INVALID_CREDENTIALS_STATUS = 401;
const INVALID_CREDENTIALS_MESSAGE = "Email or password is incorrect";

const Login = async (req, res) => {
  try {
    // Passwords were hashed after escape-html (see CreateUser), and emails are stored escaped,
    // so both are escaped the same way here to stay compatible with existing rows and hashes
    const email = escape(req.body.email);
    const password = escape(req.body.password);

    const sql = `SELECT name, email, password, role FROM "user" WHERE email = $1 LIMIT 1`;
    const data = await QueryDatabase(sql, [email]);
    const findAccount = data.rows[0];

    // Always run one bcrypt compare, against the dummy hash when the account does not exist
    const checkPassword = await compareHashPassword(password, findAccount ? findAccount.password : DUMMY_PASSWORD_HASH);
    if (!findAccount || checkPassword !== true) {
      res.status(INVALID_CREDENTIALS_STATUS);
      return {code: INVALID_CREDENTIALS_STATUS, message: INVALID_CREDENTIALS_MESSAGE};
    }

    const payload = {name: findAccount.name, email: findAccount.email, role: findAccount.role};
    return {
      access_token: GenerateAccessToken(payload),
      refresh_token: GenerateRefreshToken(payload),
    };
  } catch (error) {
    logger.error(error);
    console.error("Internal Server Error 🔥:: ", error);
    res.status(500);
    return {code: 500, message: "Internal Server Error"};
  }
};

const RefreshToken = async (req, res) => {
  try {
    const authHeaders = req.headers["authorization"];

    if (!authHeaders) {
      res.status(401);
      return {code: 401, message: "Can not find authorization header"};
    }

    const checkBearer = authHeaders.includes("Bearer");
    if (!checkBearer) {
      res.status(401);
      return {code: 401, message: "Do not have Bearer"};
    }

    const token = authHeaders.replace("Bearer ", "");
    if (!token) {
      res.status(401);
      return {code: 401, message: "Unauthorized"};
    }

    // Only a refresh token signed with the refresh secret is accepted; jwt.verify
    // throws on a bad signature, alg "none" or expiry and lands in the catch below
    const verifiedJWT = jwt.verify(token, process.env.REFRESH_TOKEN, {algorithms: ["HS256"]});
    const payload = {name: verifiedJWT.name, email: verifiedJWT.email, role: verifiedJWT.role};
    return {access_token: GenerateAccessToken(payload), refresh_token: GenerateRefreshToken(payload)};
  } catch (error) {
    logger.error(error);
    res.status(401);
    return {code: 401, message: "JWT expired"};
  }
};

module.exports = {
  Login,
  RefreshToken,
};
