import { assertStringIncludes } from "@std/assert";
import {
  renderCourseBroadcastTemplate,
  renderRegistrationTemplate,
} from "../lib/email/templates.ts";
import type { Course, Registration } from "../lib/types.ts";

function demoCourse(): Course {
  return {
    id: "course-mail",
    title: "Erste Hilfe Intensiv",
    description: "Praxisnaher Kurs",
    location: "Berlin-Mitte",
    startsAt: "2026-04-10T08:00:00.000Z",
    endsAt: "2026-04-10T16:00:00.000Z",
    registrationOpensAt: "2026-03-01T08:00:00.000Z",
    registrationClosesAt: "2026-04-05T18:00:00.000Z",
    capacity: 12,
    status: "active",
    waitingListEnabled: true,
    reminderDaysBefore: null,
    createdAt: "2026-03-01T08:00:00.000Z",
  };
}

function demoRegistration(): Registration {
  return {
    id: "reg-mail",
    courseId: "course-mail",
    firstName: "Max",
    lastName: "Mustermann",
    street: "Hauptstrasse",
    houseNumber: "10",
    postalCode: "10115",
    city: "Berlin",
    email: "max@example.org",
    phone: "+4912345",
    status: "approved",
    waitingListPosition: null,
    consentAccepted: true,
    submittedAt: "2026-03-10T10:00:00.000Z",
    doubleOptInRequestedAt: "2026-03-10T09:55:00.000Z",
    doubleOptInConfirmedAt: "2026-03-10T09:57:00.000Z",
    reviewedAt: "2026-03-10T11:00:00.000Z",
    reviewedBy: "admin-1",
    adminMessage: null,
    internalNotes: null,
  };
}

Deno.test("registration emails include branded layout and detailed course facts", () => {
  const template = renderRegistrationTemplate(
    "approved",
    demoRegistration(),
    demoCourse(),
  );

  assertStringIncludes(template.html, "background:#dc2626");
  assertStringIncludes(template.html, "Status: Bestätigt");
  assertStringIncludes(template.html, "Kursdetails");
  assertStringIncludes(template.html, "Anmeldung bis");
  assertStringIncludes(template.html, "Kursdetails ansehen");
  assertStringIncludes(template.text, "Status: Bestätigt");
  assertStringIncludes(template.text, "Kursdetails:");
  assertStringIncludes(template.text, "Anmeldung bis:");
});

Deno.test("course update emails include changed details and contact footer", () => {
  const template = renderCourseBroadcastTemplate(
    "course_critical_update",
    demoRegistration(),
    {
      ...demoCourse(),
      location: "Potsdam",
      startsAt: "2026-04-11T09:00:00.000Z",
    },
    {
      location: { before: "Berlin-Mitte", after: "Potsdam" },
      startsAt: {
        before: "2026-04-10T08:00:00.000Z",
        after: "2026-04-11T09:00:00.000Z",
      },
    },
  );

  assertStringIncludes(template.html, "Wichtige Kursänderung");
  assertStringIncludes(template.html, "Status: Aufmerksamkeit erforderlich");
  assertStringIncludes(template.html, "Berlin-Mitte -&gt; Potsdam");
  assertStringIncludes(template.html, "Kontakt:");
  assertStringIncludes(template.text, "Status: Aufmerksamkeit erforderlich");
  assertStringIncludes(template.text, "Wichtige Hinweise:");
  assertStringIncludes(template.text, "Ort: Berlin-Mitte -> Potsdam");
});
