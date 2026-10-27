# Moving sign-in to VTK IAM

This guide is for the owner of task-manager v1. It moved sign-in from the app's own email and password to VTK IAM (`https://auth.vantuankhanh.com`) on 2026-10-08. The old sign-in was removed on 2026-10-16 (milestone M9 of VTK IAM, see "Removing the old sign-in" at the end); the sections before that are kept as the record of the move.

Until M9 the switch was one variable, `AUTH_MODE`, read when the server starts:

| `AUTH_MODE` | Sign-in | Tokens |
| --- | --- | --- |
| `legacy` (default) | `POST /api/login` with email and password | JWTs signed by this app, kept by the frontend |
| `iam` | `GET /api/auth/login` sends the browser to VTK IAM | httpOnly cookies set by this API; the frontend holds no token |

The frontend asks `GET /api/auth/config` on load and shows the matching sign-in, so switching mode needs no frontend rebuild.

Hosts used below:

| | URL |
| --- | --- |
| API (this app) | `https://api-taskmanager-v1.vantuankhanh.com` |
| Frontend | `https://taskmanagerv1.vantuankhanh.com` |
| VTK IAM | `https://auth.vantuankhanh.com` |

## What changes in `iam` mode

| Route | In `iam` mode |
| --- | --- |
| `GET /api/auth/config` | `{"mode": "iam"}` (public, both modes) |
| `GET /api/auth/login?returnTo=/path` | New. Redirects to the IAM sign-in. With `&prompt=login` ("sign in with another account") the IAM shows its sign-in form even when it still knows an account in that browser; no other prompt and no other parameter is passed on |
| `GET /api/auth/callback` | New. Sets the cookies, sends the browser back to the frontend. A sign-in that fails sends it to the frontend too: `/auth/access?reason=access_denied` or `/auth/access?reason=sign_in_failed` |
| `POST /api/auth/refresh` | New. 204 with fresh cookies, 401 `session_ended` when the session is over |
| `POST /api/auth/logout` | New. Clears the cookies, answers `{"redirectUrl": ...}` to the IAM sign-out, which ends on the frontend page `/auth/login` |
| `GET /api/me` | New. `{"id", "name", "email", "role"}` of the signed-in user, 401 when not signed in |
| `POST /api/login`, `GET /api/refresh-token` | 410: sign-in and refresh go through the IAM |
| `POST /api/user` | 410: accounts are created at the IAM |
| `PUT /api/user/changerole` | 410: roles are managed in the IAM console |
| Every other route | Same URL, method, request and response. Same rules for admins and normal users |

Roles come from the access token: the role `admin` of the IAM application `taskmanager-v1` is an admin, any other role is a normal user. The local `role` column is updated to match on each request of the user, so it is still right after a rollback.

Each IAM account is tied to one row of the local `"user"` table through the new `iam_sub` column. On a request the app looks for the row by `iam_sub`. If there is none it takes the row with the same email and links it. If there is none either, it creates the row (name and email from the IAM, role from the token, no usable local password).

`DELETE /api/user` is one of the unchanged routes: an admin can still call it (anyone else gets 403), and it removes the local row only. It does not take away the person's access: the IAM account and its role stay, so the row comes back, with a new `id`, at that person's next request, and their tasks (kept by email) are theirs again. To remove a person, take their role away or lock them in the IAM console. This is why the frontend hides the delete button in `iam` mode.

CORS in `iam` mode answers only the frontend origin, with credentials, and refuses writes (`POST`, `PUT`, `DELETE`) from any other website. Requests without an `Origin` header (curl, another backend) still pass.

A sign-in can fail on the callback, where the browser is on the API host. The app never leaves it there on JSON: it answers a 303 to a public page of the frontend, with one of two fixed reasons and nothing copied from the request.

| Redirect | When |
| --- | --- |
| `{FRONTEND_BASE_URL}/auth/access?reason=access_denied` | The IAM refused the person: no role in this invite-only application |
| `{FRONTEND_BASE_URL}/auth/access?reason=sign_in_failed` | Anything else: the sign-in cookie is missing or older than 10 minutes, the state does not match, the code exchange failed |

The request log (the PM2 output) records requests under `/api/auth/` without their query string, so the one-time code and the state of the callback are never written to it. Every other request is logged as before.

