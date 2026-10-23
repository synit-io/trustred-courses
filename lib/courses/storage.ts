import type { Course } from "../types.ts";

export const MAX_COURSE_STORAGE_BYTES = 24 * 1024;
const MAX_DERIVED_STORAGE_BYTES = 60 * 1024;

function assertSerializedSize(
  value: unknown,
  maximum: number,
  label: string,
): void {
  // Leave room below KV's 64 KiB value limit for its serialization envelope and
  // derived public fields. UTF-8 bytes also account for non-ASCII course text.
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > maximum) {
    throw new Error(
      `${label} ist zu groß. Bitte kürze die Kurstexte (maximal ${
        Math.floor(maximum / 1024)
      } KiB). Sehr lange bestehende Texte müssen gegebenenfalls vorab administrativ gekürzt werden.`,
    );
  }
}

export function assertCourseStorageSize(course: Course): void {
  const encoder = new TextEncoder();
  if (encoder.encode(course.title).byteLength > 1024) {
    throw new Error(
      "Der Kurstitel ist zu lang. Bitte kürze ihn auf maximal 1 KiB UTF-8.",
    );
  }
  if (encoder.encode(course.location).byteLength > 2 * 1024) {
    throw new Error(
      "Der Kursort ist zu lang. Bitte kürze ihn auf maximal 2 KiB UTF-8.",
    );
  }
  assertSerializedSize(course, MAX_COURSE_STORAGE_BYTES, "Der Kurs");
}

export function assertCourseNotificationTemplateSize(template: unknown): void {
  assertSerializedSize(template, 48 * 1024, "Die E-Mail-Vorlage");
}

export function assertCourseDerivedStorageSize(
  value: unknown,
  label: string,
): void {
  assertSerializedSize(value, MAX_DERIVED_STORAGE_BYTES, label);
}
