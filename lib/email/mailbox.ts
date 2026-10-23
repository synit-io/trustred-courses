/** The application accepts one plain ASCII mailbox, without display names or comments. */
export function parseMailbox(value: string): string | null {
  const mailbox = value.trim().toLowerCase();
  if (mailbox.length > 254) return null;
  const parts = mailbox.split("@");
  if (parts.length !== 2) return null;
  const [local, domain] = parts;
  if (
    !local || local.length > 64 || !domain || domain.length > 253 ||
    !/^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/.test(
      local,
    )
  ) return null;
  const labels = domain.split(".");
  if (
    labels.length < 2 || labels.some((label) =>
      label.length > 63 ||
      !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
    )
  ) return null;
  return mailbox;
}
