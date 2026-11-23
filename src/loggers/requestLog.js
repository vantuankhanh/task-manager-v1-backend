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

// The path as it is logged. When Fastify matched a route, the route pattern is written (for example
// /api/gettaskbyuser/:name) instead of the raw path, because the raw path of some routes holds an email address or a
// user name (D49 (c) of VTK IAM: personal data is removed from log lines). A request that matched no route (404) has
// no pattern, so it keeps the raw path with the query string rules of UrlForLog
const PathForLog = (req) => {
  const routePattern = req.routeOptions && req.routeOptions.url;
  return typeof routePattern === "string" && routePattern !== "" ? routePattern : UrlForLog(req.url);
};

// Serializers for the pino logger of Fastify. req has the same fields as the default of Fastify
// ("incoming request" and error log lines), only the url goes through PathForLog. The request object of Fastify 4
// already knows its route when the "incoming request" line is written
const RequestLogSerializers = {
  req: (req) => {
    return {
      method: req.method,
      url: PathForLog(req),
      version: req.headers && req.headers["accept-version"],
      hostname: req.hostname,
      remoteAddress: req.ip,
      remotePort: req.socket ? req.socket.remotePort : undefined,
    };
  },
};

module.exports = {UrlForLog, PathForLog, RequestLogSerializers};