## Before you start

- Node.js 22.12 or later on the server (the SDK `@vtk-iam/node` is loaded with `require()`; the server runs 24.14.0).
- The SDK is installed from `vendor/vtk-iam-node-0.6.0.tgz` in this repository, so `pnpm install` needs no access to the IAM repository.
- A backup of the app database.
- VTK IAM is running and you can sign in to its console as a super admin.
- A VTK IAM build that contains the commit `fix(hostedui): allow a separate frontend origin in form-action` (main at or after that commit). The sign-in page of the IAM carries a `Content-Security-Policy` with `form-action`, and Chrome and Edge apply it to every redirect that follows the password form: IAM, then the API host (`/api/auth/callback`), then the frontend host. From that commit on the IAM lists the origin of the redirect URI and the origins of the post-logout redirect URIs, so registering the post-logout redirect URI of step 1 is what lets the sign-in reach the frontend. On an older build the browser stays on the IAM sign-in page after a correct password (a browser already signed in at the IAM is not affected, which hides it). The first browser test of step 9, in a private window, shows which build is running.

## Trying it on one machine first

The whole move can be rehearsed locally: VTK IAM on `http://localhost:8007`, this API on `http://localhost:8000`, the frontend dev server on `http://localhost:5174`. Different ports of `localhost` are the same site, like the two production hosts.

| Where | Value |
| --- | --- |
| IAM application | `iamctl client create --client-id taskmanager-v1 --name "Task Manager v1" --type confidential --access-policy invite_only --audience http://localhost:8000/api --redirect-uri http://localhost:8000/api/auth/callback --post-logout-redirect-uri http://localhost:5174/auth/login` (the IAM allows `http://localhost` when `IAM_ENVIRONMENT=development`) |
| Backend | `AUTH_MODE=iam`, `IAM_ISSUER=http://localhost:8007`, `IAM_CLIENT_ID=taskmanager-v1`, `IAM_CLIENT_SECRET`, `IAM_API_AUDIENCE=http://localhost:8000/api`, `APP_BASE_URL=http://localhost:8000`, `FRONTEND_BASE_URL=http://localhost:5174`, `COOKIE_SECRET`, `PORT=8000`, and `DB_*` of a scratch database |
| Frontend | `VITE_BASE_URL=http://localhost:8000/api` in the environment of `vite --port 5174 --strictPort` (a variable of the environment wins over `.env`) |

`require("dotenv").config()` reads `.env` from the directory the server is started in and never replaces a variable that is already set. To be sure a rehearsal cannot reach the database of `.env`, start the server from another directory (`node /path/to/src/server.js`) with every `DB_*` variable set in the environment.

## Cut-over

### 1. Register the application in the IAM console

Applications, "Tạo ứng dụng" (or `iamctl client create` with the same values):

| Field | Value |
| --- | --- |
| `client_id` | `taskmanager-v1` |
| Client type | `confidential` |
| Redirect URI | `https://api-taskmanager-v1.vantuankhanh.com/api/auth/callback` |
| Post-logout redirect URI | `https://taskmanagerv1.vantuankhanh.com/auth/login` (the public sign-in page of the frontend; the app sends exactly `{FRONTEND_BASE_URL}/auth/login`) |
| Audience | `https://api-taskmanager-v1.vantuankhanh.com/api` |
| Access policy | `invite_only` |
| Permissions in token | off (the app checks roles only) |

Both URIs are matched character for character. Copy the client secret when it is shown: it is shown once.

With `iamctl` the same values are `--type confidential --access-policy invite_only --audience ... --redirect-uri ... --post-logout-redirect-uri ...`; "Permissions in token" is off unless it is turned on in the console. The IAM refuses an audience that another application already uses.

Then create two roles for the application: `admin` and `member`. `iamctl` has no command for roles: create them in the console (application, tab "Vai trò và quyền") or with the Admin API (`POST /admin/api/v1/applications/{id}/roles`). The same goes for giving a role to a person outside the import of step 5 (user page, tab "Ứng dụng và vai trò").

The post-logout redirect URI does one more thing: its origin is the only place where the IAM learns the frontend host, which its sign-in page needs to let the browser continue there (see "Before you start"). Register it even if nobody is expected to sign out.

