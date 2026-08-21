import { assertEquals } from "@std/assert";
import {
  toCourseStatusLabel,
  toRegistrationEmailEventLabel,
  toRegistrationStatusLabel,
} from "../src/routes/shared/constants.ts";

Deno.test("maps registration status labels for frontend display", () => {
  assertEquals(toRegistrationStatusLabel("pending_review"), "In Prüfung");
  assertEquals(toRegistrationStatusLabel("waitlisted"), "Warteliste");
  assertEquals(toRegistrationStatusLabel("approved"), "Zugesagt");
  assertEquals(toRegistrationStatusLabel("rejected"), "Abgelehnt");
  assertEquals(toRegistrationStatusLabel("cancelled"), "Storniert");
  assertEquals(
    toRegistrationStatusLabel("submitted"),
    "E-Mail-Bestätigung ausstehend",
  );
});

Deno.test("maps course status labels for frontend display", () => {
  assertEquals(toCourseStatusLabel("active"), "Aktiv");
  assertEquals(toCourseStatusLabel("draft"), "Entwurf");
  assertEquals(toCourseStatusLabel("archived"), "Archiviert");
});

Deno.test("maps registration email events for frontend display", () => {
  assertEquals(
    toRegistrationEmailEventLabel("registration_received"),
    "Anmeldung eingegangen",
  );
  assertEquals(toRegistrationEmailEventLabel("pending_review"), "In Prüfung");
  assertEquals(toRegistrationEmailEventLabel("waitlisted"), "Warteliste");
  assertEquals(toRegistrationEmailEventLabel("approved"), "Zusage");
  assertEquals(toRegistrationEmailEventLabel("rejected"), "Abgelehnt");
  assertEquals(toRegistrationEmailEventLabel("promoted"), "Nachgerückt");
  assertEquals(toRegistrationEmailEventLabel("cancelled"), "Storniert");
});
