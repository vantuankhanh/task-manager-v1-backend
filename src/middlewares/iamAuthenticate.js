const logger = require("../loggers/loggers.config");
const {ROLE_ADMIN} = require("./authorize");
const {FindOrCreateLocalUser, IamLocalUserError} = require("../utils/iamLocalUser");
const iamEndedSessions = require("../utils/iamEndedSessions");

// Role key of the IAM application "taskmanager-v1" that means admin; any other role is a normal user
const IAM_ADMIN_ROLE = "admin";
const ACCESS_TOKEN_COOKIE = "access_token";
const USERINFO_TIMEOUT_MILLISECONDS = 5000;

const AUTH_PREFIX = "/api/auth";
// Frontend pages (both public): where a signed-out browser lands, and where a failed sign-in lands
const FRONTEND_SIGN_IN_PATH = "/auth/login";
const FRONTEND_SIGN_IN_FAILED_PATH = "/auth/access";
// The only values the reason parameter of the failed sign-in page ever takes
const REASON_ACCESS_DENIED = "access_denied";
const REASON_SIGN_IN_FAILED = "sign_in_failed";
// The only prompt GET /api/auth/login passes on to the IAM (OpenID Connect prompt=login)
const PROMPT_LOGIN = "login";

// onSend hook for the sign-in routes. GET /login?prompt=login is "sign in with another account": the SDK
// builds the authorization request without a prompt, so the IAM would sign the browser in again as the
// account it still knows. With prompt=login added to that request the IAM shows its sign-in form instead,
// and the account that signs in there replaces the session of the previous one.
// The value is fixed: any other prompt, a repeated one or none leaves the redirect of the SDK as it is,
// and nothing else of the query string reaches the IAM
const CreateSignInWithAnotherAccountPrompt = () => {
  return async (req, res, payload) => {
    const isLogin = req.method === "GET" && req.routeOptions.url === `${AUTH_PREFIX}/login`;
    if (!isLogin || res.statusCode !== 303 || req.query.prompt !== PROMPT_LOGIN) {
      return payload;
    }
    const authorizationUrl = new URL(res.getHeader("location"));
    authorizationUrl.searchParams.set("prompt", PROMPT_LOGIN);
    res.header("location", authorizationUrl.href);
    return payload;
  };
};

// onSend hook for the sign-in routes. A browser is on GET /callback, so a failed sign-in must not end on
// bare JSON on the API host: the answer of the SDK (403 when the IAM refused the user, as for a person
// without a role in this invite-only application; 400 for anything else, as a missing or expired sign-in
// cookie, a state mismatch or a failed token exchange) becomes a 303 to the frontend.
// The reason is one of two fixed codes picked from the status: nothing of the query string is copied over.
// Every other route and every other answer is left as it is
const CreateFailedCallbackRedirect = (frontendBaseUrl) => {
  const failedPageUrl = `${frontendBaseUrl.replace(/\/+$/, "")}${FRONTEND_SIGN_IN_FAILED_PATH}`;

  return async (req, res, payload) => {
    const isCallback = req.method === "GET" && req.routeOptions.url === `${AUTH_PREFIX}/callback`;
    if (!isCallback || (res.statusCode !== 400 && res.statusCode !== 403)) {
      return payload;
    }
    const reason = res.statusCode === 403 ? REASON_ACCESS_DENIED : REASON_SIGN_IN_FAILED;
    res.code(303).header("location", `${failedPageUrl}?reason=${reason}`).removeHeader("content-type");
    return null;
  };
};

// Name and email of the signed-in account, from the IAM userinfo endpoint (scopes profile and email).
// Only needed the first time an account is seen; afterwards the local row answers
const fetchUserinfoFromIam = async (issuer, accessToken) => {
  const response = await fetch(`${issuer.replace(/\/+$/, "")}/oauth2/userinfo`, {
    headers: {Authorization: `Bearer ${accessToken}`},
    signal: AbortSignal.timeout(USERINFO_TIMEOUT_MILLISECONDS),
  });
  if (!response.ok) {
    throw new Error(`userinfo answered ${response.status}`);
  }
  return response.json();
};

