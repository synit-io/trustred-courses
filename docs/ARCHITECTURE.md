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

Executable entrypoints start `Deno.serve` (port `8000`, or `PORT`). Both Deploy
entrypoints also export the same fetch handler for `deno serve` and managed
runners. Importing them does not start another listener. The standalone fallback
runs on the load event only when the default handler's `onListen` has not
already reported a CLI-managed listener. This keeps `deno run` and `deno serve`
compatible without binding the same port twice; CLI `--host` and `--port` remain
authoritative.

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

Each public course card and detail occupies its own KV value, so catalog size
does not accumulate in one value. All course and registration writes advance a
per-course revision. Publishers capture that revision before deriving the view
and check it on commit, preventing stale calculations from replacing newer
availability. Legacy aggregate snapshots are rebuilt lazily into this format.

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
- successful magic-link and public-registration rate limiting
- exact-origin validation for authenticated state-changing requests
- request-size and public registration field limits
- secure cookie configuration
- role hierarchy: `viewer`, `editor`, `approver`, `admin`, `super_admin`

## Registration and payment flow

[`lib/registrations/service.ts`](../lib/registrations/service.ts) owns double
opt-in, state transitions, waiting-list changes, notifications, audit writes,
and public snapshot updates.

Paid courses use server-side PayPal order creation and capture. Pending payment
state is stored in KV, and a registration is finalized only after successful
capture. Free courses do not require PayPal configuration.

Payment creation reserves the registration fingerprint before contacting PayPal.
Capture starts only after a checked, durable claim. Provider-pending and unknown
outcomes retain their order, request ID and registration ID without a TTL;
scheduled provider lookups recover settlement independently of browser returns.
Ambiguous legacy records and conflicting captures remain available for manual
review. A cancel callback only removes a provably uncaptured checkout.

Registration state transitions use per-course distributed locks and checked
course revisions. Capacity approvals check the lease in their final transaction;
state, indexes, audit and notification intent commit together. Course deletion
checks the same revision after inspecting registration and checkout references.

Expired double-opt-in links can be reissued for the existing submitted record
through `/api/registrations/resend-confirmation`. Reissue rotates the current
token and queues mail atomically; obsolete queued links are suppressed before
dispatch. Responses remain generic and rate limited.

## Time and administration read models

`APP_TIME_ZONE` defaults to `Europe/Berlin`. Course forms, displayed times,
calendar-date filters and reminder dates use this organization zone. Storage
remains UTC. Nonexistent or ambiguous wall times at daylight-saving transitions
are rejected instead of silently selecting an instant.

The dashboard uses course/status indexes or an ordered submission projection,
with a checked lazy backfill for older records. It hydrates only the selected
page; counts and text filters still scan relevant index entries. Course detail
loads only its own registrations. The combined timeline pages all audit/email
references before hydrating a page, without a 500-entry history cutoff.

Revenue is grouped by the currency stored on each payment, including historical
payments for courses later made free. CSV keeps the original 17 columns and
appends `course_total_revenue_currency` and `course_revenue_by_currency` (JSON).
The original aggregate is blank for mixed/unknown currencies. Row filters do not
narrow full-course revenue totals. CSV output streams rows, while sorting and
totals still materialize registration data in memory.

## Email and scheduled jobs

Email delivery uses `nodemailer`. Failed deliveries can enter a KV-backed outbox
for retry.

Outbox workers claim one job near dispatch and recheck lease ownership before
sending. SMTP has bounded connection and socket timeouts. Registration-action,
double-opt-in and confirmation messages are written durably with their owning
state change. Reminder jobs revalidate the current registration and course;
deterministic event keys prevent duplicate queueing.

Critical course changes commit the course, audit and one durable notification
event atomically. A bounded worker fans out that event using per-recipient
deduplication and a durable cursor. Recipients must still be approved when the
worker visits them and must have registered before the event. Message content
uses the course snapshot recorded with that change.

SMTP delivery remains at least once: a process failure after remote acceptance
but before local acknowledgement can duplicate a message. Six failed attempts
move a job to a dead-letter record. Pending and leased jobs are never removed by
age cleanup. Queue health reports backlog, due/leased counts, oldest pending
timestamp and dead-letter count; due-job selection still scans the queue.

[`lib/background/cron.ts`](../lib/background/cron.ts) registers:

| Job                            | Schedule (UTC) | Purpose                                               |
| ------------------------------ | -------------- | ----------------------------------------------------- |
| `email-outbox-retry`           | `*/5 * * * *`  | Drain at most 200 jobs and log queue health           |
| `email-dead-letter-cleanup`    | `0 3 * * *`    | Remove terminal failures after 30 days                |
| `paypal-payment-recovery`      | `*/5 * * * *`  | Reconcile at most 20 pending checkouts                |
| `course-notification-recovery` | `*/5 * * * *`  | Resume durable course notification fanout             |
| `course-reminders`             | `0 7 * * *`    | Queue reminders due on the organization calendar date |

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
