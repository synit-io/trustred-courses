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
    <div class="space-y-10">
      <section class="hero-surface">
        <div class="grid gap-5 lg:grid-cols-[1.2fr_0.8fr] lg:items-start">
          <div class="space-y-4">
            <span class="section-kicker">{content.intro.kicker}</span>
            <h1 class="text-3xl font-bold leading-tight sm:text-4xl">
              {content.intro.titlePrefix} {env.appName}
            </h1>
            <p class="text-body max-w-4xl text-base">
              {content.intro.description}
            </p>
            <div class="flex flex-wrap gap-3">
              <a
                class="btn-primary px-5 py-3 text-sm"
                href={content.intro.primaryCtaHref}
              >
                {content.intro.primaryCtaLabel}
              </a>
            </div>
          </div>
          <div class="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            <article class="fact-tile">
              <p class="text-label">Aktive Kurse</p>
              <p class="metric-value mt-2 text-xl font-semibold">
                {courses.length > 0 ? courses.length : "-"}
              </p>
            </article>
            <article class="fact-tile">
              <p class="text-label">Nächster Termin</p>
              <p class="metric-value mt-2 text-sm font-semibold">
                {nextCourse
                  ? new Date(nextCourse.startsAt).toLocaleDateString("de-DE")
                  : "Wird veröffentlicht"}
              </p>
              <p class="text-body-muted mt-1 text-sm">
                {nextCourse ? nextCourse.location : "Neue Termine folgen"}
              </p>
            </article>
          </div>
        </div>
      </section>

      <section class="space-y-3" id="aktive-kurse">
        <span class="section-kicker">{content.coursesIntro.kicker}</span>
        <h2 class="text-4xl font-bold">{content.coursesIntro.title}</h2>
        <p class="text-body-muted text-sm">
          {content.coursesIntro.description}
        </p>
      </section>
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
            <article class="site-card course-card p-5 pl-6" key={course.id}>
              <div class="flex items-center justify-between gap-2">
                <h3 class="text-2xl font-semibold">{course.title}</h3>
                <div class="flex items-center gap-2">
                  <span class="status-badge status-info">
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
              </div>
              <p class="text-body mt-3 text-sm">
                {course.description}
              </p>
              <div class="mt-4 grid gap-2 sm:grid-cols-2">
                <article class="fact-tile">
                  <p class="text-label">Ort</p>
                  <p class="metric-value mt-1 text-sm font-semibold">
                    {course.location}
                  </p>
                </article>
                <article class="fact-tile">
                  <p class="text-label">Beginn</p>
                  <p class="metric-value mt-1 text-sm font-semibold">
                    {new Date(course.startsAt).toLocaleString("de-DE")}
                  </p>
                </article>
                {course.registrationClosesAt
                  ? (
                    <article class="fact-tile">
                      <p class="text-label">Anmeldung bis</p>
                      <p class="metric-value mt-1 text-sm font-semibold">
                        {new Date(course.registrationClosesAt).toLocaleString(
                          "de-DE",
                        )}
                      </p>
                    </article>
                  )
                  : null}
                <article class="fact-tile">
                  <p class="text-label">Kapazität</p>
                  <p class="metric-value mt-1 text-sm font-semibold">
                    {seats.total} gesamt
                  </p>
                  <p class="text-body-muted mt-1 text-xs">
                    {seats.available} verfügbar
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
              <div class="mt-5 flex items-center gap-3">
                {regWindow.open
                  ? (
                    <a
                      class="btn-primary inline-block px-4 py-2 text-sm"
                      href={`/courses/${course.id}`}
                    >
                      {showFullLabel && course.waitingListEnabled
                        ? "Zur Warteliste"
                        : "Jetzt anmelden"}
                    </a>
                  )
                  : (
                    <a
                      class="btn-secondary inline-block px-4 py-2 text-sm"
                      href={`/courses/${course.id}`}
                    >
                      Kurs ansehen
                    </a>
                  )}
                <a
                  class="btn-tertiary inline-block px-1 py-2 text-sm"
                  href={`/courses/${course.id}`}
                >
                  Details
                </a>
              </div>
            </article>
          );
        })}
      </div>
    </div>,
  );
});
