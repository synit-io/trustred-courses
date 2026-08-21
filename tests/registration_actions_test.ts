import { assertEquals } from "@std/assert";
import {
  allowedEmailEventsForRegistrationStatus,
  availableRegistrationActions,
  isActionAllowed,
  type RegistrationAction,
} from "../lib/registrations/service.ts";
import type { RegistrationStatus } from "../lib/types.ts";

const actions: RegistrationAction[] = [
  "approve",
  "reject",
  "waitlist",
  "promote",
  "cancel",
];

Deno.test("transition matrix allows expected registration actions", () => {
  const matrix: Record<RegistrationStatus, RegistrationAction[]> = {
    submitted: ["approve", "reject"],
    pending_review: ["approve", "reject", "waitlist", "cancel"],
    waitlisted: ["promote", "reject", "cancel"],
    approved: ["waitlist", "cancel"],
    rejected: [],
    cancelled: [],
  };

  (Object.keys(matrix) as RegistrationStatus[]).forEach((status) => {
    actions.forEach((action) => {
      assertEquals(
        isActionAllowed(status, action),
        matrix[status].includes(action),
        `${status} -> ${action}`,
      );
    });
  });
});

Deno.test("available registration actions follow the transition matrix", () => {
  assertEquals(availableRegistrationActions("submitted"), [
    "approve",
    "reject",
  ]);
  assertEquals(availableRegistrationActions("pending_review"), [
    "approve",
    "reject",
    "waitlist",
    "cancel",
  ]);
  assertEquals(availableRegistrationActions("waitlisted"), [
    "promote",
    "reject",
    "cancel",
  ]);
  assertEquals(availableRegistrationActions("approved"), [
    "waitlist",
    "cancel",
  ]);
  assertEquals(availableRegistrationActions("rejected"), []);
  assertEquals(availableRegistrationActions("cancelled"), []);
});

Deno.test("allowed resend events are derived from persisted registration status", () => {
  assertEquals(allowedEmailEventsForRegistrationStatus("submitted"), []);
  assertEquals(allowedEmailEventsForRegistrationStatus("pending_review"), [
    "registration_received",
  ]);
  assertEquals(allowedEmailEventsForRegistrationStatus("waitlisted"), [
    "waitlisted",
  ]);
  assertEquals(allowedEmailEventsForRegistrationStatus("approved"), [
    "approved",
  ]);
  assertEquals(allowedEmailEventsForRegistrationStatus("rejected"), [
    "rejected",
  ]);
  assertEquals(allowedEmailEventsForRegistrationStatus("cancelled"), [
    "cancelled",
  ]);
});
