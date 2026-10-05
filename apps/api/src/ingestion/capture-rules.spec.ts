import { DEFAULT_SETTINGS } from '../metadata/metadata.service';
import { NormalizedEvent } from './normalized-event';
import { normalize } from './normalizers/normalizers';
import { captureSkipReason } from './capture-rules';

const rules = DEFAULT_SETTINGS['capture.rules'];
const mail = (from: string, to: string[], extra: Record<string, unknown> = {}) =>
  normalize('outlook', {
    kind: 'message',
    id: 'm1',
    mailbox: 'asha.rep@uvation.com',
    subject: 'hello',
    body: { contentType: 'html', content: '<p>Need 16 B200 GPUs</p>' },
    from: { emailAddress: { address: from } },
    toRecipients: to.map((a) => ({ emailAddress: { address: a } })),
    sentDateTime: '2026-10-05T10:00:00Z',
    ...extra,
  });

describe('capture privacy rules (FR-CAP-12)', () => {
  it('captures customer email and converts HTML to text', () => {
    const e = mail('cto@nimbus-ai.com', ['asha.rep@uvation.com']);
    expect(captureSkipReason(rules, e)).toBeNull();
    expect(e.communication?.body).toBe('Need 16 B200 GPUs');
  });

  it('skips internal-only, private and excluded-mailbox mail', () => {
    expect(captureSkipReason(rules, mail('marco.rep@uvation.com', ['asha.rep@uvation.com']))).toMatch(/internal_only/);
    expect(captureSkipReason(rules, mail('cto@nimbus-ai.com', ['asha.rep@uvation.com'], { sensitivity: 'private' }))).toMatch(/private/);
    expect(captureSkipReason(rules, mail('cto@nimbus-ai.com', ['hr@uvation.com'], { mailbox: 'hr@uvation.com' }))).toMatch(/excluded_mailbox/);
  });

  it('skips internal Teams chats', () => {
    const e: NormalizedEvent = normalize('teams', {
      kind: 'chat_message',
      id: 't1',
      chatType: 'internal',
      from: { email: 'asha.rep@uvation.com' },
      participants: [{ email: 'marco.rep@uvation.com' }],
      body: 'lunch?',
      createdDateTime: '2026-10-05T10:00:00Z',
    });
    expect(captureSkipReason(rules, e)).toMatch(/internal_only/);
  });
});
