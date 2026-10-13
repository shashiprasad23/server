import { request } from '@playwright/test';
import { env } from '../../config/env';

export interface MailSummary {
  ID: string;
  Subject: string;
  To: { Address: string }[];
  Cc: { Address: string }[];
  Bcc: { Address: string }[];
  Attachments: number;
}

export interface MailDetail extends Omit<MailSummary, 'Attachments'> {
  Text: string;
  HTML: string;
  Attachments: { PartID: string; FileName: string; ContentType: string }[];
}

/** Client for a Mailpit-compatible mail catcher (Mailpit, or the mock server's /mailpit endpoint). */
export class Mailbox {
  private async ctx() {
    return request.newContext({ baseURL: env.mailApiUrl.replace(/\/$/, '') + '/' });
  }

  async search(query: string): Promise<MailSummary[]> {
    const ctx = await this.ctx();
    try {
      const res = await ctx.get('api/v1/search', { params: { query } });
      if (!res.ok()) throw new Error(`Mail search failed: ${res.status()}`);
      return (await res.json()).messages ?? [];
    } finally {
      await ctx.dispose();
    }
  }

  async message(id: string): Promise<MailDetail> {
    const ctx = await this.ctx();
    try {
      const res = await ctx.get(`api/v1/message/${id}`);
      if (!res.ok()) throw new Error(`Mail fetch failed: ${res.status()}`);
      return await res.json();
    } finally {
      await ctx.dispose();
    }
  }

  async attachment(id: string, partId: string): Promise<Buffer> {
    const ctx = await this.ctx();
    try {
      const res = await ctx.get(`api/v1/message/${id}/part/${partId}`);
      return await res.body();
    } finally {
      await ctx.dispose();
    }
  }

  /** Polls until at least `count` messages match the query (email delivery is asynchronous). */
  async waitFor(query: string, count = 1, timeoutMs = 30_000): Promise<MailSummary[]> {
    const deadline = Date.now() + timeoutMs;
    let found: MailSummary[] = [];
    while (Date.now() < deadline) {
      found = await this.search(query);
      if (found.length >= count) return found;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`Expected ${count} email(s) for "${query}" within ${timeoutMs}ms, found ${found.length}`);
  }
}