### 2. Check for duplicate emails

The migration makes emails unique without regard to letter case, because the app links an IAM account to the local row with the same email. Run this against the app database. It must return no row:

```sql
SELECT LOWER(email) AS email, COUNT(*) AS total, array_agg(id) AS ids
FROM public."user"
GROUP BY LOWER(email)
HAVING COUNT(*) > 1;
```

If it returns rows, the migration stops at the email index and changes nothing (it runs in one transaction). For each email listed, decide which row is the real account, move the tasks of the others to it if needed (`task.user_mail` holds the email, so rows with the same email already share their tasks), delete or rename the others, then run the check again.

### 3. Run the migration

```bash
psql "<connection to the app database>" -v ON_ERROR_STOP=1 -f Script-Migration-IAM-Sub.sql
```

It adds, and is safe to run again:

| Object | Purpose |
| --- | --- |
| Column `"user".iam_sub character varying(64)`, nullable | The `sub` of the IAM account of the row |
| Unique index `user_iam_sub_unique` on `(iam_sub)` | One row per IAM account; rows without `iam_sub` are not affected |
| Unique index `user_email_lower_unique` on `(LOWER(email))` | One row per email, so linking by email is never ambiguous |

It adds no primary key and changes no existing row. `AUTH_MODE=legacy` keeps working after it. One difference in legacy mode: signing up with an email that differs from an existing one only by letter case now fails instead of creating a second row.

### 4. Export the users

Emails and names are stored HTML-escaped (the app ran `escape-html` on every field), so the export turns them back. Passwords were escaped before hashing, which is what `bcrypt_html_escaped` tells the IAM.

```bash
psql "<connection to the app database>" -At -o export.json <<'SQL'
SELECT json_build_object(
  'source_application', 'taskmanager-v1',
  'hash_algorithm', 'bcrypt_html_escaped',
  'users', COALESCE(json_agg(json_build_object(
    'source_user_id', id::text,
    'email', replace(replace(replace(replace(replace(email, '&quot;', '"'), '&#39;', ''''), '&lt;', '<'), '&gt;', '>'), '&amp;', '&'),
    'full_name', replace(replace(replace(replace(replace(name, '&quot;', '"'), '&#39;', ''''), '&lt;', '<'), '&gt;', '>'), '&amp;', '&'),
    'password_hash', password,
    'roles', CASE WHEN role = 1 THEN json_build_array('admin') ELSE json_build_array('member') END
  ) ORDER BY email), '[]'::json)
)
FROM public."user"
WHERE password LIKE '$2%';
SQL
```

`source_user_id` is the local `id`: the mapping in step 6 relies on it. `export.json` holds password hashes; keep it off shared disks and delete it after the import.

### 5. Import into the IAM

In the IAM repository, against the IAM database:

```bash
go run ./cmd/iamctl import users --file export.json --dry-run
go run ./cmd/iamctl import users --file export.json --mapping-out mapping.csv
```

Read the dry-run report first: the real run refuses a file with rejected rows. People who already have an IAM account with the same email keep it and gain the role. `mapping.csv` has the columns `source_user_id,iam_sub,email,outcome`.

### 6. Load the mapping into `iam_sub`

```bash
psql "<connection to the app database>" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
CREATE TEMP TABLE iam_mapping (source_user_id text, iam_sub text, email text, outcome text);
\copy iam_mapping FROM 'mapping.csv' WITH (FORMAT csv, HEADER true)

UPDATE public."user" AS local_user
SET iam_sub = iam_mapping.iam_sub
FROM iam_mapping
WHERE local_user.id::text = iam_mapping.source_user_id
  AND iam_mapping.iam_sub <> ''
  AND local_user.iam_sub IS NULL;

SELECT COUNT(*) FILTER (WHERE iam_sub IS NOT NULL) AS linked,
       COUNT(*) FILTER (WHERE iam_sub IS NULL) AS not_linked
FROM public."user";
COMMIT;
SQL
```

Rows left without `iam_sub` are not lost: the app links them by email the first time the person signs in. Loading the mapping only makes that explicit and independent of the email.

### 7. Set the environment

Add to the server's `.env` (names only here; `.env.example` lists them too):

