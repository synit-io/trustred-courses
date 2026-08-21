# TrustRed Courses Architecture

TrustRed Courses is a single-tenant, server-rendered application. Each instance
represents one organization and owns its branding, legal configuration, users,
courses, registrations, and Deno KV data.

## Technology stack

- TypeScript
- Deno 2.x
- Hono SSR with JSX
- Deno KV
- Tailwind CSS
- `nodemailer`
- `Deno.cron`

## Runtime entrypoints

| File                                                | Purpose                                     |
| --------------------------------------------------- | ------------------------------------------- |
| [`entrypoints/local.ts`](../entrypoints/local.ts)   | Local development and direct self-hosting   |
| [`entrypoints/deploy.ts`](../entrypoints/deploy.ts) | Deno Deploy fetch handler                   |
| [`deploy.ts`](../deploy.ts)                         | Deno Deploy compatibility entrypoint        |
| [`main.tsx`](../main.tsx)                           | Docker and runtime compatibility entrypoint |

Local and Docker runtimes start `Deno.serve`. Deno Deploy exports the same Hono
application as a fetch handler.

## Application bootstrap

[`src/app/create-app.ts`](../src/app/create-app.ts) owns application
composition:

1. load environment configuration
2. bootstrap the initial administrator once
3. register scheduled jobs
4. create the Hono application
5. register global middleware
6. register routes
7. register HTML error pages

Supporting modules:

| File                                                          | Responsibility                                                                     |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [`src/app/middleware.tsx`](../src/app/middleware.tsx)         | Static assets, request logging, security headers, SSR renderer, sessions, and RBAC |
| [`src/app/renderer.tsx`](../src/app/renderer.tsx)             | Shared HTML document, navigation, and footer                                       |
| [`src/app/register-routes.ts`](../src/app/register-routes.ts) | Central route registration and ordering                                            |
| [`src/app/error-pages.tsx`](../src/app/error-pages.tsx)       | HTML `404` and `500` responses                                                     |

## Route structure

Routes follow a file convention:

```text
src/routes/**/page.tsx   HTML page routes
src/routes/**/route.ts   API and mutation routes
```

Main route groups:

```text
src/routes/(site)        public courses, login, and legal pages
src/routes/admin         protected administration pages
src/routes/api           authentication, registration, payment, and admin APIs
src/routes/shared        shared route constants and HTTP helpers
src/components/ui        reusable UI components
```

Global middleware resolves sessions before protected handlers run. Admin pages
redirect unauthenticated users to `/admin/login`; protected API routes return
HTTP `401` or `403` responses.

## Domain and infrastructure modules

Application behavior lives outside route handlers in `lib/`:

```text
lib/admin                dashboard and course summary read models
lib/audit                audit persistence
lib/auth                 magic-link authentication, sessions, cookies, RBAC
lib/background           scheduled jobs
lib/content              public content
lib/courses              course persistence
lib/email                templates, delivery, logs, and outbox
lib/kv                   Deno KV connection
lib/observability        structured logging and trace context
lib/payments             PayPal checkout, capture, and rate limiting
lib/public_snapshot      public read snapshots
lib/registrations        registration workflow and persistence
lib/users                administrator persistence and bootstrap
```

Route handlers validate HTTP input, call these modules, and build HTTP
responses. Domain state values and shared entity types live in
[`lib/types.ts`](../lib/types.ts).

## Persistence

Deno KV is the primary database.

- Deno Deploy uses an attached managed KV database.
- Local and self-hosted runtimes use `KV_PATH`.
- Default local path is `.data/aid-org-courses.kv`.
- Docker deployments persist `/app/.data` using a host volume.

Repositories own operational records such as users, courses, registrations,
sessions, audit logs, email logs, and queued email jobs.

## Public read snapshots

Public home and course pages use KV-backed read snapshots from
[`lib/public_snapshot/service.ts`](../lib/public_snapshot/service.ts). Snapshots
contain the public course view and seat availability, avoiding registration
scans for ordinary page reads.

Course and registration writes rebuild affected snapshots incrementally. A full
rebuild function remains available for repair and tests.

## Authentication and authorization

Administrators authenticate through email magic links. The application uses
`@synitio/kv-magic-link-auth` behind the local auth facade in
[`lib/auth/service.ts`](../lib/auth/service.ts).

Security controls include:

- expiring, one-time magic links
- binding cookie and request-context verification
- configurable idle and absolute session lifetimes
- session invalidation through user `authVersion`
- failed-login rate limiting
- secure cookie configuration
- role hierarchy: `viewer`, `editor`, `approver`, `admin`, `super_admin`

## Registration and payment flow

[`lib/registrations/service.ts`](../lib/registrations/service.ts) owns double
opt-in, state transitions, waiting-list changes, notifications, audit writes,
and public snapshot updates.

Paid courses use server-side PayPal order creation and capture. Pending payment
state is stored in KV, and a registration is finalized only after successful
capture. Free courses do not require PayPal configuration.

## Email and scheduled jobs

Email delivery uses `nodemailer`. Failed deliveries can enter a KV-backed outbox
for retry.

[`lib/background/cron.ts`](../lib/background/cron.ts) registers:

| Job                    | Schedule    | Purpose                                  |
| ---------------------- | ----------- | ---------------------------------------- |
| `email-outbox-retry`   | `0 * * * *` | Retry due email jobs hourly              |
| `email-outbox-cleanup` | `0 3 * * *` | Remove eligible old outbox records daily |
| `course-reminders`     | `0 7 * * *` | Send configured course reminders daily   |

Self-hosted runtime tasks enable `--unstable-kv` and `--unstable-cron`.

## Logging and health

Structured JSON logging is enabled by default with `LOG_FORMAT=json`. Request
logs include method, path, status, duration, and supported `traceparent` or
request-ID context. Sensitive query values are redacted before logging.

`GET /api/health` returns application status and a timestamp.

## Embedding

TrustRed Courses can run inside an iframe. `EMBED_ALLOWED_ORIGINS` controls the
Content Security Policy `frame-ancestors` directive. Embedded mode uses a
compact layout and emits resize messages:

```json
{
  "type": "aid-org-courses:resize",
  "height": 1234
}
```

Parent websites can use this event to resize the iframe.

## Related documentation

- [Development guide](./DEVELOPMENT.md)
- [Self-hosting guide](./SELF_HOSTING.md)
- [Documentation index](./README.md)
