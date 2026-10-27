const QueryDatabase = require("./queryDatabase");

// Deleted IAM accounts (FR-ID-09 of VTK IAM, its docs/INTEGRATION.md section 8.4). Thirty days after a person asks
// the IAM to delete their account, the IAM deletes it and posts a signed notice to POST /api/iam/account-deleted.
// The product owner chose on 2026-10-27 to anonymize the user and keep the tasks: the admin keeps the history of
// the work of each project.
//
// One statement, so the row and its tasks change together: the name becomes "Deleted account", the email becomes
// <the id without dashes>@deleted.invalid (48 characters, unique because the id is, and on the reserved .invalid
// domain, which no IAM account can have, so the row is never linked again), and task.user_mail, which ties the
// tasks to the row by its email, follows. The role goes back to 0 and the link to the IAM is removed.
// Safe to run any number of times, and for an account that never used this application: the IAM sends every notice
// to every application that registered an address, and sends one again when it did not get a 2xx.
// Returns the id of the anonymized row, or null when no row had that account
const ForgetDeletedAccount = async (subject) => {
  const anonymized = await QueryDatabase(
    `WITH target AS (
       SELECT id, email, REPLACE(id::text, '-', '') || '@deleted.invalid' AS placeholder FROM "user" WHERE iam_sub = $1
     ), renamed_tasks AS (
       UPDATE task SET user_mail = target.placeholder FROM target WHERE task.user_mail = target.email
     )
     UPDATE "user" SET name = 'Deleted account', email = target.placeholder, role = 0, iam_sub = NULL,
       iam_session_id = NULL, iam_profile_refreshed_at = NULL
     FROM target WHERE "user".id = target.id
     RETURNING "user".id`,
    [subject],
  );
  // Short-lived rows, but they name the account
  await QueryDatabase(`DELETE FROM iam_ended_session WHERE iam_sub = $1`, [subject]);
  return anonymized.rows[0]?.id ?? null;
};

module.exports = {ForgetDeletedAccount};
