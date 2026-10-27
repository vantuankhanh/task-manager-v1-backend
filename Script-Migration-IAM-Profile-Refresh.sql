-- Which IAM session last refreshed the email of a "user" row, and when (VTK IAM FR-ID-08: a person can change
-- their email at the IAM). A token of another session makes the backend ask the IAM again, at most once a
-- quarter of an hour. See docs/IAM-MIGRATION.md, "Changed email and deleted accounts".
-- Safe to run more than once. Nullable columns the running code never reads, so it runs before the new code
-- is deployed; a NULL means "ask the IAM at the next request".
--
-- Run it with: psql "<connection>" -v ON_ERROR_STOP=1 -f Script-Migration-IAM-Profile-Refresh.sql
-- To undo: ALTER TABLE public."user" DROP COLUMN IF EXISTS iam_profile_refreshed_at, DROP COLUMN IF EXISTS iam_session_id;

BEGIN;

ALTER TABLE public."user"
    ADD COLUMN IF NOT EXISTS iam_session_id character varying(64) DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS iam_profile_refreshed_at timestamp with time zone DEFAULT NULL;

COMMIT;
