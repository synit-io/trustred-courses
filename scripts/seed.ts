import { upsertCourse } from "../lib/courses/repository.ts";
import { env } from "../lib/env.ts";
import { createUserFromEmail } from "../lib/users/repository.ts";
import type { Course } from "../lib/types.ts";

function courseDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

const courses: Course[] = [
  {
    id: "kurs-erste-hilfe-1",
    title: "Erste-Hilfe Grundlagen",
    description: "Grundkurs für Ersthelfer mit Fokus auf Notfallsituationen.",
    location: "Feuerwehrhaus Haschbach",
    startsAt: courseDaysFromNow(7),
    endsAt: courseDaysFromNow(7 + 0.25),
    registrationOpensAt: courseDaysFromNow(-2),
    registrationClosesAt: courseDaysFromNow(6.5),
    capacity: 20,
    pricingType: "free",
    feeAmountCents: null,
    feeCurrency: null,
    status: "active",
    waitingListEnabled: true,
    reminderDaysBefore: 2,
    createdAt: new Date().toISOString(),
  },
  {
    id: "kurs-funk-2",
    title: "Funk und Kommunikation",
    description: "Praxisorientierter Aufbaukurs für Einsatzkommunikation.",
    location: "Schulungszentrum Kusel",
    startsAt: courseDaysFromNow(14),
    endsAt: courseDaysFromNow(14 + 0.25),
    registrationOpensAt: courseDaysFromNow(-2),
    registrationClosesAt: courseDaysFromNow(13.5),
    capacity: 16,
    pricingType: "free",
    feeAmountCents: null,
    feeCurrency: null,
    status: "active",
    waitingListEnabled: true,
    reminderDaysBefore: 3,
    createdAt: new Date().toISOString(),
  },
];

async function main() {
  await createUserFromEmail(env.initialAdminEmail, "super_admin");

  for (const course of courses) {
    await upsertCourse(course);
  }

  console.log("Seed erfolgreich ausgefuhrt.");
  console.log(`Initialer Admin: ${env.initialAdminEmail}`);
  console.log(`Aktive Kurse: ${courses.length}`);
}

if (import.meta.main) {
  await main();
}
