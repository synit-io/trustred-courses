# Self-Hosting TrustRed Courses

Run TrustRed Courses on a Linux server with Docker Compose. Official images will
be published at [Docker Hub](https://hub.docker.com/r/synitio/trustred-courses).

For hosting, updates, backups, and application operations managed by synit.io,
see the [TrustRed managed service](https://www.synit.io/products/trustred).

## Image publishing

After checks and end-to-end tests pass on `main`, GitHub Actions builds and
pushes `synitio/trustred-courses:latest` to Docker Hub. Repository configuration
requires:

- Actions secret `DOCKERHUB_USERNAME`: Docker Hub account with push access to
  the `synitio` namespace
- Actions secret `DOCKERHUB_TOKEN`: Docker Hub personal access token with read
  and write permissions

## Requirements

- Linux server with Docker Engine and Docker Compose v2
- domain name pointing to the server
- HTTPS reverse proxy
- SMTP account for login and registration emails
- PayPal REST app credentials only when offering paid courses

## 1. Create deployment files

Create a dedicated directory:

```bash
sudo mkdir -p /opt/trustred-courses/data
sudo chown -R "$USER" /opt/trustred-courses
cd /opt/trustred-courses
```

Create `.env` with production values:

```dotenv
NODE_ENV="production"
APP_NAME="TrustRed Courses"
APP_TAGLINE="Ausbildung. Termine. Anmeldung."
APP_BASE_URL="https://courses.example.org"
APP_TIME_ZONE="Europe/Berlin"
INITIAL_ADMIN_EMAIL="admin@example.org"
KV_PATH=".data/trustred-courses.kv"

AUTH_COOKIE_SECURE="true"
AUTH_DEV_EXPOSE_MAGIC_LINK="false"
TRUSTED_CLIENT_IP_HEADER="x-real-ip"

SMTP_HOST="smtp.example.org"
SMTP_PORT="587"
SMTP_USER="smtp-user"
SMTP_PASS="replace-with-secret"
SMTP_SECURE="false"
MAIL_FROM_ADDRESS="courses@example.org"
MAIL_FROM_NAME="TrustRed Courses"
MAIL_ADMIN_NOTIFICATION_TO="admin@example.org"

LEGAL_ORGANIZATION_NAME="Example Organization"
LEGAL_REPRESENTATIVE="Responsible Person"
LEGAL_STREET="Example Street 1"
LEGAL_POSTAL_CODE="12345"
LEGAL_CITY="Example City"
LEGAL_EMAIL="contact@example.org"
LEGAL_PHONE="+49 000 000000"
```

Use port `465` with `SMTP_SECURE="true"` for implicit TLS. Use port `587` with
`SMTP_SECURE="false"` for STARTTLS. Keep `.env` private:

```bash
chmod 600 .env
```

See [`.env.example`](../.env.example) for session, rate-limit, embedding,
logging, and optional PayPal settings.

`APP_TIME_ZONE` controls course input, display, date filters and reminders;
stored UTC timestamps are preserved. Review displayed times after changing this
setting. The repository's root Compose file forwards every documented feature
setting, including PayPal, legal information and embedding origins. `.env` files
remain excluded from Docker images.

Create `docker-compose.yml`:

```yaml
services:
  web:
    image: synitio/trustred-courses:latest
    restart: unless-stopped
    env_file:
      - .env
    ports:
      - "127.0.0.1:8000:8000"
    volumes:
      - ./data:/app/.data
```

Pin a version tag instead of `latest` when rollout control is important.

## 2. Start and verify

```bash
docker compose pull
docker compose up -d
docker compose ps
docker compose logs --tail=100 web
curl --fail http://127.0.0.1:8000/
```

Open `https://courses.example.org/admin/login` and request a magic link using
`INITIAL_ADMIN_EMAIL`.

## 3. Configure HTTPS

Terminate TLS in a reverse proxy and forward requests to
`http://127.0.0.1:8000`. Preserve the original host, protocol, and client IP
headers. Configure the proxy to overwrite `X-Real-IP`; never forward a
client-supplied value unchanged. Keep these values in production:

```dotenv
APP_BASE_URL="https://courses.example.org"
AUTH_COOKIE_SECURE="true"
AUTH_DEV_EXPOSE_MAGIC_LINK="false"
TRUSTED_CLIENT_IP_HEADER="x-real-ip"
```

Only expose ports `80` and `443` publicly. Port `8000` stays bound to localhost.

With an empty `TRUSTED_CLIENT_IP_HEADER`, direct runtimes use the connection's
peer address and ignore forwarded headers. When a header is configured, the
proxy must supply it on every relevant request; missing values fail closed.

## Persistent data

Deno KV is stored at `/app/.data/trustred-courses.kv` inside the container and
persisted in `/opt/trustred-courses/data` on the host. Never run without the
volume mapping: removing the container would otherwise remove application data.

## Back up and restore

Stop writes, archive the data directory, then restart:

```bash
cd /opt/trustred-courses
docker compose stop web
tar -czf "trustred-courses-backup-$(date +%F-%H%M%S).tar.gz" data
docker compose start web
```

Store backups outside the server and test restores regularly. To restore, stop
the container, replace `data` with a verified backup, then start and verify the
application. Keep the replaced directory until verification succeeds.

## Update

Back up first. Then pull and recreate:

```bash
cd /opt/trustred-courses
docker compose pull
docker compose up -d
docker compose logs --tail=100 web
curl --fail http://127.0.0.1:8000/
```

For predictable rollback, record the currently deployed image digest before
updating:

```bash
docker inspect --format='{{index .RepoDigests 0}}' synitio/trustred-courses:latest
```

If verification fails, set `image:` to the previous version tag or digest and
run `docker compose up -d` again. Restore data only when an application update
also changed data incompatibly.

## Troubleshooting

Check container state and recent logs:

```bash
docker compose ps
docker compose logs --tail=200 web
```

Common causes:

- no login email: verify `SMTP_*`, `MAIL_FROM_*`, recipient spam folder, and
  admin email
- invalid links or cookies: verify exact public `APP_BASE_URL`, HTTPS, and
  `AUTH_COOKIE_SECURE="true"`
- data missing after recreation: verify `./data:/app/.data` volume and `KV_PATH`
- PayPal checkout unavailable: set `PAYPAL_ENVIRONMENT`, `PAYPAL_CLIENT_ID`, and
  `PAYPAL_CLIENT_SECRET`
- iframe blocked: configure `EMBED_ALLOWED_ORIGINS` with allowed origins

### Payments and queued mail

Payment recovery runs every five minutes. A pending or unknown capture survives
the browser checkout timeout and is checked against PayPal without requiring
another participant submission. Existing ambiguous captures are retained as
`requires_review`; they are not automatically refunded or replaced by a new
charge. Investigate `payment.manual_review_required` and
`payment.reconciliation_failed` logs, then reconcile the retained order/capture
IDs with the provider and the registration before making a manual correction.
The application does not provide an operator adjudication UI.

Unconfirmed participants can request a fresh confirmation link on the course
page using their email. This keeps the existing registration and payment.

Email retry runs every five minutes, with up to 200 jobs per run. Queue-health
logs expose pending, due and leased counts, oldest pending time and dead-letter
count. Six failed attempts move mail to `email_dead_letters`; these records are
retained for 30 days after failure. Active jobs are never deleted solely because
of age. Inspect failed recipients and SMTP configuration before manually
requeueing a terminal failure. SMTP delivery is at least once, so crash recovery
can still duplicate an already accepted message.

## Demo instance

For a public demo, set `DEMO_MODE="true"` in `.env`, start the stack, then add
demo data. The seed runs in a one-off container against the same `.data` volume
the web service uses, so new courses show up immediately without a restart:

```bash
docker compose run --rm web task seed:demo --courses=10
```

Run it again whenever more data is needed; every run appends. Without Compose:

```bash
docker run --rm -e DEMO_MODE=true -v "$PWD/.data:/app/.data" synitio/trustred-courses:latest task seed:demo --courses=10
```

The image ships the seed scripts with all dependencies cached, so the command
also works without network access. `DEMO_MODE` must be set for both the web
service and the seed container; the seed refuses to run otherwise.

A demo instance protects itself for open-world use: on first boot it seeds the
demo dataset automatically, deleting courses or users is refused, and on
`DEMO_MODE_RESET_CRON` (default every full hour, e.g. `*/30 * * * *` for every
30 minutes) the web container wipes all data and re-seeds. Visitors see the
interval and a countdown to the next reset in the banner and admin navigation.
Trigger a reset manually with:

```bash
docker compose run --rm web task demo:reset
```

Demo mode disables all outgoing e-mail, shows a demo banner, exposes login and
confirmation links on the page and records payments as demo payments. It is not
suitable for real registrations. See
[DEVELOPMENT.md](./DEVELOPMENT.md#demo-mode).

## Security checklist

- keep Docker, host OS, and reverse proxy patched
- keep `.env` readable only by deployment administrators
- use HTTPS and secure cookies
- disable development magic-link exposure
- expose application only through reverse proxy
- maintain off-server backups and test restore procedure
- review logs after deployments and failed login bursts

## License

Self-hosting is permitted only under the repository
[PolyForm Noncommercial License 1.0.0](../LICENSE.md) or a separate commercial
license from synit.io. Fire departments and other qualifying public safety or
noncommercial organizations may use the software for permitted purposes under
that license.
