export type UserRole =
  | "viewer"
  | "editor"
  | "approver"
  | "admin"
  | "super_admin";

export type RegistrationStatus =
  | "submitted"
  | "pending_review"
  | "waitlisted"
  | "approved"
  | "rejected"
  | "cancelled";

export interface User {
  id: string;
  email: string;
  emailNormalized: string;
  role: UserRole;
  authVersion: number;
  active: boolean;
  createdAt: string;
}

export interface Course {
  id: string;
  title: string;
  description: string;
  location: string;
  startsAt: string;
  endsAt: string;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  capacity: number;
  pricingType?: "free" | "paid";
  feeAmountCents?: number | null;
  feeCurrency?: string | null;
  status: "active" | "draft" | "archived";
  waitingListEnabled: boolean;
  reminderDaysBefore: number | null;
  createdAt: string;
}

export interface Registration {
  id: string;
  courseId: string;
  firstName: string;
  lastName: string;
  street: string;
  houseNumber: string;
  postalCode: string;
  city: string;
  email: string;
  phone: string;
  status: RegistrationStatus;
  waitingListPosition: number | null;
  consentAccepted: boolean;
  submittedAt: string;
  doubleOptInRequestedAt: string;
  doubleOptInConfirmedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  adminMessage: string | null;
  internalNotes: string | null;
  paymentStatus?: "not_required" | "paid";
  paymentProvider?: "paypal" | null;
  paymentCaptureId?: string | null;
  paymentAmountCents?: number | null;
  paymentCurrency?: string | null;
  paymentPaidAt?: string | null;
}

export interface RegistrationDoubleOptInToken {
  registrationId: string;
  courseId: string;
  emailNormalized: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
}

export interface EmailLog {
  id: string;
  registrationId: string;
  templateKey: string;
  recipientEmail: string;
  subject: string;
  deliveryStatus: "queued" | "sent" | "failed";
  sentAt: string;
  errorMessage: string | null;
  attempt: number;
}

export interface AuditLog {
  id: string;
  actorUserId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
}

export interface MagicLinkRecord {
  userId: string;
  emailNormalized: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  redirectTo: string;
  issuedFromIp?: string | null;
  issuedUserAgentHash?: string | null;
  bindingHash?: string | null;
}

export interface SessionRecord {
  userId: string;
  userEmail: string;
  role: UserRole;
  authVersion: number;
  createdAt: string;
  lastSeenAt: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
  revokedAt: string | null;
}

export interface EmailOutboxJob {
  id: string;
  registrationId: string;
  templateKey: string;
  recipientEmail: string;
  subject: string;
  text: string;
  html: string;
  attempt: number;
  nextAttemptAt: string;
  createdAt: string;
  lastError: string | null;
}
