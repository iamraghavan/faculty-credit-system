# Faculty Credit System — Backend API

REST API for **CreditWise**, the faculty credit system of E.G.S. Pillay Group of Institutions.
Faculty submit "good works" (positive credits), admins/OAs issue remarks (negative credits),
faculty can appeal, and admins review, report and export.

|                 |                                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------------- |
| Runtime         | Node.js 22, Express 5                                                                              |
| Database        | AWS DynamoDB (`@aws-sdk/lib-dynamodb`)                                                             |
| Auth            | JWT bound to a server-side session (revocable), optional MFA (authenticator app or email)          |
| Hosting         | Vercel (`api/index.js`, `vercel.json`); `index.js` for a normal server; `lambda.js` for AWS Lambda |
| Package manager | **pnpm only** (`corepack pnpm …`)                                                                  |

> ⚠️ **Never point a development machine at production tables.** Use the local test server below.
> The `.env` file must never be committed.

---

## 1. Run it locally — safely (no real data)

Requirements: **Node.js 22+** and **Java 17+** (for DynamoDB Local).

```powershell
cd backend
corepack pnpm install
corepack pnpm test:db:install   # downloads Amazon's DynamoDB Local (~50 MB, once)
corepack pnpm test:server        # API on http://127.0.0.1:5050 with test data
```

`test:server` starts the real app against **DynamoDB Local** with fake credentials, seeded test users,
and email / WhatsApp / GitHub / Firebase replaced by fakes. All outgoing internet traffic is blocked.

Test accounts (password `Test-Passw0rd-123!`):

| Role                             | Email                                           |
| -------------------------------- | ----------------------------------------------- |
| Admin                            | `admin@example.org`                             |
| Office Assistant (OA)            | `oa1@example.org`                               |
| Faculty                          | `faculty1@example.org`, `faculty2@example.org`  |
| Faculty with app MFA / email MFA | `mfa-app@example.org` / `mfa-email@example.org` |

Point the website at it with `NEXT_PUBLIC_API_URL=http://127.0.0.1:5050/api/v1`.

## 2. Tests

| Command                         | What it does                                                |
| ------------------------------- | ----------------------------------------------------------- |
| `corepack pnpm test`            | All unit + API tests (starts DynamoDB Local automatically)  |
| `corepack pnpm test:unit`       | Fast tests only, no database                                |
| `corepack pnpm test:api`        | API / integration tests                                     |
| `corepack pnpm test:coverage`   | Tests + coverage report → `coverage/lcov-report/index.html` |
| `corepack pnpm smoke`           | One-minute "does it start and answer" check                 |
| `corepack pnpm test:legacy`     | Old pre-audit tests (outdated, kept for reference)          |
| `corepack pnpm lint` / `format` | ESLint / Prettier                                           |

Safety: tests load `tests/setup/testEnv.js` (fake values), never read `.env`, refuse to run if the
database address is not this computer, and block all non-local network traffic.
Tests named **`[BUG] …`** document known bugs and are expected to fail until fixed (`test.failing`).

CI (GitHub Actions, `.github/workflows/ci.yml`) runs lint and the full suite on every push.

## 3. Configuration (environment variables)

Copy `.env.example` to `.env` and fill it in. The server checks settings at startup
(`config/env.js`): missing essentials stop it; unsafe values are logged as warnings
(set `STRICT_CONFIG=true` to refuse to start instead).

