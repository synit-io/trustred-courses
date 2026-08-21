import { env } from "../env.ts";
import { listActiveCourses } from "../courses/repository.ts";
import { logger } from "../observability/logger.ts";
import type { Course, Registration } from "../types.ts";
import { listRegistrationsByCourse } from "../registrations/repository.ts";
import {
  appendEmailLog,
  deleteEmailOutbox,
  enqueueEmailOutbox,
  hasCourseReminderBeenSent,
  listDueEmailOutbox,
  markCourseReminderSent,
  updateEmailOutbox,
} from "./repository.ts";
import {
  type CourseBroadcastEvent,
  type CourseChangeDetails,
  type RegistrationEmailEvent,
  renderCourseBroadcastTemplate,
  renderRegistrationDoubleOptInTemplate,
  renderRegistrationTemplate,
} from "./templates.ts";

export const EMAIL_OUTBOX_MAX_ATTEMPTS = 6;

export interface SendMailResult {
  ok: boolean;
  error?: string;
}

export type EmailSender = (
  recipient: string,
  subject: string,
  text: string,
  html: string,
) => Promise<SendMailResult>;

function hasSmtpConfig(): boolean {
  return Boolean(
    env.smtpHost && env.smtpUser && env.smtpPass && env.mailFromAddress,
  );
}

async function defaultSendMail(
  recipient: string,
  subject: string,
  text: string,
  html: string,
): Promise<SendMailResult> {
  if (!hasSmtpConfig()) {
    logger.error("email.smtp_not_configured", {
      recipient,
      subject,
    });
    return { ok: false, error: "SMTP nicht konfiguriert" };
  }

  const { default: nodemailer } = await import("nodemailer");

  const transporter = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,
    auth: {
      user: env.smtpUser,
      pass: env.smtpPass,
    },
  });

  try {
    await transporter.sendMail({
      from: `${env.mailFromName} <${env.mailFromAddress}>`,
      to: recipient,
      subject,
      text,
      html,
    });
    return { ok: true };
  } catch (error) {
    logger.error("email.smtp_send_failed", {
      recipient,
      subject,
      error,
    });
    return { ok: false, error: (error as Error).message };
  }
}

let emailSender: EmailSender = defaultSendMail;

export function __setEmailSenderForTests(sender: EmailSender | null): void {
  emailSender = sender ?? defaultSendMail;
}

