import { queryRegistrationRows } from "@/lib/admin/registration_rows.ts";
import { listRegistrationsByCourse } from "@/lib/registrations/repository.ts";
import type { RegistrationStatus } from "@/lib/types.ts";
import type { AppEnv } from "@/src/app/context.ts";
import { Hono } from "hono";

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

    const { rows } = await queryRegistrationRows(filters);
    const courseRevenueByCourseId = new Map<string, number>();
    for (const courseId of new Set(rows.map((row) => row.courseId))) {
      const registrations = await listRegistrationsByCourse(courseId);
      const totalRevenue = registrations.reduce((sum, registration) => {
        const amount = Number(registration.paymentAmountCents ?? 0);
        return sum +
          (registration.paymentStatus === "paid" && amount > 0 ? amount : 0);
      }, 0);
      courseRevenueByCourseId.set(courseId, totalRevenue);
    }

    const csvEscape = (value: string | number | null): string => {
      if (value === null) return "";
      const text = String(value);
      if (text.includes(",") || text.includes("\n") || text.includes('"')) {
        return `"${text.replaceAll('"', '""')}"`;
      }
      return text;
    };

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
    ];

    const body = rows.map((row) =>
      [
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
        courseRevenueByCourseId.get(row.courseId) ?? 0,
      ].map(csvEscape).join(",")
    );

    const csv = [header.join(","), ...body].join("\n");

    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header(
      "Content-Disposition",
      `attachment; filename=registrations-${
        new Date().toISOString().slice(0, 10)
      }.csv`,
    );
    return c.body(csv);
  },
);
