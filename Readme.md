# Back-end for task manager app

## Intall required packages

```cmd
npm install
```

The project is managed with pnpm (`pnpm-lock.yaml`); on the server use `pnpm install --frozen-lockfile`. The VTK IAM SDK `@vtk-iam/node` is not on a registry: it is installed from `vendor/vtk-iam-node-0.1.0.tgz` in this repository.

## Run project

```cmd
npm run dev
```

## Environment

Copy `.env.example` to `.env` and fill it in. Never commit `.env`.

| Variable | Used for |
| --- | --- |
| `PORT` | Port the server listens on |
| `ACCESS_TOKEN`, `REFRESH_TOKEN` | Secrets that sign the access and refresh tokens of the legacy sign-in |
| `EXPIRES_ACCESS_TOKEN`, `EXPIRES_REFRESH_TOKEN` | Lifetimes of those tokens |
| `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USER`, `DB_PASSWORD`, `DB_CA` | PostgreSQL connection (`DB_CA` only when the server needs a CA certificate) |
| `AUTH_MODE` | `legacy` (default) or `iam`, see below |
| `IAM_ISSUER`, `IAM_CLIENT_ID`, `IAM_CLIENT_SECRET`, `IAM_API_AUDIENCE`, `APP_BASE_URL`, `FRONTEND_BASE_URL`, `COOKIE_SECRET` | Needed when `AUTH_MODE=iam` |

## Sign-in: `AUTH_MODE`

`AUTH_MODE` is read once, when the server starts.

- `legacy` (default): the app signs users in itself (`POST /api/login`, `GET /api/refresh-token`, `POST /api/user` to sign up). CORS is unchanged.
- `iam`: users sign in at VTK IAM. The SDK serves `GET /api/auth/login`, `GET /api/auth/callback`, `POST /api/auth/refresh` and `POST /api/auth/logout`, keeps the tokens in httpOnly cookies and answers CORS for `FRONTEND_BASE_URL` only. `GET /api/me` answers the signed-in user. After sign-out the browser lands on `FRONTEND_BASE_URL` + `/auth/login`, which must be registered at the IAM as a post-logout redirect URI. A sign-in that fails on the callback is sent to `FRONTEND_BASE_URL` + `/auth/access?reason=access_denied` (no role in the application) or `?reason=sign_in_failed` (anything else). Requests under `/api/auth/` are logged without their query string. The legacy sign-in endpoints and `PUT /api/user/changerole` answer 410. Needs Node.js 22.12 or later. The server refuses to start when one of the `IAM_*`, `APP_BASE_URL`, `FRONTEND_BASE_URL` or `COOKIE_SECRET` variables is missing, and names it.

`GET /api/auth/config` answers `{"mode": "legacy"}` or `{"mode": "iam"}` in both modes; the frontend uses it to pick the sign-in to show.

The rules for admins and normal users (`src/routes/routes.js`) are the same in both modes. In `legacy` mode the role is the `role` column of the user (0 normal user, 1 admin); in `iam` mode it is the role `admin` in the access token of the IAM application `taskmanager-v1`.

Moving a running installation to `iam` mode, and back: [docs/IAM-MIGRATION.md](docs/IAM-MIGRATION.md). It needs `Script-Migration-IAM-Sub.sql` (adds the `iam_sub` column) to be run first.

## Database scripts

| File | What it does |
| --- | --- |
| `Script-Postgree-FA-Project-Management.sql` | Creates the tables and sample data |
| `Script-Migration-IAM-Sub.sql` | Adds `"user".iam_sub` and two unique indexes for `AUTH_MODE=iam`. Safe to run again |
| `Script-Delete_All-Database.sql` | Deletes every row of the three tables |

## Tests

```cmd
node --test "test/**/*.test.js"
```

The tests use a stubbed database and a fake IAM; they need no network and no `.env`.

## API documentation

Swagger UI is served at `/docs`. It lists the routes registered for the current `AUTH_MODE`.
