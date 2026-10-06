import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Db, many, one } from '../db/db.service';
import { badRequest, notFound } from '../common/errors';
import { validate } from '../common/validate';
import { OBJECTS, recordType } from '../records/record-types';
import { isForbiddenKey } from '../records/transaction-guardrail';

export interface FieldDefinition {
  id: string;
  object: string;
  key: string;
  label: string;
  type: 'text' | 'number' | 'boolean' | 'date' | 'enum' | 'json';
  options: string[];
  required: boolean;
  restricted: boolean;
}

export interface PipelineStage {
  key: string;
  label: string;
  position: number;
  is_closed: boolean;
  is_won: boolean;
  entry_rules: string[];
}

export const fieldDefinitionInput = z.object({
  object: z.enum(OBJECTS),
  key: z
    .string()
    .regex(/^[a-z][a-z0-9_]{1,62}$/, 'lower snake_case, 2-63 chars'),
  label: z.string().min(1).max(120),
  type: z.enum(['text', 'number', 'boolean', 'date', 'enum', 'json']),
  options: z.array(z.string()).default([]),
  required: z.boolean().default(false),
  restricted: z.boolean().default(false),
});

export interface SettingsMap {
  'capture.rules': {
    internal_domains: string[];
    personal_domains: string[];
    excluded_mailboxes: string[];
    lead_mailboxes: string[];
    deny_domains: string[];
  };
  'routing.rules': {
    assisted_min_gpu_count: number;
    assisted_min_value: number;
    named_account_domains: string[];
    rep_pool: string[];
  };
  'agents.defaults': { confidence_threshold: number; approval_ttl_hours: number };
  'approval.matrix': {
    /** Discount a rep may give without approval, in percent. */
    rep_max_discount_pct: number;
    /** Above this discount a sales leader must approve; between the two, deal desk. */
    deal_desk_max_discount_pct: number;
    margin_floor_pct: number;
    large_deal_value: number;
    non_standard_payment_terms: string[];
  };
  'cpq.defaults': {
    quote_validity_days: number;
    hold_days: number;
    revalidation_price_pct: number;
    revalidation_lead_time_weeks: number;
    default_freight_pct: number;
  };
  'compliance.rules': {
    /** Destinations where shipping controlled items needs a licence decision (confirm with Trade Compliance). */
    licence_review_countries: string[];
    embargoed_countries: string[];
    controlled_classes: string[];
    red_flag_phrases: string[];
  };
}

/** Known tenant settings with their defaults. Stored as JSON so they change without a deploy. */
export const DEFAULT_SETTINGS: SettingsMap = {
  'capture.rules': {
    internal_domains: ['uvation.com'],
    personal_domains: ['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'proton.me'],
    excluded_mailboxes: ['hr@uvation.com', 'legal@uvation.com', 'finance@uvation.com', 'payroll@uvation.com'],
    // Shared mailboxes whose new external threads become leads (FR-CAP-03).
    lead_mailboxes: ['sales@uvation.com', 'rfp@uvation.com'],
    deny_domains: [],
  },
  'routing.rules': {
    // Deals above these thresholds, or from named accounts, get a rep (FR-CH-04).
    assisted_min_gpu_count: 16,
    assisted_min_value: 250000,
    named_account_domains: [],
    rep_pool: [],
  },
  'agents.defaults': {
    confidence_threshold: 0.75,
    approval_ttl_hours: 48,
  },
  'approval.matrix': {
    rep_max_discount_pct: 5,
    deal_desk_max_discount_pct: 15,
    margin_floor_pct: 8,
    large_deal_value: 1000000,
    non_standard_payment_terms: ['Net 60', 'Net 90', 'Milestone billing'],
  },
  'cpq.defaults': {
    quote_validity_days: 14,
    hold_days: 7,
    revalidation_price_pct: 3,
    revalidation_lead_time_weeks: 2,
    default_freight_pct: 1.5,
  },
  // Illustrative defaults only: Trade Compliance owns and must confirm these lists.
  'compliance.rules': {
    licence_review_countries: ['China', 'Hong Kong', 'Macau', 'Russia', 'Belarus', 'Venezuela'],
    embargoed_countries: ['Iran', 'North Korea', 'Syria', 'Cuba'],
    controlled_classes: ['3A090', '4A090', '5A992'],
    red_flag_phrases: [
      're-export',
      'reexport',
      'transship',
      'end user is confidential',
      'cannot disclose the end user',
      "can't disclose the end user",
      'military',
      'weapons',
      'ship to a different country',
      'freight forwarder will handle',
      'avoid export',
    ],
  },
};
export type SettingKey = keyof SettingsMap;

@Injectable()
export class MetadataService {
  async fieldDefinitions(db: Db, object?: string): Promise<FieldDefinition[]> {
    return many<FieldDefinition>(
      db,
      `SELECT id, object, key, label, type, options, required, restricted FROM field_definitions
        WHERE ($1::text IS NULL OR object = $1) ORDER BY object, key`,
      [object ?? null],
    );
  }

  async createFieldDefinition(db: Db, tenantId: string, input: unknown): Promise<FieldDefinition> {
    const def = validate(fieldDefinitionInput, input);
    if (isForbiddenKey(def.key)) {
      throw badRequest('transaction_data_rejected', `"${def.key}" looks like sales transaction data, which belongs in NetSuite`);
    }
    if (recordType(def.object)!.fields[def.key]) {
      throw badRequest('field_exists', `"${def.key}" is already a core field on ${def.object}`);
    }
    if (def.type === 'enum' && def.options.length === 0) throw badRequest('enum_options_required', 'Enum fields need options');
    const row = await one<FieldDefinition>(
      db,
      `INSERT INTO field_definitions (tenant_id, object, key, label, type, options, required, restricted)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (tenant_id, object, key) DO NOTHING
       RETURNING id, object, key, label, type, options, required, restricted`,
      [tenantId, def.object, def.key, def.label, def.type, JSON.stringify(def.options), def.required, def.restricted],
    );
    if (!row) throw badRequest('field_exists', `Custom field "${def.key}" already exists on ${def.object}`);
    return row;
  }

  async stages(db: Db): Promise<PipelineStage[]> {
    return many<PipelineStage>(
      db,
      'SELECT key, label, position, is_closed, is_won, entry_rules FROM pipeline_stages ORDER BY position',
    );
  }

  async stage(db: Db, key: string): Promise<PipelineStage> {
    const s = await one<PipelineStage>(
      db,
      'SELECT key, label, position, is_closed, is_won, entry_rules FROM pipeline_stages WHERE key = $1',
      [key],
    );
    if (!s) throw badRequest('unknown_stage', `Unknown pipeline stage "${key}"`);
    return s;
  }

  async setting<K extends SettingKey>(db: Db, key: K): Promise<SettingsMap[K]> {
    const row = await one<{ value: unknown }>(db, 'SELECT value FROM settings WHERE key = $1', [key]);
    return { ...DEFAULT_SETTINGS[key], ...((row?.value as object) ?? {}) } as SettingsMap[K];
  }

  async putSetting(db: Db, tenantId: string, key: string, value: unknown): Promise<void> {
    if (!(key in DEFAULT_SETTINGS)) throw notFound(`Setting "${key}"`);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw badRequest('invalid_setting', 'Setting value must be an object');
    await db.query(
      `INSERT INTO settings (tenant_id, key, value) VALUES ($1,$2,$3)
       ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [tenantId, key, value],
    );
  }
}
