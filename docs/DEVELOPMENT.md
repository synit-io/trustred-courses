# TrustRed Courses Development Guide

## Requirements

- Deno 2.x
- Docker and Docker Compose for container and end-to-end tests
- SMTP account for production-like email testing
- PayPal REST application credentials only when testing paid courses

## Environment configuration

Create local configuration from the documented template:

```bash
cp .env.example .env
```

Important organization values:

```text
APP_NAME
APP_BASE_URL
INITIAL_ADMIN_EMAIL
LEGAL_*
```

Email configuration:

```text
SMTP_*
MAIL_*
```

Paid-course configuration:

```text
PAYPAL_ENVIRONMENT
PAYPAL_CLIENT_ID
PAYPAL_CLIENT_SECRET
```

Authentication, session, and embedding configuration:

```text
AUTH_COOKIE_SECURE
AUTH_DEV_EXPOSE_MAGIC_LINK
AUTH_RATE_LIMIT_*
MAGIC_LINK_TTL_MINUTES
SESSION_*
REGISTRATION_*
EMBED_ALLOWED_ORIGINS
```

See [`.env.example`](../.env.example) for every setting, default, and allowed
value.

## Local setup

Install dependencies and cache the local entrypoint:

```bash
deno install
deno cache entrypoints/local.ts
```

Build CSS and start watch mode:

```bash
deno task dev
```

Optional development data:

```bash
deno task seed
```

Open:

- public application: <http://localhost:8000/>
- administrator login: <http://localhost:8000/admin/login>
- health endpoint: <http://localhost:8000/api/health>

Local Deno KV defaults to `.data/aid-org-courses.kv`.

## Development without SMTP

Use local debug authentication when no SMTP server is available:

```dotenv
APP_BASE_URL="http://localhost:8000"
AUTH_DEV_EXPOSE_MAGIC_LINK="true"
AUTH_COOKIE_SECURE="false"
INITIAL_ADMIN_EMAIL="your-email@example.org"
```

SMTP values may remain empty in this mode. Never expose development auth helpers
on a public deployment.

### First local login

1. Optionally run `deno task seed`.
2. Open `/admin/login`.
3. Request a login link with `INITIAL_ADMIN_EMAIL`.
4. Follow the `Dev-Link: Jetzt einloggen` link shown by the local login page.

The debug link appears only when:

- `AUTH_DEV_EXPOSE_MAGIC_LINK=true`
- `APP_BASE_URL` uses `localhost`, `127.0.0.1`, `::1`, or a `.localhost` host
- neither `NODE_ENV=production` nor `DENO_DEPLOYMENT_ID` marks production

### Public registration without SMTP

Double-opt-in email cannot be delivered without SMTP. Local debug mode exposes a
development confirmation URL after registration so the confirmation step can
still be tested.

## Tasks

| Command                  | Purpose                                                    |
| ------------------------ | ---------------------------------------------------------- |
| `deno task css`          | Build `static/app.css` with Tailwind CSS                   |
| `deno task dev`          | Build CSS and start watch-mode development                 |
| `deno task dev:clean`    | Remove local dependency/CSS caches and restart development |
| `deno task check`        | Check formatting, lint, and types                          |
| `deno task docker:build` | Build local `trustred-courses:latest` image                |
| `deno task test`         | Run automated tests                                        |
| `deno task e2e`          | Run Dockerized end-to-end tests                            |
| `deno task seed`         | Create development users and courses                       |
| `deno task smtp:test`    | Diagnose SMTP and optionally send a test email             |
| `deno task start`        | Build CSS and start direct self-host runtime               |
| `deno task update`       | Update declared dependencies                               |

## Verification

Run repository checks and tests:

```bash
deno task check
deno task test
```

Run the end-to-end flow separately:

```bash
deno task e2e
```

The end-to-end harness uses Docker Compose and Mailpit. It starts the
application and mail server, requests a real magic link, reads the generated
email, verifies authentication, and confirms protected dashboard access.

Automated coverage includes:

- role-based access control
- registration transitions and waiting lists
- double opt-in
- course reminders
- paid-course behavior
- public snapshots
- audit persistence
- email templates and outbox retries
- security helpers and magic-link authentication

## Runtime and deployment checks

Test direct production-style startup locally:

```bash
deno task start
```

Build the local Docker image:

```bash
deno task docker:build
```

Production Docker operation belongs in the
[self-hosting guide](./SELF_HOSTING.md).

## Deno Deploy

The Deno Deploy entrypoint is [`deploy.ts`](../deploy.ts), which forwards to
[`entrypoints/deploy.ts`](../entrypoints/deploy.ts).

For a tenant deployment:

1. create a Deno Deploy application
2. set the repository root as application directory
3. attach a managed Deno KV database
4. configure organization, security, SMTP, and optional PayPal variables
5. deploy `deploy.ts`
6. request the initial administrator login link

Deno Deploy always uses attached managed KV, ignoring local `KV_PATH`.

## Troubleshooting

### Development startup

Clear caches and restart:

```bash
deno task dev:clean
```

### SMTP diagnostics

```bash
deno task smtp:test --to=you@example.org
deno task smtp:test --dry-run --to=you@example.org
```

### Administrator login email missing

Check:

- administrator exists and is active
- SMTP credentials and delivery logs
- `APP_BASE_URL`
- authentication rate limits
- magic-link TTL
- recipient spam folder

### Development link missing

Verify local `APP_BASE_URL`, `AUTH_DEV_EXPOSE_MAGIC_LINK=true`, and
`AUTH_COOKIE_SECURE=false`. Ensure `NODE_ENV` is not `production` and
`DENO_DEPLOYMENT_ID` is unset.

## Related documentation

- [Architecture](./ARCHITECTURE.md)
- [Self-hosting](./SELF_HOSTING.md)
- [Documentation index](./README.md)
