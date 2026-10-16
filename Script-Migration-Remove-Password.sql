-- Removes the passwords of the sign-in this app did itself (milestone M9 of VTK IAM). See docs/IAM-MIGRATION.md.
-- VTK IAM is the only way in: the hashes have no reader left, and the IAM keeps its own copy of the imported
-- ones until they are used or expire (90 days, BRL-10). Dropped rather than kept, so no old hash stays behind
-- in the database or its backups. Safe to run more than once.
--
-- Run it after the code that no longer reads the column is deployed: the code before it still writes it.
-- Run it with: psql "<connection>" -v ON_ERROR_STOP=1 -f Script-Migration-Remove-Password.sql

BEGIN;

ALTER TABLE public."user" DROP COLUMN IF EXISTS password;

COMMIT;