| Variable                                                                                  | Required   | Meaning                                                                       |
| ----------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------- |
| `NODE_ENV`                                                                                | yes (prod) | `production` in production (hides internal error details)                     |
| `CORS_ORIGIN`                                                                             | yes (prod) | Exact website origin, e.g. `https://fcs.egspgroup.in` (never `*`)             |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`                                | yes        | DynamoDB access (prefer an IAM role limited to the app's tables)              |
| `DYNAMO_DB_USERS`, `_CREDITS`, `_TITLES`, `_SESSIONS`, `_POLICIES`, `_NOTIFICATIONS`      | yes        | Table names (`_ASSETS`, `_SHORT_URLS`, `_SUBSCRIPTIONS` have defaults)        |
| `JWT_SECRET`                                                                              | yes        | ≥ 32 random characters; signs login tokens and MFA tickets                    |
| `JWT_EXPIRES_IN`                                                                          | no         | Token lifetime, default `1h`                                                  |
| `REQUIRE_SESSION_VALIDATION`                                                              | yes (prod) | `true` — reject tokens without a server session                               |
| `SESSION_TIMEOUT`, `MAX_ACTIVE_SESSIONS`                                                  | no         | Session length (ms) and max sessions per user                                 |
| `EXPORT_SIGNING_SECRET`                                                                   | yes        | ≥ 32 bytes, different from `JWT_SECRET`; signs exports and report share links |
| `REPORT_SHARE_TTL_HOURS`                                                                  | no         | Shared report link lifetime (default 168 = 7 days)                            |
| `MFA_MAX_ATTEMPTS`, `MFA_LOCK_MINUTES`                                                    | no         | Wrong-code limit (5) and lock time (15)                                       |
| `MAX_ISSUED_CREDIT_POINTS`                                                                | no         | Upper limit for any credit's points (10000)                                   |
| `PUBLIC_APP_URL`, `APP_URL`, `FRONTEND_URL`, `LOGIN_URL`                                  | yes        | Public URLs used in links and emails                                          |
| `SHORTLINK_ALLOWED_HOSTS`                                                                 | no         | Extra hosts that short links may point to                                     |
| `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASS`, `EMAIL_SECURE`                    | yes        | SMTP                                                                          |
| `ASSET_GH_OWNER`, `ASSET_GH_REPO`, `ASSET_GH_BRANCH`, `GITHUB_TOKEN`, `ASSET_ALLOWED_EXT` | yes        | Proof-file storage (see roadmap S-9: move to private S3)                      |
| `FIREBASE_SERVICE_ACCOUNT`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_MAILTO`       | no         | Push notifications                                                            |
| `WHATSAPP_API_URL`, `WHATSAPP_TOKEN`, `ENFORCE_WHATSAPP_VERIFICATION`                     | no         | WhatsApp OTP/alerts                                                           |
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE`                           | no         | Error tracking (off when unset)                                               |
| `STRICT_CONFIG`                                                                           | no         | `true` = refuse to start on unsafe settings                                   |

## 4. Project layout

| Path                                      | Purpose                                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------------- |
| `server.js`                               | Builds the Express app (settings check, security headers, CORS, rate limit, routes, errors) |
| `index.js` / `api/index.js` / `lambda.js` | Entry points (normal server / Vercel / Lambda)                                              |
| `instrument.js`                           | Sentry (no-op unless `SENTRY_DSN`)                                                          |
| `config/`                                 | DynamoDB client, role permissions, startup settings check                                   |
| `Routes/` → `Controllers/` → `Models/`    | URL → logic → DynamoDB access                                                               |
| `Controllers/Auth`, `Controllers/Admin`   | Login/MFA/password; admin user & credit management                                          |
| `domain/creditAccounting.js`              | **The** rule for how much each credit counts                                                |
| `utils/`                                  | Credit recalculation, uploads, email, MFA tickets, exports, links                           |
| `tests/`                                  | `audit/` (current suite), `setup/`, `helpers/`, `support/testServer.js`                     |
| `scripts/`                                | Maintenance and test tooling                                                                |

Health checks: `GET /health/live` (process up), `GET /health/ready` (users, policies, and notifications storage reachable).

Provision the application settings and notification tables after configuring their table names:
`node scripts/provision-application-tables.js` previews missing tables, and
`node scripts/provision-application-tables.js --apply` creates only missing tables with an `_id` string key.

## 5. Deploy

Vercel builds from `main` using `pnpm-lock.yaml`. Before deploying:

1. CI is green on the branch.
2. Production settings match §3 (especially `NODE_ENV`, `CORS_ORIGIN`, `REQUIRE_SESSION_VALIDATION`,
   strong `JWT_SECRET` / `EXPORT_SIGNING_SECRET`).
3. Backend and frontend changes that belong together are deployed together
   (e.g. the MFA ticket change).
4. After deploying, check `GET /health/ready` and log in with each role.

Audit reports (testing, security, roadmap) are in `../docs/audit/` in the project folder.
