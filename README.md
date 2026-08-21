# TrustRed Courses

**Self-hostable course registration and approval software for fire departments,
public-safety organizations, aid organizations, municipalities, nonprofits, and
other noncommercial course providers.**

TrustRed Courses helps organizations publish courses, collect registrations,
review participants, manage approvals and waiting lists, communicate changes,
and export attendee information — without relying on spreadsheets, email chains,
or generic event platforms.

It provides the complete registration workflow in one application:

**Publish → Register → Confirm → Review → Approve → Communicate → Attend**

**Free for qualifying noncommercial use. Source-available. Self-hostable.**

[🌐 TrustRed by synit.io](https://www.synit.io/products/trustred) ·
[🐳 Docker Hub](https://hub.docker.com/r/synitio/trustred-courses) ·
[📖 Documentation](./docs/README.md) · [⚖️ License](./LICENSE.md)

---

## Why TrustRed Courses?

Training and qualification are an essential part of fire departments, emergency
services, civil protection, aid organizations, and many nonprofit organizations.

The administrative process behind them often looks much less modern.

Registrations arrive through:

- email
- spreadsheets
- paper forms
- shared mailboxes
- generic form builders
- multiple disconnected systems

Someone then has to manually determine:

- Who registered?
- Has the participant confirmed their registration?
- Who has been approved?
- Who is still waiting for a decision?
- Is the course already full?
- Who is on the waiting list?
- Were participants informed about changes?
- Has somebody cancelled?
- Who needs to receive a reminder?
- What happened to this registration and when?
- Who participated in which course?

TrustRed Courses was created to make this process easier.

Instead of building another generic event platform, the goal is to provide a
practical registration and approval workflow designed around the realities of
organizations where courses often require **internal review rather than simple
ticket booking**.

---

## Built from operational and volunteer experience

TrustRed is developed and maintained by
[synit.io](https://www.synit.io/products/trustred) with direct experience from
the volunteer fire service.

The project is built around practical requirements such as:

- simple public registration
- approval by responsible personnel
- waiting lists
- limited course capacity
- reliable participant communication
- reminders
- traceable decisions
- role-based administration
- exports for further processing
- low operational overhead
- self-hosting when required

**Von Feuerwehrkameraden für Feuerwehrkameraden.**

The same approach also makes TrustRed Courses suitable for many other
public-safety, municipal, community, charitable, and nonprofit organizations.

---

# Who is TrustRed Courses for?

TrustRed Courses is primarily designed for:

- 🚒 volunteer and professional fire departments
- 🚑 rescue and first-aid organizations
- 🛟 civil-protection and disaster-response organizations
- 🏥 aid organizations
- 🏛️ municipalities and public institutions
- 🎓 training organizations in the public-safety environment
- 🤝 charities and nonprofit organizations
- 👥 associations and community organizations

It can also be used by other organizations that need structured course
registration and approval workflows.

---

# What problem does it solve?

TrustRed Courses manages the process between publishing a course and having the
final participant list ready.

A typical workflow looks like this:

```text
Course published
      ↓
Participant registers
      ↓
Email address confirmed
      ↓
Registration enters review
      ↓
Approve / Reject / Waitlist
      ↓
Participant receives status
      ↓
Changes and reminders are communicated
      ↓
Final participant list / export
```

Every important registration action can be recorded in a central timeline.

This gives administrators a clear answer to:

> **What happened with this registration, who changed it, and what was
> communicated to the participant?**

---

# Participant experience

Participants do not need an account.

They can:

1. browse available courses
2. open the course details
3. submit a registration
4. optionally complete payment when the course requires it
5. confirm their email address using double opt-in
6. receive updates about their registration status
7. receive notifications when important course information changes
8. receive an optional reminder before the course starts

The public interface is designed to keep the process straightforward and
mobile-friendly.

---

# Administrator experience

Internal staff receive a dedicated administration interface for managing courses
and registrations.

Administrators can:

- create and edit courses
- define course capacity
- review registrations
- approve participants
- reject registrations
- place participants on a waiting list
- promote participants from the waiting list
- cancel registrations
- view course occupancy
- inspect attendee lists
- view registration history
- add internal notes
- review participant communication
- export registration data
- manage administrative users and permissions

The goal is to replace fragmented administrative workflows with one clear
process.

---

# Course management

Each course has its own administrative view.

Administrators can see:

- course information
- current status
- capacity
- occupancy
- registrations
- approved attendees
- waiting-list participants
- payment status when payments are enabled
- total course revenue for paid courses
- reminder configuration

Course pages use human-friendly URLs with German transliteration:

```text
ä → ae
ö → oe
ü → ue
ß → ss
```

---

# Registration workflow

TrustRed Courses supports structured registration states and actions.

Available administrative actions include:

```text
approve
reject
waitlist
promote
cancel
```

The public interface uses German-friendly status descriptions while the
application keeps stable English status values internally.

### Double opt-in

Public registrations use email confirmation by default.

This helps verify that:

- the supplied email address exists
- the participant controls the address
- accidental registrations are reduced

Administrators can still manually approve or reject an unconfirmed registration
where necessary.

When this happens:

- the appropriate participant notification is sent
- the old confirmation link becomes invalid
- the stored registration state remains authoritative

---

# Waiting lists

Courses with limited capacity can use a waiting-list workflow.

Registrations can be moved to:

```text
waitlist
```

and later promoted when a seat becomes available.

This allows organizations to keep registration management inside one system
rather than maintaining separate spreadsheets or email lists.

---

# Participant communication

Communication is tied to the actual registration state.

TrustRed Courses supports participant messages for events such as:

- email confirmation
- approval
- rejection
- waiting-list placement
- waiting-list promotion
- cancellation
- course cancellation
- important course changes
- upcoming course reminders

Email templates are constrained by the persisted registration state.

This prevents administrators from accidentally sending an approval email to a
rejected registration or another status message that does not match the actual
record.

---

# Course changes

Important course changes can automatically trigger attendee notifications.

Examples include changes to:

- course time
- location
- critical course information

If a course is cancelled, affected participants can be notified automatically.

This reduces the risk of outdated information remaining hidden in individual
email conversations.

---

# Course reminders

Courses can optionally configure a reminder for approved participants.

For example:

```text
Send reminder 3 days before course
```

Only the appropriate approved participants receive the reminder.

---

# Registration timeline & audit history

Each registration contains a unified timeline combining:

- registration events
- status transitions
- administrative actions
- participant communication
- internal notes
- audit history

This provides administrators with a central history instead of requiring them to
reconstruct decisions from multiple systems.

---

# Optional paid courses

TrustRed Courses can also support paid course registrations.

Payment support is optional.

When enabled, PayPal checkout and capture happen server-side before the
registration is finalized.

Administrators can then see:

- payment state per registration
- payment information in exports
- aggregated course revenue

Organizations that only offer free courses do not need to configure payment
functionality.

---

# Reporting & exports

Administrators can filter registrations and export them as CSV.

Exports can include information such as:

- participant details
- course
- registration status
- payment information
- course revenue where applicable

This makes it possible to continue working with the data in other administrative
systems when required.

---

# Role-based administration

Not every administrator requires the same permissions.

TrustRed Courses provides role-based access with the following roles:

```text
viewer
editor
approver
admin
super_admin
```

This makes it possible to separate responsibilities such as:

- viewing registrations
- editing courses
- approving participants
- managing users
- administering the complete application

---

# Secure administrator login

Administrators authenticate using magic links rather than traditional passwords.

The login process includes additional protections such as:

- expiring magic links
- secure sessions
- rate limiting
- failed-login tracking per originating IP
- configurable session lifetimes
- configurable security values

Production environments require email delivery for authentication.

---

# White-label by design

Every TrustRed Courses deployment represents one organization.

Organization-specific information can be configured using environment variables,
including:

- application name
- public URL
- legal information
- contact information
- email sender information
- branding-related configuration

This makes TrustRed Courses suitable for deploying separate branded instances
for different organizations.

---

# Use it standalone or embed it

TrustRed Courses can be used as a standalone course website or embedded into an
existing website.

Iframe embedding is supported.

When embedded, the interface automatically switches to a more compact layout.

The application can also emit resize events to the parent website so the iframe
can dynamically adapt to its content.

This makes TrustRed Courses useful alongside:

- an existing organizational website
- another CMS
- TrustRed CMS
- municipal portals
- association websites

without requiring the complete website to be migrated.

---

# At a glance

|                                  |                                                |
| -------------------------------- | ---------------------------------------------- |
| **Purpose**                      | Course registration and approval               |
| **Primary audience**             | Fire departments, public safety and nonprofits |
| **Deployment model**             | Single organization per instance               |
| **Participant account required** | No                                             |
| **Registration verification**    | Double opt-in                                  |
| **Internal approval**            | Yes                                            |
| **Waiting lists**                | Yes                                            |
| **Course reminders**             | Yes                                            |
| **Audit history**                | Yes                                            |
| **CSV exports**                  | Yes                                            |
| **Optional payments**            | PayPal                                         |
| **Authentication**               | Email magic links                              |
| **Role-based access**            | Yes                                            |
| **Embedding**                    | Iframe                                         |
| **Self-hosting**                 | Deno or Docker                                 |
| **Managed deployment**           | Available through synit.io                     |
| **License**                      | PolyForm Noncommercial 1.0.0                   |

---

# Self-host it or let us operate it

TrustRed Courses supports different deployment models depending on your
organization's requirements.

## 🐳 Self-hosted

Organizations can operate TrustRed Courses themselves.

This is a good fit when you:

- already operate your own infrastructure
- want control over your application and data
- have existing backup processes
- prefer container-based deployments
- have specific infrastructure or privacy requirements

TrustRed Courses can run directly using Deno or inside Docker.

See:

[Self-hosting deployment guide](./docs/SELF_HOSTING.md)

---

## ☁️ Managed TrustRed

Organizations that do not want to operate the infrastructure themselves can use
the managed TrustRed offering from
[synit.io](https://www.synit.io/products/trustred).

Managed operation can cover areas such as:

- deployment
- hosting
- updates
- backups
- technical operation
- support
- commercial licensing where required

This allows the organization to focus on course administration rather than
application operations.

➡️ **[Learn more about TrustRed](https://www.synit.io/products/trustred)**

---

# What TrustRed Courses is not

TrustRed Courses is primarily a **course registration, approval, and
participant-management system**.

It is not intended to replace a complete Learning Management System.

It currently focuses on:

- publishing courses
- registrations
- participant approval
- waiting lists
- communication
- reminders
- payment
- reporting

rather than:

- e-learning content
- video lessons
- online exams
- SCORM packages
- learning progress tracking
- digital certificates
- competency management

This distinction keeps the application focused on the administrative workflow
surrounding organizational training.

---

# Technical documentation

Implementation and operation details live in dedicated guides:

- [Architecture](./docs/ARCHITECTURE.md)
- [Development](./docs/DEVELOPMENT.md)
- [Self-hosting](./docs/SELF_HOSTING.md)
- [Environment reference](./.env.example)
- [Documentation index](./docs/README.md)

---

# License

Software Copyright © 2026 [synit.io](https://www.synit.io/).

TrustRed Courses is **source-available** and licensed under the:

**[PolyForm Noncommercial License 1.0.0](./LICENSE.md)**

Free use is permitted for noncommercial purposes covered by the license.

This makes TrustRed Courses suitable for many qualifying organizations such as:

- fire departments
- public-safety organizations
- aid organizations
- municipalities and government institutions
- charities
- nonprofit organizations
- community organizations

Commercial use requires a separate license from synit.io.

If you are unsure whether your intended deployment qualifies as noncommercial
use, contact:

**[synit.io / TrustRed](https://www.synit.io/products/trustred)**

---

# Maintainer & managed service

TrustRed Courses is developed and maintained by:

### [synit.io](https://www.synit.io/products/trustred)

synit.io provides:

- TrustRed development and maintenance
- managed hosting
- deployment assistance
- updates
- backups
- technical support
- commercial licensing

Product information and managed service:

**https://www.synit.io/products/trustred**

---

# ❤️ Built for people who organize training

Training administration should not require a collection of spreadsheets, shared
mailboxes, manually maintained participant lists, and disconnected forms.

TrustRed Courses aims to provide one straightforward workflow for:

**courses, registrations, approvals, waiting lists, communication, reminders,
and reporting.**

Built from experience in the volunteer fire service.
