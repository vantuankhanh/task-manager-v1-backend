// Every variable the sign-in through VTK IAM needs. Only the names are ever printed, never the values
const IAM_ENVIRONMENT_NAMES = [
  "IAM_ISSUER",
  "IAM_CLIENT_ID",
  "IAM_CLIENT_SECRET",
  "IAM_API_AUDIENCE",
  "APP_BASE_URL",
  "FRONTEND_BASE_URL",
  "COOKIE_SECRET",
];

// Read once at startup: users sign in at VTK IAM.
// Throws when a variable is missing, so the server does not start half configured
const GetAuthConfig = (env = process.env) => {
  const missingNames = IAM_ENVIRONMENT_NAMES.filter((name) => !env[name] || !env[name].trim());
  if (missingNames.length > 0) {
    throw new Error(`Sign-in needs these environment variables: ${missingNames.join(", ")}`);
  }
  if (env.COOKIE_SECRET.trim().length < 32) {
    throw new Error("COOKIE_SECRET must be at least 32 characters");
  }

  return {
    iam: {
      issuer: env.IAM_ISSUER.trim(),
      clientId: env.IAM_CLIENT_ID.trim(),
      clientSecret: env.IAM_CLIENT_SECRET.trim(),
      apiAudience: env.IAM_API_AUDIENCE.trim(),
      appBaseUrl: env.APP_BASE_URL.trim(),
      frontendBaseUrl: env.FRONTEND_BASE_URL.trim(),
      cookieSecret: env.COOKIE_SECRET.trim(),
    },
  };
};

module.exports = {IAM_ENVIRONMENT_NAMES, GetAuthConfig};
