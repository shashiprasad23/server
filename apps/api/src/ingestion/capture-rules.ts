import type { SettingsMap } from '../metadata/metadata.service';
import type { NormalizedEvent, Participant } from './normalized-event';

export type CaptureRules = SettingsMap['capture.rules'];

export const domainOf = (email?: string) => email?.split('@')[1]?.toLowerCase();

export function isInternal(rules: CaptureRules, email?: string): boolean {
  const d = domainOf(email);
  return !!d && rules.internal_domains.includes(d);
}

export function externalParticipants(rules: CaptureRules, participants: Participant[]): Participant[] {
  return participants.filter((p) => (p.email ? !isInternal(rules, p.email) : !!p.phone));
}

/**
 * FR-CAP-12 privacy rules. Returns a skip reason, or null when the communication may be captured.
 * Internal-only threads, private items, excluded mailboxes (HR, legal, finance) and deny-listed
 * domains are never written to the CRM.
 */
export function captureSkipReason(rules: CaptureRules, event: NormalizedEvent): string | null {
  const c = event.communication;
  if (!c) return null;
  if (c.private) return 'private: marked private or personal by the sender';
  if (c.mailbox && rules.excluded_mailboxes.map((m) => m.toLowerCase()).includes(c.mailbox)) {
    return `excluded_mailbox: ${c.mailbox} is never connected`;
  }
  if (c.internalOnly) return 'internal_only: internal Teams chat';
  const externals = externalParticipants(rules, c.participants);
  if (!externals.length) return 'internal_only: no external participants';
  const denied = externals.find((p) => p.email && rules.deny_domains.includes(domainOf(p.email)!));
  if (denied) return `deny_domain: ${domainOf(denied.email)}`;
  return null;
}
