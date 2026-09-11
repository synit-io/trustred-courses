import { publicHomeContent } from "@/lib/content/public_home_content.ts";
import { env } from "@/lib/env.ts";
import { getPublicHomeSnapshot } from "@/lib/public_snapshot/service.ts";
import type { AppEnv } from "@/src/app/context.ts";
import {
  formatCourseFee,
  registrationWindowState,
} from "@/src/routes/shared/helpers.ts";
import { Hono } from "hono";

export const homePage = new Hono<AppEnv>().get("/", async (c) => {
  const snapshot = await getPublicHomeSnapshot();
  const courses = snapshot.courses;
  const content = publicHomeContent;
  const nextCourse = courses
    .filter((course) => Date.parse(course.startsAt) >= Date.now())
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];

  return c.render(
    <div class="space-y-14">
      <section class="page-hero">
        <div class="grid gap-10 lg:grid-cols-[1.25fr_0.75fr] lg:items-center">
          <div>
            <p class="section-kicker">{content.intro.kicker}</p>
            <h1 class="max-w-3xl text-4xl sm:text-5xl lg:text-6xl">
              {content.intro.titlePrefix} {env.appName}
            </h1>
            <p class="text-body mt-5 max-w-2xl text-lg">
              {content.intro.description}
            </p>
            <div class="mt-7 flex flex-wrap gap-3">
              <a class="btn-primary" href={content.intro.primaryCtaHref}>
                {content.intro.primaryCtaLabel}
              </a>
              <a class="btn-secondary" href={`mailto:${env.legalEmail}`}>
                {content.intro.secondaryCtaLabel}
              </a>
            </div>
          </div>
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            <article class="site-card stat-card">
              <p class="stat-number">
                {courses.length > 0 ? courses.length : "-"}
              </p>
              <p class="stat-label">Aktive Kurse</p>
            </article>
            <article class="site-card stat-card">
              <p class="stat-number stat-number-sm">
                {nextCourse
                  ? new Date(nextCourse.startsAt).toLocaleDateString("de-DE")
                  : "Wird veröffentlicht"}
              </p>
              <p class="stat-label">Nächster Termin</p>
              <p class="text-body-muted mt-1 text-sm">
                {nextCourse ? nextCourse.location : "Neue Termine folgen"}
              </p>
            </article>
          </div>
        </div>
      </section>

      <section class="space-y-6" id="aktive-kurse">
        <div class="section-head">
          <p class="section-kicker">{content.coursesIntro.kicker}</p>
          <h2 class="text-3xl sm:text-4xl">{content.coursesIntro.title}</h2>
          <p class="text-body-muted mt-3 text-base">
            {content.coursesIntro.description}
          </p>
        </div>
        {courses.length === 0
          ? (
            <p class="callout-warning">
              {content.coursesIntro.emptyState}
            </p>
          )
          : null}
        <div class="grid gap-5 md:grid-cols-2">
          {courses.map((course) => {
            const regWindow = registrationWindowState(course);
            const seats = course.seats;
            const showFastLabel = regWindow.open && seats.lowCapacity;
            const showFullLabel = regWindow.open && seats.full;
            return (
              <article class="site-card course-card p-6" key={course.id}>
                <div class="course-card-body">
                  <div class="flex flex-wrap items-center gap-2">
                    <span
                      class={course.pricingType === "paid"
                        ? "status-badge status-brand"
                        : "status-badge"}
                    >
                      {course.pricingType === "paid"
                        ? formatCourseFee(
                          course.feeAmountCents,
                          course.feeCurrency,
                        )
                        : "Kostenfrei"}
                    </span>
                    <span class={regWindow.className}>{regWindow.label}</span>
                    {showFastLabel
                      ? (
                        <span class="status-badge status-pending">
                          Fast ausgebucht
                        </span>
                      )
                      : null}
                    {showFullLabel
                      ? (
                        <span class="status-badge status-rejected">
                          Ausgebucht
                        </span>
                      )
                      : null}
                  </div>
                  <h3 class="mt-4 text-2xl">{course.title}</h3>
                  <p class="course-meta mt-2">
                    {new Date(course.startsAt).toLocaleString("de-DE", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })} · {course.location}
                  </p>
                  <p class="text-body mt-3 text-sm">
                    {course.description}
                  </p>
                  <div class="mt-5 grid gap-2 sm:grid-cols-2">
                    {course.registrationClosesAt
                      ? (
                        <article class="fact-tile">
                          <p class="text-label">Anmeldung bis</p>
                          <p class="metric-value mt-1 text-sm font-semibold">
                            {new Date(course.registrationClosesAt)
                              .toLocaleString("de-DE", {
                                dateStyle: "medium",
                                timeStyle: "short",
                              })}
                          </p>
                        </article>
                      )
                      : null}
                    <article class="fact-tile">
                      <p class="text-label">Kapazität</p>
                      <p class="metric-value mt-1 text-sm font-semibold">
                        {seats.available} von {seats.total} Plätzen frei
                      </p>
                    </article>
                  </div>
                  {showFullLabel
                    ? (
                      <p class="callout-warning mt-4">
                        {course.waitingListEnabled
                          ? "Kurs ist ausgebucht. Eine Anmeldung für die Warteliste ist weiterhin möglich."
                          : "Kurs ist ausgebucht."}
                      </p>
                    )
                    : null}
                </div>
                <div class="mt-6 flex flex-wrap items-center gap-3">
                  {regWindow.open
                    ? (
                      <a class="btn-primary" href={`/courses/${course.id}`}>
                        {showFullLabel && course.waitingListEnabled
                          ? "Zur Warteliste"
                          : "Jetzt anmelden"}
                      </a>
                    )
                    : null}
                  <a class="btn-secondary" href={`/courses/${course.id}`}>
                    {regWindow.open ? "Details" : "Kurs ansehen"}
                  </a>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>,
  );
});
