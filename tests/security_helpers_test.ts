import { assertEquals } from "@std/assert";
import { redactQueryForLogs } from "../src/routes/shared/helpers.ts";

Deno.test("redactQueryForLogs redacts token-like state for payment callbacks", () => {
  const url = new URL(
    "http://localhost:8000/api/registrations/paypal/return?state=abc123&token=ord-1&foo=bar",
  );
  assertEquals(
    redactQueryForLogs(url),
    "?state=%5Bredacted%5D&token=%5Bredacted%5D&foo=bar",
  );
});
