import { env, isDemoMode } from "../env.ts";
import { listActiveCourses } from "../courses/repository.ts";
import { logger } from "../observability/logger.ts";
import type {
  Course,
  EmailLog,
  EmailOutboxJob,
  Registration,
} from "../types.ts";
import { listRegistrationsByCourse } from "../registrations/repository.ts";
import {
  appendEmailLog,
  claimDueEmailOutbox,
  deleteClaimedEmailOutbox,
  enqueueEmailOutbox,
  enqueueEmailOutboxOnce,
  markCourseReminderSent,
  updateClaimedEmailOutbox,
} from "./repository.ts";
import {
  type CourseBroadcastEvent,
  type CourseChangeDetails,
  escapeHtml,
  type RegistrationEmailEvent,
  renderCourseBroadcastTemplate,
  renderRegistrationDoubleOptInTemplate,
  renderRegistrationTemplate,
} from "./templates.ts";

export const EMAIL_OUTBOX_MAX_ATTEMPTS = 6;

export interface SendMailResult {
  ok: boolean;
  error?: string;
  /** True when DEMO_MODE swallowed the mail instead of sending it. */
  suppressed?: boolean;
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
      recipient: maskEmail(recipient),
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
      recipient: maskEmail(recipient),
      error: error instanceof Error ? error.name : "unknown",
    });
    return { ok: false, error: (error as Error).message };
  }
}

let emailSender: EmailSender = defaultSendMail;

/**
 * Single choke point for outgoing mail. In DEMO_MODE nothing leaves the
 * system, regardless of which sender is configured or injected.
 */
async function dispatchEmail(
  recipient: string,
  subject: string,
  text: string,
  html: string,
): Promise<SendMailResult> {
  if (isDemoMode()) {
    logger.info("email.suppressed_demo_mode", {
      recipient: maskEmail(recipient),
      subject,
    });
    return { ok: true, suppressed: true };
  }
  return await emailSender(recipient, subject, text, html);
}

function deliveryStatusFor(
  result: SendMailResult,
): EmailLog["deliveryStatus"] {
  if (result.suppressed) return "suppressed";
  return result.ok ? "sent" : "failed";
}

function maskEmail(value: string): string {
  const [local, domain] = value.split("@");
  if (!local || !domain) return "***";
  return `${local.slice(0, 2)}***@${domain}`;
}

export function renderAdminNotificationHtml(adminText: string): string {
  return `<p>${escapeHtml(adminText).replaceAll("\n", "<br/>")}</p>`;
}

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
    deliveryStatus: deliveryStatusFor(result),
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

export function createRegistrationEventOutboxJob(
  registration: Registration,
  course: Course,
  event: RegistrationEmailEvent,
  eventKey: string,
  customMessage?: string,
): EmailOutboxJob {
  const template = renderRegistrationTemplate(
    event,
    registration,
    course,
    customMessage,
  );
  return {
    id: crypto.randomUUID(),
    registrationId: registration.id,
    templateKey: event,
    recipientEmail: registration.email,
    subject: template.subject,
    text: template.text,
    html: template.html,
    attempt: 0,
    nextAttemptAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    lastError: null,
    eventKey,
    leaseOwner: null,
    leaseExpiresAt: null,
  };
}

export function createDoubleOptInOutboxJob(
  registration: Registration,
  course: Course,
  confirmationUrl: string,
): EmailOutboxJob {
  const template = renderRegistrationDoubleOptInTemplate(
    registration,
    course,
    confirmationUrl,
  );
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    registrationId: registration.id,
    templateKey: "double_opt_in_confirmation",
    recipientEmail: registration.email,
    subject: template.subject,
    text: template.text,
    html: template.html,
    attempt: 0,
    nextAttemptAt: now,
    createdAt: now,
    lastError: null,
    eventKey: `registration_doi:${registration.id}`,
    leaseOwner: null,
    leaseExpiresAt: null,
  };
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
  const recipientResult = await dispatchEmail(
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
      recipient: maskEmail(registration.email),
      error: "delivery_failed",
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

    const adminResult = await dispatchEmail(
      env.mailAdminNotificationTo,
      adminSubject,
      adminText,
      renderAdminNotificationHtml(adminText),
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
        renderAdminNotificationHtml(adminText),
        1,
        adminResult.error ?? "unknown",
      );
    }
  }
}

async function sendPreparedEmail(
  registrationId: string,
  templateKey: string,
  recipientEmail: string,
  template: { subject: string; text: string; html: string },
): Promise<void> {
  const result = await dispatchEmail(
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
      recipient: maskEmail(recipientEmail),
      error: "delivery_failed",
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
      const template = renderCourseBroadcastTemplate(
        "course_reminder",
        registration,
        course,
      );
      const eventKey = [
        "course_reminder",
        course.id,
        course.startsAt,
        course.reminderDaysBefore,
        registration.id,
      ].join(":");
      const job = await enqueueEmailOutboxOnce(eventKey, {
        registrationId: registration.id,
        templateKey: "course_reminder",
        recipientEmail: registration.email,
        subject: template.subject,
        text: template.text,
        html: template.html,
        attempt: 0,
        nextAttemptAt: now.toISOString(),
        lastError: null,
        leaseOwner: null,
        leaseExpiresAt: null,
      });
      if (job) {
        await markCourseReminderSent(
          registration.id,
          course.id,
          course.reminderDaysBefore!,
        );
        reminderCount += 1;
      }
    }
  }
  if (reminderCount > 0) {
    await processEmailOutboxBatch(reminderCount, now);
  }
  return reminderCount;
}

export async function processEmailOutboxBatch(
  limit = 20,
  now = new Date(),
): Promise<number> {
  const dueJobs = await claimDueEmailOutbox(limit, now);
  let processed = 0;

  for (const job of dueJobs.slice(0, limit)) {
    const result = await dispatchEmail(
      job.recipientEmail,
      job.subject,
      job.text,
      job.html,
    );

    await appendEmailLog({
      registrationId: job.registrationId,
      templateKey: job.attempt === 0
        ? job.templateKey
        : `${job.templateKey}_retry`,
      recipientEmail: job.recipientEmail,
      subject: job.subject,
      deliveryStatus: deliveryStatusFor(result),
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
      await deleteClaimedEmailOutbox(job);
    } else if (failedAttempt >= EMAIL_OUTBOX_MAX_ATTEMPTS) {
      logger.error("email.outbox_permanent_failure", {
        jobId: job.id,
        registrationId: job.registrationId,
        templateKey: job.templateKey,
        attempt: failedAttempt,
        error: "delivery_failed",
      });
      await deleteClaimedEmailOutbox(job);
    } else {
      logger.warn("email.outbox_retry_scheduled", {
        jobId: job.id,
        registrationId: job.registrationId,
        templateKey: job.templateKey,
        attempt: failedAttempt,
        error: "delivery_failed",
      });
      await updateClaimedEmailOutbox({
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
