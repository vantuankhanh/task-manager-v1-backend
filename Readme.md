# Back-end for task manager app

## Intall required packages

```cmd
npm install
```

The project is managed with pnpm (`pnpm-lock.yaml`); on the server use `pnpm install --frozen-lockfile`. The VTK IAM SDK `@vtk-iam/node` is not on a registry: it is installed from `vendor/vtk-iam-node-0.3.0.tgz` in this repository.

## Run project

```cmd
npm run dev
```

## Environment

Copy `.env.example` to `.env` and fill it in. Never commit `.env`.

| Variable | Used for |
| --- | --- |
| `PORT` | Port the server listens on |
| `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USER`, `DB_PASSWORD`, `DB_CA` | PostgreSQL connection (`DB_CA` only when the server needs a CA certificate) |
| `IAM_ISSUER`, `IAM_CLIENT_ID`, `IAM_CLIENT_SECRET`, `IAM_API_AUDIENCE`, `APP_BASE_URL`, `FRONTEND_BASE_URL`, `COOKIE_SECRET` | Sign-in through VTK IAM, see below |

## Sign-in

Users sign in at VTK IAM. The SDK serves `GET /api/auth/login`, `GET /api/auth/callback`, `POST /api/auth/refresh`, `POST /api/auth/logout` and `POST /api/auth/backchannel-logout`, keeps the tokens in httpOnly cookies and answers CORS for `FRONTEND_BASE_URL` only. `GET /api/me` answers the signed-in user. After sign-out the browser lands on `FRONTEND_BASE_URL` + `/auth/login`, which must be registered at the IAM as a post-logout redirect URI. A sign-in that fails on the callback is sent to `FRONTEND_BASE_URL` + `/auth/access?reason=access_denied` (no role in the application) or `?reason=sign_in_failed` (anything else). Requests under `/api/auth/` are logged without their query string. Needs Node.js 22.12 or later. The server refuses to start when one of the variables above is missing, and names it.

Accounts are created and roles managed at the IAM: the role is `admin` in the access token of the IAM application `taskmanager-v1` (1 in the `role` column, which is kept in step), anything else is a normal user (0).

The sign-in this app did itself (`POST /api/login`, `GET /api/refresh-token`, `POST /api/user`, `PUT /api/user/changerole`, `GET /api/auth/config` and the `AUTH_MODE` switch) was removed in milestone M9 of VTK IAM, on 2026-10-16. How the move went, and what M9 changed on the server: [docs/IAM-MIGRATION.md](docs/IAM-MIGRATION.md).

## Database scripts

| File | What it does |
| --- | --- |
| `Script-Postgree-FA-Project-Management.sql` | Creates the tables and sample data |
| `Script-Migration-IAM-Sub.sql` | Adds `"user".iam_sub` and two unique indexes. Safe to run again |
| `Script-Migration-IAM-Ended-Session.sql` | Adds the table of sessions VTK IAM reported as ended. Safe to run again |
| `Script-Migration-Remove-Password.sql` | Drops `"user".password`. Safe to run again |
| `Script-Delete_All-Database.sql` | Deletes every row of the three tables |

## Tests

```cmd
node --test "test/**/*.test.js"
```

The tests use a stubbed database and a fake IAM; they need no network and no `.env`.

## API documentation

Swagger UI is served at `/docs`.
