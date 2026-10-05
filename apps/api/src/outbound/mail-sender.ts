import { Logger } from '@nestjs/common';

export interface OutboundMail {
  id: string;
  from?: string | null;
  to: string;
  subject: string | null;
  body: string;
}

/** Delivery port. The Outlook (Microsoft Graph) implementation sends from the rep's own mailbox (FR-CAP-11). */
export interface MailSender {
  readonly name: string;
  send(mail: OutboundMail): Promise<void>;
}

export const MAIL_SENDER = Symbol('MAIL_SENDER');

/** Default for dev and tests: records messages instead of sending them. */
export class RecordingMailSender implements MailSender {
  readonly name = 'recording';
  readonly sent: OutboundMail[] = [];
  private readonly log = new Logger('RecordingMailSender');

  async send(mail: OutboundMail): Promise<void> {
    this.sent.push(mail);
    this.log.log(`(not sent) to=${mail.to} subject=${mail.subject ?? ''}`);
  }
}

/**
 * Microsoft Graph sendMail with an app registration (client credentials, Mail.Send application
 * permission scoped by an Exchange application access policy to customer-facing mailboxes).
 */
export class GraphMailSender implements MailSender {
  readonly name = 'graph';
  private token?: { value: string; expiresAt: number };

  constructor(
    private readonly tenantId: string,
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly defaultMailbox: string,
  ) {}

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const res = await fetch(`https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      }),
    });
    if (!res.ok) throw new Error(`Graph token request failed: ${res.status}`);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
    return json.access_token;
  }

  async send(mail: OutboundMail): Promise<void> {
    const mailbox = mail.from || this.defaultMailbox;
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/sendMail`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await this.accessToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: {
          subject: mail.subject ?? '',
          body: { contentType: 'Text', content: mail.body },
          toRecipients: [{ emailAddress: { address: mail.to } }],
          internetMessageHeaders: [{ name: 'x-atlas-outbound-id', value: mail.id }],
        },
        saveToSentItems: true,
      }),
    });
    if (!res.ok) throw new Error(`Graph sendMail failed: ${res.status} ${await res.text()}`);
  }
}

export function mailSenderFromEnv(env: NodeJS.ProcessEnv = process.env): MailSender {
  const { GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, GRAPH_DEFAULT_MAILBOX } = env;
  if (GRAPH_TENANT_ID && GRAPH_CLIENT_ID && GRAPH_CLIENT_SECRET && GRAPH_DEFAULT_MAILBOX) {
    return new GraphMailSender(GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, GRAPH_DEFAULT_MAILBOX);
  }
  return new RecordingMailSender();
}