| Variable | Value |
| --- | --- |
| `IAM_ISSUER` | `https://auth.vantuankhanh.com` |
| `IAM_CLIENT_ID` | `taskmanager-v1` |
| `IAM_CLIENT_SECRET` | The secret from step 1 |
| `IAM_API_AUDIENCE` | `https://api-taskmanager-v1.vantuankhanh.com/api` |
| `APP_BASE_URL` | `https://api-taskmanager-v1.vantuankhanh.com` |
| `FRONTEND_BASE_URL` | `https://taskmanagerv1.vantuankhanh.com` |
| `COOKIE_SECRET` | At least 32 random characters: `openssl rand -base64 48` |

Leave `AUTH_MODE` out for now. If nginx in front of the API adds `Access-Control-*` headers, remove them: in `iam` mode the app answers CORS itself, and two sets of headers break the browser's check.

### 8. Deploy, then switch

1. Deploy this version with `AUTH_MODE` unset (`pnpm install --frozen-lockfile`, restart PM2). The app behaves as before. `curl https://api-taskmanager-v1.vantuankhanh.com/api/auth/config` answers `{"mode":"legacy"}`.
2. Deploy the frontend version that reads `/api/auth/config`.
3. Tell the users: they sign in once more, with the same email and password, on the IAM page.
4. Set `AUTH_MODE=iam` in `.env` and restart PM2. If a variable is missing the server stops at once and names it in the PM2 error log.

### 9. Verify

