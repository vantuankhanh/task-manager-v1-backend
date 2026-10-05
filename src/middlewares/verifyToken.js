const jwt = require("jsonwebtoken");

// Send exactly one 401 and stop; the caller returns right after and never calls next()
const replyUnauthorized = (res, message) => {
  res.status(401).send({code: 401, message});
};

//function check token is have or not
const VerifyToken = (req, res, next) => {
  const authHeaders = req.headers["authorization"];
  if (!authHeaders) {
    replyUnauthorized(res, "Unauthorized");
    return;
  }

  if (!authHeaders.startsWith("Bearer ")) {
    replyUnauthorized(res, "Do not have Bearer");
    return;
  }

  const token = authHeaders.slice("Bearer ".length).trim();
  if (!token) {
    replyUnauthorized(res, "Unauthorized");
    return;
  }

  let decoded;
  try {
    // Only an access token signed with the access secret is accepted; jwt.verify throws on a bad
    // signature (a refresh token included), alg "none", another algorithm or expiry
    decoded = jwt.verify(token, process.env.ACCESS_TOKEN, {algorithms: ["HS256"]});
  } catch (error) {
    replyUnauthorized(res, "JWT expired");
    return;
  }

  if (!decoded || typeof decoded !== "object" || !decoded.email) {
    replyUnauthorized(res, "Unauthorized");
    return;
  }

  // The signed-in user for the hooks and controllers that run next
  req.user = {name: decoded.name, email: decoded.email, role: decoded.role};
  next();
};

module.exports = VerifyToken;
// Cách dùng: Muốn verify token ở đâu thì bỏ VerifyToken vào phần route
