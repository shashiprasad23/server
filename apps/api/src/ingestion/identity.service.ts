import { Injectable } from '@nestjs/common';
import { Db, one } from '../db/db.service';
import { Principal } from '../common/principal';
import { RecordsService } from '../records/records.service';
import { CaptureRules, domainOf } from './capture-rules';
import { CustomerRef, Source } from './normalized-event';

export interface ResolvedIdentity {
  accountId: string | null;
  contactId: string | null;
  created: { account: boolean; contact: boolean };
}

const titleCase = (s: string) => s.replace(/(^|[-\s])(\w)/g, (_, p, c) => p + c.toUpperCase());

/** "nimbus-ai.com" -> "Nimbus Ai" as a placeholder name until enrichment fills the legal name. */
export const accountNameFromDomain = (domain: string) => titleCase(domain.split('.')[0].replace(/[-_]/g, ' '));

/**
 * FR-CH-02 / FR-CORE-05: one customer identity across the Marketplace, USP, email, Teams and
 * WhatsApp. Matches by email, then portal user IDs, then phone; companies by email domain
 * (personal domains never create an account).
 */
@Injectable()
export class IdentityService {
  constructor(private readonly records: RecordsService) {}

  async resolve(db: Db, p: Principal, rules: CaptureRules, ref: CustomerRef, source: Source): Promise<ResolvedIdentity> {
    const created = { account: false, contact: false };
    const email = ref.email?.toLowerCase();

    let contact =
      (email && (await one<{ id: string; account_id: string | null }>(db, 'SELECT id, account_id FROM contacts WHERE lower(email) = $1 AND deleted_at IS NULL', [email]))) ||
      (ref.marketplaceUserId &&
        (await one<{ id: string; account_id: string | null }>(db, 'SELECT id, account_id FROM contacts WHERE marketplace_user_id = $1 AND deleted_at IS NULL', [ref.marketplaceUserId]))) ||
      (ref.uspUserId &&
        (await one<{ id: string; account_id: string | null }>(db, 'SELECT id, account_id FROM contacts WHERE usp_user_id = $1 AND deleted_at IS NULL', [ref.uspUserId]))) ||
      (ref.phone &&
        (await one<{ id: string; account_id: string | null }>(
          db,
          "SELECT id, account_id FROM contacts WHERE regexp_replace(phone, '[^0-9]', '', 'g') = regexp_replace($1, '[^0-9]', '', 'g') AND deleted_at IS NULL",
          [ref.phone],
        ))) ||
      undefined;

    let accountId = contact?.account_id ?? null;
    const domain = domainOf(email);
    if (!accountId && domain && !rules.personal_domains.includes(domain)) {
      const acct = await one<{ id: string }>(db, 'SELECT id FROM accounts WHERE lower(domain) = $1 AND deleted_at IS NULL', [domain]);
      if (acct) accountId = acct.id;
      else {
        const a = await this.records.create(db, p, 'accounts', {
          name: ref.company || accountNameFromDomain(domain),
          domain,
          channel_first_seen: source,
        });
        accountId = a.id;
        created.account = true;
      }
    }

    if (contact) {
      // Link identifiers we learned from this channel, without overwriting what is there.
      const patch: Record<string, unknown> = {};
      const current = await this.records.getRaw(db, 'contacts', contact.id);
      if (current) {
        if (!current.account_id && accountId) patch.account_id = accountId;
        if (!current.marketplace_user_id && ref.marketplaceUserId) patch.marketplace_user_id = ref.marketplaceUserId;
        if (!current.usp_user_id && ref.uspUserId) patch.usp_user_id = ref.uspUserId;
        if (!current.name && ref.name) patch.name = ref.name;
        if (!current.phone && ref.phone) patch.phone = ref.phone;
        if (Object.keys(patch).length) await this.records.update(db, p, 'contacts', contact.id, patch);
      }
    } else if (email || ref.phone) {
      const c = await this.records.create(db, p, 'contacts', {
        account_id: accountId,
        name: ref.name ?? null,
        email: email ?? null,
        phone: ref.phone ?? null,
        marketplace_user_id: ref.marketplaceUserId ?? null,
        usp_user_id: ref.uspUserId ?? null,
      });
      contact = { id: c.id, account_id: accountId };
      created.contact = true;
    }
    return { accountId, contactId: contact?.id ?? null, created };
  }

  /** The most recently updated open opportunity for an account, for linking new activity. */
  async openOpportunity(db: Db, accountId: string | null): Promise<string | null> {
    if (!accountId) return null;
    const row = await one<{ id: string }>(
      db,
      `SELECT o.id FROM opportunities o JOIN pipeline_stages s ON s.key = o.stage_key
        WHERE o.account_id = $1 AND o.deleted_at IS NULL AND NOT s.is_closed ORDER BY o.updated_at DESC LIMIT 1`,
      [accountId],
    );
    return row?.id ?? null;
  }
}
