-- The sign-in sessions VTK IAM reported as ended (back-channel logout, AUTH_MODE=iam).
-- See docs/IAM-MIGRATION.md, "Back-channel logout".
-- Safe to run more than once. It changes no existing table and AUTH_MODE=legacy keeps working after it.
--
-- Run it with: psql "<connection>" -v ON_ERROR_STOP=1 -f Script-Migration-IAM-Ended-Session.sql

BEGIN;

-- One row per ended session, kept for an hour: after that every access token of the session has
-- expired by itself. The backend deletes old rows when it writes a new one
CREATE TABLE IF NOT EXISTS public.iam_ended_session (
    -- The "sid" claim of the access tokens of the session
    session_id character varying(64) NOT NULL,
    -- The "sub" of the account, for reading the table by hand
    iam_sub character varying(64) NOT NULL,
    -- When the IAM issued the logout token
    ended_at timestamp with time zone NOT NULL,
    remember_until timestamp with time zone NOT NULL,
    CONSTRAINT iam_ended_session_pkey PRIMARY KEY (session_id)
);

COMMIT;