- `curl https://api-taskmanager-v1.vantuankhanh.com/api/auth/config` answers `{"mode":"iam"}`.
- `curl -i https://api-taskmanager-v1.vantuankhanh.com/api/me` answers 401.
- `curl -i -X POST https://api-taskmanager-v1.vantuankhanh.com/api/login` answers 410.
- In Chrome or Edge, in a private window (so that no sign-in at the IAM is reused): open the frontend, sign in with an old account and its old password, land back on the frontend at the page that was asked for. The users page shows for an admin and not for a member. A member sees only their own tasks. If the browser stays on the IAM sign-in page after a correct password, see "Before you start".
- Sign out. The browser goes to the IAM sign-out, then to `https://taskmanagerv1.vantuankhanh.com/auth/login`, the public page with the sign-in button. It stays there: nothing sends it on to the IAM until the button is pressed. The back button loads the frontend again and ends on that same page, without the name or the data of the person who signed out; opening a private page directly goes to the IAM sign-in. If the browser stops on the IAM host with `{"error":"invalid_request","error_description":"post_logout_redirect_uri invalid"}`, the post-logout redirect URI is not registered: compare it with step 1 character for character.
- Give a new person the role `member` in the IAM console, let them sign in, and check a row for them appears in `"user"` with `iam_sub` set.
- Change a role in the IAM console while that person is signed in. The API follows at their next token, at most one access token lifetime later (10 minutes unless the application's Token tab says otherwise), and the frontend reads the role again at that moment, so the menu changes without a reload.
- Sign in as a person without any role in `taskmanager-v1`. The IAM shows its own "Access denied" page ("Your account does not have access to ... yet") with two buttons. "Sign in with another account" signs out of the IAM and shows the sign-in form again. "Return to ..." passes through the API host and ends on the frontend at `/auth/access?reason=access_denied`, never on JSON. That page has two buttons too. "Try again" goes back to the IAM, which shows "Access denied" again until the person has a role (no loop: each step needs a click). "Sign in with another account" goes straight to the IAM sign-in form (`prompt=login`), without the IAM page "Sign out" in between; the account that signs in there replaces the refused one at the IAM. Nothing is written to `"user"` for that person. Give them a role and let them sign in again.
- Open `https://api-taskmanager-v1.vantuankhanh.com/api/auth/callback?code=x&state=y` in the browser (a callback nobody started). It ends on the frontend at `/auth/access?reason=sign_in_failed`.
- In `pm2 logs`, the lines of the sign-in show `/api/auth/callback` without `code=` or `state=`.
- Lock a signed-in person in the IAM console (or "sign out everywhere"). Without back-channel logout (next section) their open tab keeps working until the access token expires; with it, the next click already ends on the IAM sign-in page. Either way that happens once, without a loop; a locked account is told "This account is disabled" there.
- Watch `pm2 logs` and the IAM audit log for failed sign-ins during the first days.

## Back-channel logout

An access token is a JWT: it verifies until it expires, up to ten minutes after the account was locked or signed out at the IAM. With back-channel logout the IAM tells this backend the moment a sign-in session ends early, and the backend refuses the access tokens of that session at once. It needs `@vtk-iam/node` 0.2.0 or later (in `vendor/`), VTK IAM with migration `00011`, and three steps, in this order:

1. Create the table. The script is additive, safe to run twice, and the version running now does not look at the table:

   ```bash
   psql "<connection>" -v ON_ERROR_STOP=1 -f Script-Migration-IAM-Ended-Session.sql
   ```

2. Deploy this version (`pnpm install --frozen-lockfile`, restart PM2). The route `POST /api/auth/backchannel-logout` exists from now on; nothing calls it yet.
3. In the IAM console, application `taskmanager-v1`, tab URI, set "Back-channel logout URI" to `https://api-taskmanager-v1.vantuankhanh.com/api/auth/backchannel-logout` and save.

How it works: the route checks the logout token of the IAM (signature against the IAM's published keys, the `logout+jwt` type, this application as audience, the logout event, no nonce) and writes the session id to `iam_ended_session`, for an hour. Every request with an access token looks its session up there by primary key. The table is in the database because PM2 runs several processes: the IAM's call reaches one of them and all of them have to refuse the token. Old rows are deleted when a new one is written, so the table stays a few rows long.

Verify:

- Sign in as a test person, then lock that account in the IAM console. The very next click in the open tab ends on the IAM sign-in page, which says "This account is disabled". Before this version the tab kept working for up to ten minutes.
- In the IAM console, Audit log: an event "Báo đăng xuất cho ứng dụng" (`oidc.backchannel_logout.sent`) for `taskmanager-v1`. "thất bại" (`.failed`) instead means the IAM could not reach the URI or got an answer other than 2xx; its metadata holds the reason.
- `SELECT session_id, iam_sub, ended_at FROM iam_ended_session;` shows the session.
- `curl -i -X POST https://api-taskmanager-v1.vantuankhanh.com/api/auth/backchannel-logout` answers 400 `invalid_request`: the route is there and refuses a call without a token.

What to know:

- If step 1 was skipped, the lookup fails on every request. The backend then treats tokens as before (valid until they expire) and logs the error; the route answers 500 to the IAM, which records "failed". Nothing else breaks.
- The IAM tries three times within about 15 seconds. If the backend is down for longer, that logout is not delivered, and the old behaviour applies: the token lives until it expires and the next refresh answers 401.
- A session that simply expires at the IAM is not reported.
- To turn it off: clear the URI in the IAM console. The table can stay.

## Rollback (until 2026-10-16)

No longer possible since M9: the old sign-in is gone from the code and the passwords from the database. What it was:

1. Set `AUTH_MODE=legacy` in `.env` (or remove the line) and restart PM2.
2. Check `GET /api/auth/config` answers `{"mode":"legacy"}`. The frontend shows the old sign-in on its next load.

Nothing in the database has to be undone: the migration only added a column and two indexes, and the legacy mode ignores them. After a rollback:

- Users sign in with their old email and password, also those who still had a legacy session before the switch: the frontend removes the legacy tokens from the browser the first time it loads in `iam` mode. The IAM cookies left in browsers are ignored.
- A password changed at the IAM during the `iam` period is not known to this app: the old password still applies here.
- People created during the `iam` period have a row but no local password (the column holds `!`, which no password matches), so they cannot sign in in legacy mode. The legacy login answers them like any wrong password, and signing up again is refused because the email exists. To let one of them in, delete their row and let them sign up.
- The `role` column holds the last role each person had at the IAM.

To remove the link completely (only if the move is abandoned):

```sql
DROP INDEX IF EXISTS public.user_iam_sub_unique;
DROP INDEX IF EXISTS public.user_email_lower_unique;
ALTER TABLE public."user" DROP COLUMN IF EXISTS iam_sub;
```

## Removing the old sign-in (M9, 2026-10-16)

The owner ended the two weeks of observation early on 2026-10-16. This version:

- has no `AUTH_MODE`: the `IAM_*`, `APP_BASE_URL`, `FRONTEND_BASE_URL` and `COOKIE_SECRET` variables are always required, and `ACCESS_TOKEN`, `REFRESH_TOKEN`, `EXPIRES_ACCESS_TOKEN` and `EXPIRES_REFRESH_TOKEN` are no longer read;
- no longer serves `POST /api/login`, `GET /api/refresh-token`, `POST /api/user`, `PUT /api/user/changerole` and `GET /api/auth/config` (they answered 410 or the mode before; now 404);
- creates new rows without a password, and comes with `Script-Migration-Remove-Password.sql`, which drops the `password` column.

The IAM keeps its own copy of each imported password hash until the person signs in once (then it is replaced by an Argon2id hash) or 90 days pass (BRL-10); that copy is removed at the IAM, not here.

Order on the server:

1. Deploy the frontend first: the new frontend no longer asks `GET /api/auth/config`, and works against the running backend.
2. Deploy the backend (`pnpm install --frozen-lockfile`, restart PM2).
3. Run `Script-Migration-Remove-Password.sql` after the restart: the code before it still wrote the column.
4. Remove `AUTH_MODE`, `ACCESS_TOKEN`, `REFRESH_TOKEN`, `EXPIRES_ACCESS_TOKEN` and `EXPIRES_REFRESH_TOKEN` from `.env`, and restart PM2 once more. Delete `export.json` and `mapping.csv` if they are still on the server.

## Changed email and deleted accounts (2026-10-27)

Milestones M12 and M13 of VTK IAM (IAM TODO board items 1.56 and 1.65; `docs/INTEGRATION.md` of the IAM, sections 8.4 and 9). This version needs `@vtk-iam/node` 0.6.0 (in `vendor/`).

**Changed email.** A person can change their email on the account page of the IAM; their `sub` stays the same. Each `"user"` row remembers which IAM session last refreshed its email, and when (`iam_session_id`, `iam_profile_refreshed_at`, `Script-Migration-IAM-Profile-Refresh.sql`). When a token of another session arrives, which happens after a sign-in, the backend asks `/oauth2/userinfo` once and, when the IAM has verified the new address, changes `"user".email` and the `task.user_mail` of that user's tasks in one statement, since the email is what ties tasks to their user. The name stays. A row is asked about at most once every 15 minutes, so two devices or the first requests of a page do not put the IAM in front of every call; a new email therefore shows here at the next sign-in, or 15 minutes after it at the latest. Nothing refuses the request: when the IAM does not answer, the stored email stays and the session asks again after 15 minutes; an address that is not verified, longer than 50 characters once escaped, or held by another row in any letter case is not taken, and the next session tries again.

**Deleted accounts.** Thirty days after a person asks the IAM to delete their account, `iamctl account purge` deletes it and posts a signed notice (`application/secevent+jwt`) to `POST /api/iam/account-deleted`. The backend checks it with the SDK and anonymizes the row of that `sub` (the owner's choice, 2026-10-27): name `Deleted account`, email `<id without dashes>@deleted.invalid` (48 characters, unique, and on a domain no IAM account can have, so the row is never linked again), role 0, no `iam_sub`; the tasks of the row move to that placeholder in the same statement and stay in their projects. The `iam_ended_session` rows of the `sub` are deleted. It answers 202, also for a `sub` that never used this application and for a repeated notice; 400 for a token that fails the check; 500 when the IAM's keys cannot be fetched or the database fails, so that the IAM sends the notice again. The route needs no cookie, no token and no Origin.

Order on the server:

1. Run the migration. It is additive, safe to run twice, and the version running now does not read the columns:

   ```bash
   psql "<connection>" -v ON_ERROR_STOP=1 -f Script-Migration-IAM-Profile-Refresh.sql
   ```

2. Deploy this version (`pnpm install --frozen-lockfile`, restart PM2).
3. In the IAM console, application `taskmanager-v1`, tab URI, set "URI nhận thông báo tài khoản đã xóa" to `https://api-taskmanager-v1.vantuankhanh.com/api/iam/account-deleted` and save.

Verify: `curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/secevent+jwt' --data x https://api-taskmanager-v1.vantuankhanh.com/api/iam/account-deleted` prints `400`.
