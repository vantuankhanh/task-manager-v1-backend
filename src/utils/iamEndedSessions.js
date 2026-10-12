const QueryDatabase = require("./queryDatabase");

// The sign-in sessions VTK IAM reported as ended (back-channel logout), kept in the table
// iam_ended_session (Script-Migration-IAM-Ended-Session.sql). An access token is a JWT that verifies
// until it expires, so without this list a locked account keeps working for up to ten more minutes.
// The list is in the database and not in memory because the backend runs several PM2 processes: the
// call of the IAM reaches one of them, and every one of them has to refuse the token afterwards.
// Implements the EndedSessionStore of @vtk-iam/node

// Called by POST /api/auth/backchannel-logout of the SDK after it checked the logout token.
// endedSession: {sessionId, subject, endedAt, rememberUntil}. A second report of the same session only
// moves rememberUntil forward. Rows past their time are removed here, so the table stays a few rows long
const remember = async (endedSession) => {
  if (!endedSession.sessionId) {
    // VTK IAM always names the session; a report without one cannot be matched to a token of ours
    throw new Error("The logout token names no session");
  }
  try {
    await QueryDatabase(
      `INSERT INTO iam_ended_session (session_id, iam_sub, ended_at, remember_until) VALUES ($1, $2, $3, $4)
       ON CONFLICT (session_id) DO UPDATE SET remember_until = GREATEST(iam_ended_session.remember_until, EXCLUDED.remember_until)`,
      [endedSession.sessionId, endedSession.subject, endedSession.endedAt, endedSession.rememberUntil],
    );
  } catch {
    // QueryDatabase logged the cause. The route answers 500 with this message, and the IAM tries again;
    // the message of the database must not travel in that answer
    throw new Error("Cannot record the ended session");
  }
  // Cleaning up is not worth failing a report that was recorded
  await QueryDatabase(`DELETE FROM iam_ended_session WHERE remember_until < NOW()`).catch(() => undefined);
};

// Called for every verified access token: one lookup by primary key.
// accessToken: {sessionId, subject, issuedAt}. A token without a session cannot be in the list.
// When the lookup itself fails (the table is missing because the migration was not run, or the database
// does not answer) the token is treated as before back-channel logout existed: valid until it expires.
// Refusing it instead would sign every user out, and the frontend would loop between refresh and sign-in.
// QueryDatabase logs the failure
const isEnded = async (accessToken) => {
  if (!accessToken.sessionId) {
    return false;
  }
  try {
    const data = await QueryDatabase(`SELECT 1 FROM iam_ended_session WHERE session_id = $1 AND remember_until > NOW() LIMIT 1`, [
      accessToken.sessionId,
    ]);
    return data.rows.length > 0;
  } catch {
    return false;
  }
};

module.exports = {remember, isEnded};