// AUTH_MODE=iam counterpart of VerifyToken: checks the access token of VTK IAM (httpOnly cookie or
// Authorization: Bearer) and sets req.user = {id, name, email, role} from the local "user" row, so the
// hooks and controllers that run next do not care which mode signed the user in.
// The role is the one in the token (the IAM reads roles at every token issue), not the local column
const CreateIamAuthenticate = ({verifier, issuer, fetchUserinfo = fetchUserinfoFromIam}) => {
  const {extractAccessToken} = require("@vtk-iam/node");
  const {accessTokenHook} = require("@vtk-iam/node/fastify");
  const verifyAccessToken = accessTokenHook(verifier, {cookieName: ACCESS_TOKEN_COOKIE});

  return async (req, res) => {
    // Answers 401 itself for a missing or invalid token
    const unauthorizedReply = await verifyAccessToken(req, res);
    if (unauthorizedReply) {
      return unauthorizedReply;
    }

    const subject = req.iamAuth.subject;
    const role = req.iamAuth.roles.includes(IAM_ADMIN_ROLE) ? ROLE_ADMIN : 0;

    try {
      const localUser = await FindOrCreateLocalUser({
        subject,
        role,
        loadProfile: async () => {
          const accessToken = extractAccessToken(req.headers.authorization, req.headers.cookie, ACCESS_TOKEN_COOKIE);
          let profile;
          try {
            profile = await fetchUserinfo(issuer, accessToken);
          } catch (error) {
            logger.error(error);
            throw new IamLocalUserError(503, "Cannot reach the identity server");
          }
          if (!profile || profile.sub !== subject) {
            throw new IamLocalUserError(401, "Unauthorized");
          }
          return profile;
        },
      });

      // isAdmin is set here from the token, so IsAdmin (authorize.js) does not read the role from the database
      req.user = {id: localUser.id, name: localUser.name, email: localUser.email, role, isAdmin: role === ROLE_ADMIN};
    } catch (error) {
      if (error instanceof IamLocalUserError) {
        return res.status(error.statusCode).send({code: error.statusCode, message: error.message});
      }
      logger.error(error);
      return res.status(500).send({code: 500, message: "Internal Server Error"});
    }
  };
};

// Wires AUTH_MODE=iam into the app: CORS for the frontend host in front of everything, the sign-in routes
// of the SDK at /api/auth, and the hook the API routes use to authenticate. Returns that hook.
// overrides is for tests only: keySet (a local key set instead of the JWKS of the IAM) and fetchUserinfo
const RegisterIam = (app, iamConfig, overrides = {}) => {
  // Loaded here and not at the top: the SDK ships ES modules, which require() loads on Node.js 22.12 or later.
  // AUTH_MODE=legacy never gets here
  const {createAccessTokenVerifier} = require("@vtk-iam/node");
  const {authRoutesPlugin, corsHook} = require("@vtk-iam/node/fastify");

  // The same options for both, so CORS and the sign-in routes allow the same origins
  const iamOptions = {
    issuer: iamConfig.issuer,
    clientId: iamConfig.clientId,
    clientSecret: iamConfig.clientSecret,
    appBaseUrl: iamConfig.appBaseUrl,
    frontendBaseUrl: iamConfig.frontendBaseUrl,
    cookieSecret: iamConfig.cookieSecret,
    // After sign-out the browser lands on the public sign-in page of the frontend, not on a private route.
    // This exact URL has to be registered at the IAM as a post-logout redirect URI of the application
    postLogoutRedirectUri: `${iamConfig.frontendBaseUrl.replace(/\/+$/, "")}${FRONTEND_SIGN_IN_PATH}`,
    // Back-channel logout: the IAM posts to /api/auth/backchannel-logout when a sign-in session ends
    // early (sign-out elsewhere, a locked account, a changed password), and the session is written to
    // the table iam_ended_session. The verifier below reads the same table
    endedSessions: iamEndedSessions,
  };

  // Answers the frontend origin only (with credentials) and refuses writes from any other origin
  app.addHook("onRequest", corsHook(iamOptions));

  // GET /api/auth/login, GET /api/auth/callback, POST /api/auth/refresh, POST /api/auth/logout and,
  // called by the IAM and not by a browser, POST /api/auth/backchannel-logout.
  // The SDK routes sit in a scope of their own, so the hooks around the login and the callback touch nothing else
  app.register(
    async (authScope) => {
      authScope.addHook("onSend", CreateSignInWithAnotherAccountPrompt());
      authScope.addHook("onSend", CreateFailedCallbackRedirect(iamConfig.frontendBaseUrl));
      authScope.register(authRoutesPlugin, iamOptions);
    },
    {prefix: AUTH_PREFIX},
  );

  const verifier = createAccessTokenVerifier({
    issuer: iamConfig.issuer,
    audience: iamConfig.apiAudience,
    keySet: overrides.keySet,
    // Refuses the access tokens of a session the IAM reported as ended, at once instead of at their expiry
    endedSessions: iamEndedSessions,
  });
  return CreateIamAuthenticate({verifier, issuer: iamConfig.issuer, fetchUserinfo: overrides.fetchUserinfo});
};

module.exports = {
  IAM_ADMIN_ROLE,
  CreateIamAuthenticate,
  CreateFailedCallbackRedirect,
  CreateSignInWithAnotherAccountPrompt,
  RegisterIam,
};
