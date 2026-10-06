const escape = require("escape-html");
const QueryDatabase = require("./queryDatabase");

const USER_COLUMNS = `id, name, email, role, iam_sub`;
// "user".email and "user".name are character varying(50)
const MAX_COLUMN_LENGTH = 50;
// A user created from the IAM has no local password. This value is not a bcrypt hash, so the legacy
// login answers it with the generic 401 (bcrypt compare is false) after a rollback to AUTH_MODE=legacy
const UNUSABLE_PASSWORD = "!";

// A sign-in that is valid at the IAM but cannot be mapped to a local user
class IamLocalUserError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "IamLocalUserError";
    this.statusCode = statusCode;
  }
}

const findBySubject = async (subject) => {
  const data = await QueryDatabase(`SELECT ${USER_COLUMNS} FROM "user" WHERE iam_sub = $1 LIMIT 1`, [subject]);
  return data.rows[0];
};

// Name and email are stored escaped, like every row the app wrote itself. The name is cut to fit its column
const storedName = (profile) => {
  let name = String(profile.name || profile.email.split("@")[0]).trim();
  while (escape(name).length > MAX_COLUMN_LENGTH) {
    name = name.slice(0, -1);
  }
  return escape(name);
};

const storedEmail = (profile) => {
  const email = escape(String(profile.email).trim());
  if (email.length > MAX_COLUMN_LENGTH) {
    throw new IamLocalUserError(403, "The email of this account is too long for this application");
  }
  return email;
};

// The local "user" row of an IAM account, in this order:
//   1. the row already linked to the account (iam_sub)
//   2. the row with the same email, which is then linked (an imported user whose mapping was not loaded)
//   3. a new row, created on the spot (just-in-time) from the IAM profile
// subject: the "sub" of the access token. role: 0 or 1, from the roles of the access token.
// loadProfile: async () => ({email, name}), only called when step 1 finds nothing.
// Steps 2 and 3 are single statements guarded by the unique indexes on iam_sub and LOWER(email), so two
// first requests at the same moment end with one row: the slower one finds the row of the faster one
const FindOrCreateLocalUser = async ({subject, role, loadProfile}) => {
  let localUser = await findBySubject(subject);

  if (!localUser) {
    const profile = await loadProfile();
    if (!profile || !profile.email) {
      throw new IamLocalUserError(403, "The identity server gave no email for this account");
    }
    const email = storedEmail(profile);

    // The IAM keeps emails in lower case; rows written by this app may not be
    const linked = await QueryDatabase(
      `UPDATE "user" SET iam_sub = $1 WHERE LOWER(email) = LOWER($2) AND iam_sub IS NULL RETURNING ${USER_COLUMNS}`,
      [subject, email],
    );
    localUser = linked.rows[0];

    if (!localUser) {
      const created = await QueryDatabase(
        `INSERT INTO "user" (name, email, password, role, iam_sub) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING RETURNING ${USER_COLUMNS}`,
        [storedName(profile), email, UNUSABLE_PASSWORD, role, subject],
      );
      // Nothing inserted: another request created or linked the row first, or the email belongs to another account
      localUser = created.rows[0] || (await findBySubject(subject));
    }

    if (!localUser) {
      throw new IamLocalUserError(403, "This email is already linked to another account");
    }
  }

  // The role comes from the IAM. The local column is kept in step so a rollback to AUTH_MODE=legacy has sensible data
  if (Number(localUser.role) !== role) {
    await QueryDatabase(`UPDATE "user" SET role = $1 WHERE iam_sub = $2`, [role, subject]);
    localUser.role = role;
  }

  return localUser;
};

module.exports = {FindOrCreateLocalUser, IamLocalUserError, UNUSABLE_PASSWORD};
