// Paths whose query string must never reach the log: the sign-in callback of VTK IAM carries the one-time
// authorization code and the state (GET /api/auth/callback?code=...&state=...)
const QUERY_HIDDEN_PREFIX = "/api/auth/";

// The request URL as it is logged: without its query string under /api/auth/, unchanged everywhere else
const UrlForLog = (url) => {
  if (typeof url !== "string" || !url.startsWith(QUERY_HIDDEN_PREFIX)) {
    return url;
  }
  const queryStart = url.indexOf("?");
  return queryStart === -1 ? url : url.slice(0, queryStart);
};

// Serializers for the pino logger of Fastify. req has the same fields as the default of Fastify
// ("incoming request" and error log lines), only the url goes through UrlForLog
const RequestLogSerializers = {
  req: (req) => {
    return {
      method: req.method,
      url: UrlForLog(req.url),
      version: req.headers && req.headers["accept-version"],
      hostname: req.hostname,
      remoteAddress: req.ip,
      remotePort: req.socket ? req.socket.remotePort : undefined,
    };
  },
};

module.exports = {UrlForLog, RequestLogSerializers};
