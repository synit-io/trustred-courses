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
APP_TAGLINE
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
TRUSTED_CLIENT_IP_HEADER
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

## Demo mode

A public demo or marketing instance runs with `DEMO_MODE=true`. Demo mode:

- hard-disables all outgoing e-mail; SMTP is never contacted, every mail is
  logged as `suppressed` in the registration timeline
- shows a demo banner on every page
- displays login links and registration confirmation links directly on the page
  instead of mailing them, so the full flow works without SMTP
- records paid-course registrations as `demo` payments instead of redirecting to
  PayPal
- unlocks `deno task seed:demo`, which appends realistic demo data on every run
- rejects `deno task smtp:test`
- refuses to delete courses or users (server-side, UI hides the buttons)
- seeds the demo dataset on first boot when the store holds no demo course
- wipes ALL data and re-seeds on `DEMO_MODE_RESET_CRON` (5-field cron, UTC;
  default `0 * * * *` = every full hour; set `off` to disable);
  `DEMO_MODE_RESET_COURSES` sets the dataset size
- shows the reset interval and a countdown to the next reset in the top banner,
  as a chip in the admin navigation and on the dashboard

Add demo data as often as needed:

```bash
DEMO_MODE=true deno task seed:demo --courses=10
```

Options: `--courses=<n>` (default 8), `--min-registrations=<n>` (default 4),
`--max-registrations=<n>` (default 28), `--seed=<n>` for a reproducible content
shape.

Reset by hand (wipes everything, logs everyone out, re-seeds):

```bash
DEMO_MODE=true deno task demo:reset
```

Every run creates the demo accounts `demo-admin@example.org` (admin),
`demo-approver@example.org` and `demo-viewer@example.org` when missing. All
generated addresses use RFC 2606 reserved domains and can never receive mail.

Never enable `DEMO_MODE` on a production system: anyone who knows an admin
e-mail address can log in, because login links are shown on the page.

## Screenshots

`screenshots/` holds a preview of every screen plus an index with captions. It
is generated, not hand-made. To refresh it, start a demo instance and run the
capture script against it:

```bash
KV_PATH=/tmp/shots.kv DEMO_MODE=true DEMO_MODE_RESET_CRON=off \
  APP_NAME="TrustRed Courses" APP_TAGLINE="Ausbildung. Termine. Anmeldung." \
  deno run -A --unstable-kv --unstable-cron entrypoints/local.ts
```

```bash
deno task screenshots --base-url=http://localhost:8000
```

The script drives a headless Chromium: it uses `SCREENSHOT_BROWSER` when set, a
locally installed Chrome or a cached Playwright Chromium, and otherwise lets
`@astral/astral` download Chromium into its cache once. Screenshots are taken at
2x device pixel ratio (1440 px desktop, 390 px mobile). The demo banner is
hidden by default; pass `--keep-demo-banner` to keep it, `--only=03,10` to
refresh single files.

## Tasks

| Command                  | Purpose                                                               |
| ------------------------ | --------------------------------------------------------------------- |
| `deno task css`          | Build `static/app.css` with Tailwind CSS                              |
| `deno task dev`          | Build CSS and start watch-mode development                            |
| `deno task dev:clean`    | Remove local dependency/CSS caches and restart development            |
| `deno task check`        | Check formatting, lint, and types                                     |
| `deno task docker:build` | Build local `trustred-courses:latest` image                           |
| `deno task test`         | Run automated tests                                                   |
| `deno task e2e`          | Run Dockerized end-to-end tests                                       |
| `deno task seed`         | Create development users and courses                                  |
| `deno task seed:demo`    | Add realistic demo data, requires `DEMO_MODE=true`                    |
| `deno task demo:reset`   | Wipe all data and re-seed the demo dataset, requires `DEMO_MODE=true` |
| `deno task screenshots`  | Capture README/social-media screenshots from a running demo instance  |
| `deno task smtp:test`    | Diagnose SMTP and optionally send a test email                        |
| `deno task start`        | Build CSS and start direct self-host runtime                          |
| `deno task update`       | Update declared dependencies                                          |

## Verification

Run repository checks and tests:

```bash
deno task check
deno task test
```

CI runs both commands before end-to-end tests and image publication.

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
