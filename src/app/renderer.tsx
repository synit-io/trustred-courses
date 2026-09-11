import { getDemoResetInfo } from "@/lib/demo/schedule.ts";
import { env, isDemoMode } from "@/lib/env.ts";
import type { SessionUser } from "@/src/app/context.ts";

export function RootDocument(
  { children, user }: { children: unknown; user?: SessionUser },
) {
  const navItems = user
    ? [
      { href: "/", label: "Kurse" },
      { href: "/admin/dashboard", label: "Dashboard" },
      { href: "/admin/users", label: "Benutzer" },
    ]
    : [{ href: "/", label: "Kurse" }];
  const navCount = navItems.length + 1;
  const year = new Date().getFullYear();
  const demoMode = isDemoMode();
  const resetInfo = getDemoResetInfo();

  return (
    <html lang="de-DE">
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0"
        />
        <title>{env.appName}</title>
        <link rel="preload" href="/static/app.css" as="style" />
        <link rel="stylesheet" href="/static/app.css" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossorigin=""
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Fugaz+One&family=Open+Sans:wght@400;600;700&display=swap"
          rel="stylesheet"
        />
        <script src="/static/embed.js" defer />
      </head>
      <body class="app-shell">
        <div class="top-stripe" />
        {demoMode
          ? (
            <div class="notice-bar" role="status">
              <div class="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3 text-sm font-semibold">
                <span class="notice-kicker">Demo</span>
                <span class="notice-text">
                  Demo-System mit Beispieldaten. E-Mail-Versand und Zahlungen
                  sind deaktiviert.
                  {resetInfo.enabled
                    ? ` Alle Daten werden automatisch ${resetInfo.description} zurückgesetzt${
                      resetInfo.countdown
                        ? `, nächster Reset ${resetInfo.countdown}`
                        : ""
                    }.`
                    : ""}
                </span>
              </div>
            </div>
          )
          : null}
        <header class="site-header">
          <div class="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4">
            <a href="/" class="brand-block">
              <span class="brand-mark">{env.appName}</span>
              {env.appTagline
                ? <span class="brand-tagline">{env.appTagline}</span>
                : null}
            </a>
            <div class="site-nav" data-nav-count={String(navCount)}>
              <button
                aria-expanded="false"
                aria-label="Navigation öffnen"
                class="site-nav-toggle"
                data-site-nav-toggle="true"
                type="button"
              >
                <span class="site-nav-toggle-label">Menü</span>
                <span class="site-nav-toggle-icon" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
              </button>
              <nav class="site-nav-panel">
                {navItems.map((item) => (
                  <a
                    class="site-nav-link"
                    href={item.href}
                    key={item.href}
                  >
                    {item.label}
                  </a>
                ))}
                {user && resetInfo.enabled
                  ? (
                    <span
                      class="site-nav-note"
                      title={`Demo-Modus: automatischer Reset ${resetInfo.description}${
                        resetInfo.nextRunTime
                          ? `, nächster Reset um ${resetInfo.nextRunTime}`
                          : ""
                      }`}
                    >
                      Reset {resetInfo.countdown ?? resetInfo.description}
                    </span>
                  )
                  : null}
                {user
                  ? (
                    <form action="/api/auth/logout" method="post">
                      <button
                        class="btn-secondary btn-sm site-nav-button"
                        title={user.email}
                        type="submit"
                      >
                        Logout
                      </button>
                    </form>
                  )
                  : (
                    <a
                      class="btn-primary btn-sm site-nav-button"
                      href="/admin/login"
                    >
                      Login
                    </a>
                  )}
              </nav>
            </div>
          </div>
        </header>
        <main class="main-shell mx-auto max-w-6xl px-4 py-8">{children}</main>
        <footer class="site-footer">
          <div class="mx-auto grid max-w-6xl gap-10 px-4 py-14 md:grid-cols-[1.4fr_1fr_1fr]">
            <div>
              <h2 class="text-xl">{env.appName}</h2>
              {env.appTagline
                ? <p class="site-footer-tagline">{env.appTagline}</p>
                : null}
              <p class="site-footer-text mt-4 max-w-md text-sm">
                Kursangebot mit Online-Anmeldung von {env.legalOrganizationName}
              </p>
            </div>
            <div>
              <h3 class="mb-3 text-lg">Navigation</h3>
              <ul class="space-y-2 text-sm">
                <li>
                  <a href="/">Kurse</a>
                </li>
                <li>
                  {user
                    ? <a href="/admin/dashboard">Dashboard</a>
                    : <a href="/admin/login">Login</a>}
                </li>
                <li>
                  <a href="/impressum">Impressum</a>
                </li>
                <li>
                  <a href="/datenschutz">Datenschutz</a>
                </li>
              </ul>
            </div>
            <div>
              <h3 class="mb-3 text-lg">Kontakt</h3>
              <div class="site-footer-text space-y-1 text-sm">
                <p>{env.legalOrganizationName}</p>
                <p>{env.legalStreet}</p>
                <p>
                  {env.legalPostalCode} {env.legalCity}
                </p>
                <p class="pt-2">
                  E-Mail:{" "}
                  <a class="underline" href={`mailto:${env.legalEmail}`}>
                    {env.legalEmail}
                  </a>
                </p>
              </div>
            </div>
          </div>
          <div class="site-footer-bottom">
            <div class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
              <p>
                © {year} {env.legalOrganizationName}
              </p>
              <div class="flex items-center gap-4">
                <a href="/impressum">Impressum</a>
                <a href="/datenschutz">Datenschutz</a>
              </div>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
