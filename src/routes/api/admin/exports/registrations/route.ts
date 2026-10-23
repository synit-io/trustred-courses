import { loadRegistrationExport } from "@/lib/admin/registration_rows.ts";
import type { RegistrationStatus } from "@/lib/types.ts";
import type { AppEnv } from "@/src/app/context.ts";
import { Hono } from "hono";

export function csvEscape(value: string | number | null): string {
  if (value === null) return "";
  const raw = String(value);
  const text = /^[=+\-@]/.test(raw.trimStart()) ? `'${raw}` : raw;
  if (
    text.includes(",") || text.includes("\n") || text.includes("\r") ||
    text.includes('"')
  ) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

export const adminRegistrationsExportRoute = new Hono<AppEnv>().get(
  "/registrations.csv",
  async (c) => {
    const filters = {
      q: c.req.query("q") ?? undefined,
      status: (c.req.query("status") as RegistrationStatus | "all") ?? "all",
      courseId: c.req.query("courseId") ?? "all",
      dateFrom: c.req.query("dateFrom") ?? undefined,
      dateTo: c.req.query("dateTo") ?? undefined,
    };

    const { rows, revenueByCourseId } = await loadRegistrationExport(filters);

    const header = [
      "id",
      "course",
      "first_name",
      "last_name",
      "email",
      "phone",
      "status",
      "waiting_list_position",
      "submitted_at",
      "reviewed_at",
      "reviewed_by",
      "payment_status",
      "payment_provider",
      "payment_amount_cents",
      "payment_currency",
      "payment_paid_at",
      "course_total_revenue_cents",
      "course_total_revenue_currency",
      "course_revenue_by_currency",
    ];

    function* lines(): Generator<string> {
      yield header.join(",");
      for (const row of rows) {
        const revenue = revenueByCourseId.get(row.courseId) ?? [];
        const singleCurrency =
          revenue.length === 1 && revenue[0].currency !== "UNKNOWN"
            ? revenue[0]
            : null;
        yield "\n" + [
          row.id,
          row.courseTitle,
          row.firstName,
          row.lastName,
          row.email,
          row.phone,
          row.status,
          row.waitingListPosition,
          row.submittedAt,
          row.reviewedAt,
          row.reviewedBy,
          row.paymentStatus ?? "not_required",
          row.paymentProvider ?? "",
          row.paymentAmountCents ?? "",
          row.paymentCurrency ?? "",
          row.paymentPaidAt ?? "",
          singleCurrency?.totalRevenueCents ?? (revenue.length === 0 ? 0 : ""),
          singleCurrency?.currency ?? "",
          JSON.stringify(
            Object.fromEntries(
              revenue.map((r) => [r.currency, r.totalRevenueCents]),
            ),
          ),
        ].map(csvEscape).join(",");
      }
    }
    const iterator = lines();
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        const next = iterator.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(next.value));
      },
      cancel() {
        iterator.return(undefined);
      },
    });

    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header(
      "Content-Disposition",
      `attachment; filename=registrations-${
        new Date().toISOString().slice(0, 10)
      }.csv`,
    );
    return c.body(stream);
  },
);
