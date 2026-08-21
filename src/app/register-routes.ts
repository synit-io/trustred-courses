import type { Hono } from "hono";
import type { AppEnv } from "@/src/app/context.ts";

import { homePage } from "@/src/routes/(site)/home/page.tsx";
import { impressumPage } from "@/src/routes/(site)/legal/impressum/page.tsx";
import { datenschutzPage } from "@/src/routes/(site)/legal/datenschutz/page.tsx";
import { courseDetailsPage } from "@/src/routes/(site)/courses/[courseId]/page.tsx";
import { adminLoginPage } from "@/src/routes/(site)/auth/login/page.tsx";

import { adminDashboardPage } from "@/src/routes/admin/dashboard/page.tsx";
import { adminCoursesPage } from "@/src/routes/admin/courses/page.tsx";
import { adminCourseDetailPage } from "@/src/routes/admin/courses/[id]/page.tsx";
import { adminUsersPage } from "@/src/routes/admin/users/page.tsx";
import { adminRegistrationDetailPage } from "@/src/routes/admin/registrations/[id]/page.tsx";

import { healthRoute } from "@/src/routes/api/health/route.ts";
import { registrationCreateRoute } from "@/src/routes/api/registrations/create/route.ts";
import { registrationConfirmRoute } from "@/src/routes/api/registrations/confirm/route.ts";
import { registrationPayPalReturnRoute } from "@/src/routes/api/registrations/paypal/return/route.ts";
import { registrationPayPalCancelRoute } from "@/src/routes/api/registrations/paypal/cancel/route.ts";
import { magicLinkRequestRoute } from "@/src/routes/api/auth/magic-link/request/route.ts";
import { magicLinkVerifyRoute } from "@/src/routes/api/auth/magic-link/verify/route.ts";
import { logoutRoute } from "@/src/routes/api/auth/logout/route.ts";
import { adminUsersCreateRoute } from "@/src/routes/api/admin/users/create/route.ts";
import { adminUsersDeleteRoute } from "@/src/routes/api/admin/users/[id]/delete/route.ts";
import { adminCoursesCreateRoute } from "@/src/routes/api/admin/courses/create/route.ts";
import { adminCoursesUpdateRoute } from "@/src/routes/api/admin/courses/[id]/update/route.ts";
import { adminCoursesCloseRoute } from "@/src/routes/api/admin/courses/[id]/close/route.ts";
import { adminCoursesDeleteRoute } from "@/src/routes/api/admin/courses/[id]/delete/route.ts";
import { adminRegistrationsActionRoute } from "@/src/routes/api/admin/registrations/[id]/action/route.ts";
import { adminRegistrationsResendRoute } from "@/src/routes/api/admin/registrations/[id]/resend/route.ts";
import { adminRegistrationsExportRoute } from "@/src/routes/api/admin/exports/registrations/route.ts";

export function registerRoutes(app: Hono<AppEnv>) {
  app.route("/", homePage);
  app.route("/impressum", impressumPage);
  app.route("/datenschutz", datenschutzPage);
  app.route("/courses", courseDetailsPage);
  app.route("/admin", adminLoginPage);

  app.route("/admin", adminDashboardPage);
  app.route("/admin", adminCoursesPage);
  app.route("/admin", adminCourseDetailPage);
  app.route("/admin", adminUsersPage);
  app.route("/admin/registrations", adminRegistrationDetailPage);

  app.route("/api/health", healthRoute);
  app.route("/api/registrations/create", registrationCreateRoute);
  app.route("/api/registrations/confirm", registrationConfirmRoute);
  app.route("/api/registrations/paypal", registrationPayPalReturnRoute);
  app.route("/api/registrations/paypal", registrationPayPalCancelRoute);
  app.route("/api/auth/magic-link/request", magicLinkRequestRoute);
  app.route("/api/auth/magic-link/verify", magicLinkVerifyRoute);
  app.route("/api/auth/logout", logoutRoute);

  app.route("/api/admin/users/create", adminUsersCreateRoute);
  app.route("/api/admin/users", adminUsersDeleteRoute);
  app.route("/api/admin/courses", adminCoursesCreateRoute);
  app.route("/api/admin/courses", adminCoursesUpdateRoute);
  app.route("/api/admin/courses", adminCoursesCloseRoute);
  app.route("/api/admin/courses", adminCoursesDeleteRoute);
  app.route("/api/admin/registrations", adminRegistrationsActionRoute);
  app.route("/api/admin/registrations", adminRegistrationsResendRoute);
  app.route("/api/admin/exports", adminRegistrationsExportRoute);
}
