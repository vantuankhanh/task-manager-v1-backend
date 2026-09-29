const escape = require("escape-html");
const jwt = require("jsonwebtoken");
const {GenerateAccessToken, GenerateRefreshToken} = require("../../utils/generateJWT");
const QueryDatabase = require("../../utils/queryDatabase");
const {compareHashPassword} = require("../../utils/hashBcrypt");
const logger = require("../../loggers/loggers.config");

const Login = async (req, res) => {
  try {
    const sql = `
      SELECT * FROM "user";
    `;
    const data = await QueryDatabase(sql);

    const email = escape(req.body.email);
    const password = escape(req.body.password);

    const findAccount = data.rows.find((item) => item.email === email);

    // Check email
    if (!findAccount) {
      res.status(401);
      return {code: 401, message: "Email not found"};
    }

    // Compare Password with database
    const checkPassword = await compareHashPassword(password, findAccount.password);
    if (checkPassword === false) {
      res.status(401);
      return {code: 401, message: "Password is wrong"};
    }

    if (checkPassword === true) {
      const sql_search_role = `SELECT role FROM "user" WHERE email = '${email}'`;
      const role = await QueryDatabase(sql_search_role);

      const accessToken = GenerateAccessToken({name: findAccount?.name, email: email, role: role.rows[0].role});
      const refreshToken = GenerateRefreshToken({name: findAccount?.name, email: email, role: role.rows[0].role});
      return {
        access_token: accessToken,
        refresh_token: refreshToken,
      };
    }
  } catch (error) {
    logger.error(error);
    console.error("Internal Server Error 🔥:: ", err);
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
