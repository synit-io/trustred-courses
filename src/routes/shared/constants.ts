export const LOG_PAGE_SIZE = 8;

export const statusClasses: Record<string, string> = {
  approved: "status-badge status-approved",
  pending_review: "status-badge status-pending",
  waitlisted: "status-badge status-waitlisted",
  rejected: "status-badge status-rejected",
  cancelled: "status-badge status-cancelled",
  submitted: "status-badge status-pending",
};

export const registrationStatusLabels: Record<string, string> = {
  approved: "Zugesagt",
  pending_review: "In Prüfung",
  waitlisted: "Warteliste",
  rejected: "Abgelehnt",
  cancelled: "Storniert",
  submitted: "E-Mail-Bestätigung ausstehend",
};

export const courseStatusLabels: Record<string, string> = {
  active: "Aktiv",
  draft: "Entwurf",
  archived: "Archiviert",
};

export function toRegistrationStatusLabel(status: string): string {
  return registrationStatusLabels[status] ?? status;
}

export function toCourseStatusLabel(status: string): string {
  return courseStatusLabels[status] ?? status;
}

export const registrationEmailEventLabels: Record<string, string> = {
  registration_received: "Anmeldung eingegangen",
  pending_review: "In Prüfung",
  waitlisted: "Warteliste",
  approved: "Zusage",
  rejected: "Abgelehnt",
  promoted: "Nachgerückt",
  cancelled: "Storniert",
};

export function toRegistrationEmailEventLabel(event: string): string {
  return registrationEmailEventLabels[event] ?? event;
}

export const registrationActionLabels: Record<string, string> = {
  approve: "Zusage erteilen",
  reject: "Ablehnen",
  waitlist: "Auf Warteliste setzen",
  promote: "Von Warteliste zusagen",
  cancel: "Stornieren",
};

export function toRegistrationActionLabel(action: string): string {
  return registrationActionLabels[action] ?? action;
}
