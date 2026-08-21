import type { AuditLogPage } from "@/lib/audit/repository.ts";
import type { EmailLogPage } from "@/lib/email/repository.ts";
import { buildPagerLinks } from "@/src/routes/shared/helpers.ts";

type PagedLog = Pick<AuditLogPage, "total" | "page" | "pageSize">;

export function LogPager(
  { page, pageParamKey, queryString, registrationId }: {
    page: PagedLog | EmailLogPage;
    pageParamKey: "auditPage" | "commPage" | "timelinePage";
    queryString: string;
    registrationId: string;
  },
) {
  const { pages, prevHref, nextHref } = buildPagerLinks(
    page,
    pageParamKey,
    queryString,
    registrationId,
  );

  return (
    <div class="text-body-muted mt-3 flex items-center justify-between gap-3 text-xs">
      <p>
        Seite {page.page} / {pages} - {page.total} Einträge
      </p>
      <div class="flex gap-2">
        <a
          aria-disabled={page.page <= 1}
          class="btn-secondary inline-block px-3 py-1 disabled:pointer-events-none disabled:opacity-40"
          href={prevHref}
        >
          Zurück
        </a>
        <a
          aria-disabled={page.page >= pages}
          class="btn-secondary inline-block px-3 py-1 disabled:pointer-events-none disabled:opacity-40"
          href={nextHref}
        >
          Weiter
        </a>
      </div>
    </div>
  );
}
