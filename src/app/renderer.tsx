import { env } from "@/lib/env.ts";
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
          href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Source+Sans+3:wght@400;600;700&display=swap"
          rel="stylesheet"
        />
        <script src="/static/embed.js" defer />
      </head>
      <body class="app-shell">
        <div class="top-stripe" />
        <header class="site-header">
          <div class="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
            <a href="/" class="font-display text-xl font-semibold">
              {env.appName}
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
              <nav class="site-nav-panel text-sm">
                {navItems.map((item) => (
                  <a
                    class="site-nav-link px-2 py-1"
                    href={item.href}
                    key={item.href}
                  >
                    {item.label}
                  </a>
                ))}
                {user
                  ? (
                    <form action="/api/auth/logout" method="post">
                      <button
                        class="btn-secondary site-nav-button px-2 py-1 text-xs"
                        type="submit"
                      >
                        Logout ({user.email})
                      </button>
                    </form>
                  )
                  : (
                    <a
                      class="btn-primary site-nav-button px-3 py-2 text-xs"
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
        <footer class="mx-auto mt-8 w-full max-w-6xl border-t border-neutral-200 px-4 py-6 text-sm text-body-muted">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p>
              {env.appName} - Kontakt:{" "}
              <a class="underline" href={`mailto:${env.legalEmail}`}>
                {env.legalEmail}
              </a>
            </p>
            <div class="flex items-center gap-3">
              <a class="underline" href="/impressum">Impressum</a>
              <a class="underline" href="/datenschutz">Datenschutz</a>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
