-- Links the local "user" table to VTK IAM accounts (AUTH_MODE=iam). See docs/IAM-MIGRATION.md.
-- Safe to run more than once. It changes no existing row and AUTH_MODE=legacy keeps working after it.
--
-- Before running it, check for emails that differ only by letter case. This query must return no row,
-- otherwise the second index below cannot be created and the whole script is rolled back:
--
--   SELECT LOWER(email) AS email, COUNT(*) AS total, array_agg(id) AS ids
--   FROM public."user" GROUP BY LOWER(email) HAVING COUNT(*) > 1;
--
-- Run it with: psql "<connection>" -v ON_ERROR_STOP=1 -f Script-Migration-IAM-Sub.sql

BEGIN;

-- 1. The "sub" of the IAM account the row belongs to. NULL until the user is linked
ALTER TABLE public."user" ADD COLUMN IF NOT EXISTS iam_sub character varying(64) DEFAULT NULL;

-- 2. One row per IAM account. NULL values do not collide, so rows that are not linked yet are fine
CREATE UNIQUE INDEX IF NOT EXISTS user_iam_sub_unique ON public."user" (iam_sub);

-- 3. One row per email, whatever the letter case (the IAM keeps emails in lower case).
--    The app links an IAM account to the row with the same email, so that row has to be the only one
CREATE UNIQUE INDEX IF NOT EXISTS user_email_lower_unique ON public."user" (LOWER(email));

COMMIT;