function nextRetryAt(attempt: number): string {
  const minutes = Math.min(720, Math.max(2, 2 ** attempt));
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

async function logDelivery(
  registrationId: string,
  templateKey: string,
  recipientEmail: string,
  subject: string,
  result: SendMailResult,
): Promise<void> {
  await appendEmailLog({
    registrationId,
    templateKey,
    recipientEmail,
    subject,
    deliveryStatus: result.ok ? "sent" : "failed",
    errorMessage: result.ok ? null : result.error ?? "unknown",
  });
}

async function queueEmailRetry(
  registrationId: string,
  templateKey: string,
  recipientEmail: string,
  subject: string,
  text: string,
  html: string,
  attempt: number,
  error: string,
): Promise<void> {
  await enqueueEmailOutbox({
    registrationId,
    templateKey,
    recipientEmail,
    subject,
    text,
    html,
    attempt,
    nextAttemptAt: nextRetryAt(attempt),
    lastError: error,
  });
}

function toRegistrationEvent(
  event: RegistrationEmailEvent | Registration["status"],
): RegistrationEmailEvent {
  return event === "pending_review"
    ? "pending_review"
    : event === "waitlisted"
    ? "waitlisted"
    : event === "approved"
    ? "approved"
    : event === "rejected"
    ? "rejected"
    : event === "cancelled"
    ? "cancelled"
    : event === "registration_received"
    ? "registration_received"
    : event === "promoted"
    ? "promoted"
    : "pending_review";
}

export async function sendRegistrationEventEmails(
  registration: Registration,
  course: Course,
  event: RegistrationEmailEvent | Registration["status"],
  customMessage?: string,
): Promise<void> {
  const mappedEvent = toRegistrationEvent(event);
  if (mappedEvent === "pending_review") {
    return;
  }

  const template = renderRegistrationTemplate(
    mappedEvent,
    registration,
    course,
    customMessage,
  );
  const recipientResult = await emailSender(
    registration.email,
    template.subject,
    template.text,
    template.html,
  );

  await logDelivery(
    registration.id,
    mappedEvent,
    registration.email,
    template.subject,
    recipientResult,
  );
  if (!recipientResult.ok) {
    logger.warn("email.delivery_failed_initial", {
      registrationId: registration.id,
      templateKey: mappedEvent,
      recipient: registration.email,
      error: recipientResult.error ?? "unknown",
    });
    if (EMAIL_OUTBOX_MAX_ATTEMPTS > 1) {
      await queueEmailRetry(
        registration.id,
        mappedEvent,
        registration.email,
        template.subject,
        template.text,
        template.html,
        1,
        recipientResult.error ?? "unknown",
      );
    }
  }

  if (mappedEvent === "registration_received" && env.mailAdminNotificationTo) {
    const adminSubject =
      `Neue Anmeldung: ${registration.firstName} ${registration.lastName}`;
    const adminText = [
      `Neue Anmeldung für ${course.title}`,
      `Name: ${registration.firstName} ${registration.lastName}`,
      `E-Mail: ${registration.email}`,
      `Status: ${registration.status}`,
    ].join("\n");

    const adminResult = await emailSender(
      env.mailAdminNotificationTo,
      adminSubject,
      adminText,
      `<p>${adminText.replaceAll("\n", "<br/>")}</p>`,
    );

    await logDelivery(
      registration.id,
      "admin_new_registration",
      env.mailAdminNotificationTo,
      adminSubject,
      adminResult,
    );
    if (!adminResult.ok && EMAIL_OUTBOX_MAX_ATTEMPTS > 1) {
      await queueEmailRetry(
        registration.id,
        "admin_new_registration",
        env.mailAdminNotificationTo,
        adminSubject,
        adminText,
        `<p>${adminText.replaceAll("\n", "<br/>")}</p>`,
        1,
        adminResult.error ?? "unknown",
      );
    }
  }
}

export async function sendRegistrationDoubleOptInEmail(
  registration: Registration,
  course: Course,
  confirmUrl: string,
): Promise<void> {
  const template = renderRegistrationDoubleOptInTemplate(
    registration,
    course,
    confirmUrl,
  );

  const recipientResult = await emailSender(
    registration.email,
    template.subject,
    template.text,
    template.html,
  );

  await logDelivery(
    registration.id,
    "double_opt_in_confirmation",
    registration.email,
    template.subject,
    recipientResult,
  );

  if (!recipientResult.ok && EMAIL_OUTBOX_MAX_ATTEMPTS > 1) {
    await queueEmailRetry(
      registration.id,
      "double_opt_in_confirmation",
      registration.email,
      template.subject,
      template.text,
      template.html,
      1,
      recipientResult.error ?? "unknown",
    );
  }
}

async function sendPreparedEmail(
  registrationId: string,
  templateKey: string,
  recipientEmail: string,
  template: { subject: string; text: string; html: string },
): Promise<void> {
  const result = await emailSender(
    recipientEmail,
    template.subject,
    template.text,
    template.html,
  );

  await logDelivery(
    registrationId,
    templateKey,
    recipientEmail,
    template.subject,
    result,
  );

  if (!result.ok) {
    logger.warn("email.delivery_failed_initial", {
      registrationId,
      templateKey,
      recipient: recipientEmail,
      error: result.error ?? "unknown",
    });
    if (EMAIL_OUTBOX_MAX_ATTEMPTS > 1) {
      await queueEmailRetry(
        registrationId,
        templateKey,
        recipientEmail,
        template.subject,
        template.text,
        template.html,
        1,
        result.error ?? "unknown",
      );
    }
  }
}

export async function sendCourseBroadcastEmails(
  registrations: Registration[],
  course: Course,
  event: CourseBroadcastEvent,
  changes?: CourseChangeDetails,
): Promise<number> {
  const recipients = registrations.filter((registration) =>
    registration.status === "approved"
  );

  for (const registration of recipients) {
    const template = renderCourseBroadcastTemplate(
      event,
      registration,
      course,
      changes,
    );
    await sendPreparedEmail(
      registration.id,
      event,
      registration.email,
      template,
    );
  }

  return recipients.length;
}

function berlinDateKey(value: Date): string {
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function shouldSendReminder(course: Course, now: Date): boolean {
  if (!course.reminderDaysBefore || course.reminderDaysBefore < 1) return false;
  const startsAt = new Date(course.startsAt);
  if (Number.isNaN(startsAt.getTime())) return false;

  const reminderDate = new Date(
    startsAt.getTime() - course.reminderDaysBefore * 24 * 60 * 60 * 1000,
  );
  return berlinDateKey(reminderDate) === berlinDateKey(now);
}

export async function processCourseReminders(
  now = new Date(),
): Promise<number> {
  const courses = await listActiveCourses();
  let reminderCount = 0;

  for (const course of courses) {
    if (!shouldSendReminder(course, now)) continue;

    const registrations = await listRegistrationsByCourse(course.id);
    const recipients = registrations.filter((registration) =>
      registration.status === "approved"
    );

    for (const registration of recipients) {
      const alreadySent = await hasCourseReminderBeenSent(
        registration.id,
        course.id,
        course.reminderDaysBefore!,
      );
      if (alreadySent) continue;

      await markCourseReminderSent(
        registration.id,
        course.id,
        course.reminderDaysBefore!,
      );
      const template = renderCourseBroadcastTemplate(
        "course_reminder",
        registration,
        course,
      );
      await sendPreparedEmail(
        registration.id,
        "course_reminder",
        registration.email,
        template,
      );
      reminderCount += 1;
    }
  }

  return reminderCount;
}

export async function processEmailOutboxBatch(
  limit = 20,
  now = new Date(),
): Promise<number> {
  const dueJobs = await listDueEmailOutbox(now);
  let processed = 0;

  for (const job of dueJobs.slice(0, limit)) {
    const result = await emailSender(
      job.recipientEmail,
      job.subject,
      job.text,
      job.html,
    );

    await appendEmailLog({
      registrationId: job.registrationId,
      templateKey: `${job.templateKey}_retry`,
      recipientEmail: job.recipientEmail,
      subject: job.subject,
      deliveryStatus: result.ok ? "sent" : "failed",
      errorMessage: result.ok ? null : result.error ?? "unknown",
      attempt: job.attempt + 1,
    });

    const failedAttempt = job.attempt + 1;
    if (result.ok) {
      logger.info("email.outbox_delivered", {
        jobId: job.id,
        registrationId: job.registrationId,
        templateKey: job.templateKey,
        attempt: failedAttempt,
      });
      await deleteEmailOutbox(job.id);
    } else if (failedAttempt >= EMAIL_OUTBOX_MAX_ATTEMPTS) {
      logger.error("email.outbox_permanent_failure", {
        jobId: job.id,
        registrationId: job.registrationId,
        templateKey: job.templateKey,
        attempt: failedAttempt,
        error: result.error ?? "unknown",
      });
      await deleteEmailOutbox(job.id);
    } else {
      logger.warn("email.outbox_retry_scheduled", {
        jobId: job.id,
        registrationId: job.registrationId,
        templateKey: job.templateKey,
        attempt: failedAttempt,
        error: result.error ?? "unknown",
      });
      await updateEmailOutbox({
        ...job,
        attempt: failedAttempt,
        nextAttemptAt: nextRetryAt(failedAttempt),
        lastError: result.error ?? "unknown",
      });
    }

    processed += 1;
  }

  return processed;
}
