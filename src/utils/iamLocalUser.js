const escape = require("escape-html");
const logger = require("../loggers/loggers.config");
const QueryDatabase = require("./queryDatabase");

const USER_COLUMNS = `id, name, email, role, iam_sub, iam_session_id`;
// The shortest time between two userinfo calls for one row
const PROFILE_REFRESH_INTERVAL_SECONDS = 15 * 60;
const UNIQUE_VIOLATION = "23505";
// "user".email and "user".name are character varying(50)
const MAX_COLUMN_LENGTH = 50;

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

// Brings the email of a linked row up to date, once per IAM session, and returns the row as stored afterwards.
// A person can change their email on the account page of the IAM (FR-ID-08 of VTK IAM); the sub stays the same
// and only userinfo tells the new address. The product owner chose to read userinfo once per IAM session over an
// email in the access token (IAM TODO board 1.56, 2026-10-20). Here the email is also the key that ties tasks to
// their user (task.user_mail), so the row and its tasks change in one statement. The name is left alone.
// At most once a quarter of an hour per row, all the same: two devices bring two sessions that take turns, and a
// page sends its first requests together. The row is claimed first; one request wins, the others go on with the
// stored copy.
// Nothing here refuses the request. When the IAM cannot answer, the session is forgotten again and a request of it
// asks once the quarter of an hour has passed. An address the IAM has not verified, one too long for the column,
// or one another row holds in any letter case, is not taken; the next session tries again
const refreshEmailOnNewSession = async ({localUser, subject, sessionId, loadProfile}) => {
  if (!sessionId || sessionId === localUser.iam_session_id) {
    return localUser;
  }
  const claimed = await QueryDatabase(
    `UPDATE "user" SET iam_session_id = $2, iam_profile_refreshed_at = NOW()
     WHERE id = $1 AND (iam_profile_refreshed_at IS NULL OR iam_profile_refreshed_at < NOW() - make_interval(secs => $3))
     RETURNING id`,
    [localUser.id, sessionId, PROFILE_REFRESH_INTERVAL_SECONDS],
  );
  if (claimed.rows.length === 0) {
    return localUser;
  }

  let profile;
  try {
    profile = await loadProfile();
  } catch {
    // loadProfile logged why
    await QueryDatabase(`UPDATE "user" SET iam_session_id = $2 WHERE id = $1`, [localUser.id, localUser.iam_session_id]);
    return localUser;
  }
  if (!profile || !profile.email || profile.email_verified !== true) {
    return localUser;
  }
  let email;
  try {
    email = storedEmail(profile);
  } catch {
    return localUser;
  }
  if (email.toLowerCase() === localUser.email.toLowerCase()) {
    return localUser;
  }

  const emailHolder = await QueryDatabase(`SELECT id FROM "user" WHERE LOWER(email) = LOWER($1) AND id <> $2 LIMIT 1`, [
    email,
    localUser.id,
  ]);
  if (emailHolder.rows.length > 0) {
    logger.warn(`IAM account ${subject} has a new email that another user holds; the old copy stays`);
    return localUser;
  }
  try {
    await QueryDatabase(
      `WITH changed_user AS (UPDATE "user" SET email = $2 WHERE id = $1 AND email = $3 RETURNING id)
       UPDATE task SET user_mail = $2 WHERE user_mail = $3 AND EXISTS (SELECT 1 FROM changed_user)`,
      [localUser.id, email, localUser.email],
    );
  } catch (error) {
    // Another row took the address since the check above
    if (error.code !== UNIQUE_VIOLATION) {
      throw error;
    }
    logger.warn(`IAM account ${subject} has a new email that another user holds; the old copy stays`);
    return localUser;
  }
  return (await findBySubject(subject)) || localUser;
};

// The local "user" row of an IAM account, in this order:
//   1. the row already linked to the account (iam_sub), whose email is refreshed once per IAM session
//   2. the row with the same email, which is then linked (an imported user whose mapping was not loaded)
//   3. a new row, created on the spot (just-in-time) from the IAM profile
// subject: the "sub" of the access token. sessionId: its "sid". role: 0 or 1, from the roles of the access token.
// loadProfile: async () => ({email, email_verified, name}), called when step 1 finds nothing or the session is new.
// Steps 2 and 3 are single statements guarded by the unique indexes on iam_sub and LOWER(email), so two
// first requests at the same moment end with one row: the slower one finds the row of the faster one
const FindOrCreateLocalUser = async ({subject, sessionId, role, loadProfile}) => {
  let localUser = await findBySubject(subject);

  if (localUser) {
    localUser = await refreshEmailOnNewSession({localUser, subject, sessionId, loadProfile});
  } else {
    const profile = await loadProfile();
    if (!profile || !profile.email) {
      throw new IamLocalUserError(403, "The identity server gave no email for this account");
    }
    const email = storedEmail(profile);

    // The IAM keeps emails in lower case; rows written by this app may not be
    const linked = await QueryDatabase(
      `UPDATE "user" SET iam_sub = $1, iam_session_id = $3, iam_profile_refreshed_at = NOW()
       WHERE LOWER(email) = LOWER($2) AND iam_sub IS NULL RETURNING ${USER_COLUMNS}`,
      [subject, email, sessionId ?? null],
    );
    localUser = linked.rows[0];

    if (!localUser) {
      const created = await QueryDatabase(
        `INSERT INTO "user" (name, email, role, iam_sub, iam_session_id, iam_profile_refreshed_at)
         VALUES ($1, $2, $3, $4, $5, NOW()) ON CONFLICT DO NOTHING RETURNING ${USER_COLUMNS}`,
        [storedName(profile), email, role, subject, sessionId ?? null],
      );
      // Nothing inserted: another request created or linked the row first, or the email belongs to another account
      localUser = created.rows[0] || (await findBySubject(subject));
    }

    if (!localUser) {
      throw new IamLocalUserError(403, "This email is already linked to another account");
    }
  }

  // The role comes from the IAM. The local column is kept in step for the user list, which shows it
  if (Number(localUser.role) !== role) {
    await QueryDatabase(`UPDATE "user" SET role = $1 WHERE iam_sub = $2`, [role, subject]);
    localUser.role = role;
  }

  return localUser;
};

module.exports = {FindOrCreateLocalUser, IamLocalUserError};
