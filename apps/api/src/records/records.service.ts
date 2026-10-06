import { Injectable } from '@nestjs/common';
import { z, ZodType } from 'zod';
import { Db, many, one } from '../db/db.service';
import { EventBus } from '../events/event-bus';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../common/errors';
import { Principal, hasRole } from '../common/principal';
import { FieldDefinition, MetadataService } from '../metadata/metadata.service';
import { FieldSpec, ObjectName, RECORD_TYPES, RESTRICTED_READERS, RecordType, recordType } from './record-types';
import { failedRules } from './stage-rules';
import { assertNoTransactionData } from './transaction-guardrail';

export type Row = Record<string, unknown> & { id: string; version: number };

export interface WriteOptions {
  source?: 'user' | 'agent' | 'integration' | 'system';
  agentActionId?: string;
  confidence?: number;
  evidence?: unknown[];
  expectedVersion?: number;
}

export interface FieldWrite {
  object: ObjectName;
  id: string;
  field: string;
  old: unknown;
  new: unknown;
  created?: boolean;
}

export interface ListQuery {
  q?: string;
  limit?: number;
  offset?: number;
  filters?: Record<string, string>;
}

const SYSTEM_COLUMNS = ['id', 'tenant_id', 'custom', 'version', 'created_at', 'updated_at', 'deleted_at'];

function coreSchema(spec: FieldSpec): ZodType<unknown> {
  let s: ZodType<unknown>;
  switch (spec.type) {
    case 'string':
      s = z.string().max(500);
      break;
    case 'text':
      s = z.string().max(200_000);
      break;
    case 'int':
      s = z.coerce.number().int();
      break;
    case 'number':
      s = z.coerce.number();
      break;
    case 'boolean':
      s = z.boolean();
      break;
    case 'date':
      s = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
      break;
    case 'datetime':
      s = z.string().datetime({ offset: true });
      break;
    case 'uuid':
      s = z.guid();
      break;
    case 'enum':
      s = z.enum(spec.values as [string, ...string[]]);
      break;
    case 'json':
      s = z.unknown();
      break;
  }
  return s.nullable();
}

function customSchema(def: FieldDefinition): ZodType<unknown> {
  switch (def.type) {
    case 'text':
      return z.string().max(5000).nullable();
    case 'number':
      return z.number().nullable();
    case 'boolean':
      return z.boolean().nullable();
    case 'date':
      return z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
    case 'enum':
      return z.enum(def.options as [string, ...string[]]).nullable();
    case 'json':
      return z.unknown();
  }
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Postgres returns numeric as string and date as Date; normalise for comparison and JSON output. */
function normalise(rt: RecordType, row: Record<string, unknown>): Row {
  const out: Record<string, unknown> = { ...row };
  for (const [k, spec] of Object.entries(rt.fields)) {
    const v = out[k];
    if (v == null) continue;
    if (spec.type === 'number' && typeof v === 'string') out[k] = Number(v);
    if (spec.type === 'date' && v instanceof Date) out[k] = v.toISOString().slice(0, 10);
    if (spec.type === 'datetime' && v instanceof Date) out[k] = v.toISOString();
  }
  delete out.tenant_id;
  return out as Row;
}

/**
 * Generic, metadata-driven record engine used by people, agents and integrations alike, so every
 * write passes the same validation, field security, transaction guardrail, stage gates and
 * provenance trail (tech spec 6: "agents change data only through the governed API").
 */
@Injectable()
export class RecordsService {
  constructor(
    private readonly metadata: MetadataService,
    private readonly events: EventBus,
  ) {}

  type(object: string): RecordType {
    const rt = recordType(object);
    if (!rt) throw notFound(`Object type "${object}"`);
    return rt;
  }

  private sourceOf(p: Principal, opts: WriteOptions): NonNullable<WriteOptions['source']> {
    if (opts.source) return opts.source;
    return p.kind === 'user' ? 'user' : p.kind;
  }

  private checkFieldWrite(p: Principal, rt: RecordType, field: string, spec: FieldSpec) {
    if (p.kind === 'system') return;
    if (spec.readOnly) throw forbidden('field_read_only', `${rt.object}.${field} is system-managed`);
    if (spec.humanOnly && p.kind === 'agent') {
      throw forbidden('agent_field_forbidden', `Agents may not write ${rt.object}.${field}`);
    }
    if (spec.writeRoles && p.kind === 'user' && !hasRole(p, ...spec.writeRoles)) {
      throw forbidden('field_role_required', `${rt.object}.${field} can only be set by: ${spec.writeRoles.join(', ')}`);
    }
  }

  private async parseInput(
    db: Db,
    p: Principal,
    rt: RecordType,
    input: unknown,
    mode: 'create' | 'update',
  ): Promise<{ core: Record<string, unknown>; custom: Record<string, unknown> }> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw badRequest('invalid_body', 'Body must be an object');
    assertNoTransactionData(input);
    const { custom: customInput, ...rest } = input as Record<string, unknown>;
    const core: Record<string, unknown> = {};
    const issues: { path: string; message: string }[] = [];

    for (const [key, value] of Object.entries(rest)) {
      if (SYSTEM_COLUMNS.includes(key)) continue;
      const spec = rt.fields[key];
      if (!spec) {
        issues.push({ path: key, message: `Unknown field on ${rt.object}; add it as a custom field first` });
        continue;
      }
      this.checkFieldWrite(p, rt, key, spec);
      const r = coreSchema(spec).safeParse(value);
      if (!r.success) issues.push(...r.error.issues.map((i) => ({ path: key, message: i.message })));
      else core[key] = r.data;
    }
    if (mode === 'create') {
      for (const [key, spec] of Object.entries(rt.fields)) {
        if (spec.required && (core[key] === undefined || core[key] === null)) issues.push({ path: key, message: 'Required' });
      }
    }

    const custom: Record<string, unknown> = {};
    if (customInput !== undefined) {
      if (!customInput || typeof customInput !== 'object' || Array.isArray(customInput)) {
        issues.push({ path: 'custom', message: 'Must be an object' });
      } else {
        const defs = new Map((await this.metadata.fieldDefinitions(db, rt.object)).map((d) => [d.key, d]));
        for (const [key, value] of Object.entries(customInput as Record<string, unknown>)) {
          const def = defs.get(key);
          if (!def) {
            issues.push({ path: `custom.${key}`, message: 'No such custom field' });
            continue;
          }
          if (def.restricted && p.kind === 'user' && !hasRole(p, ...RESTRICTED_READERS)) {
            throw forbidden('field_role_required', `custom.${key} is restricted`);
          }
          const r = customSchema(def).safeParse(value);
          if (!r.success) issues.push(...r.error.issues.map((i) => ({ path: `custom.${key}`, message: i.message })));
          else custom[key] = r.data;
        }
        if (mode === 'create') {
          for (const def of defs.values()) {
            if (def.required && (custom[def.key] === undefined || custom[def.key] === null)) {
              issues.push({ path: `custom.${def.key}`, message: 'Required' });
            }
          }
        }
      }
    }
    if (issues.length) throw badRequest('validation_failed', 'Request failed validation', issues);
    return { core, custom };
  }

  private async mask(db: Db, p: Principal, rt: RecordType, row: Row): Promise<Row> {
    if (hasRole(p, ...RESTRICTED_READERS) || p.kind === 'system') return row;
    const out: Row = { ...row };
    for (const [k, spec] of Object.entries(rt.fields)) if (spec.restricted) delete out[k];
    const restrictedCustom = (await this.metadata.fieldDefinitions(db, rt.object)).filter((d) => d.restricted);
    if (restrictedCustom.length && out.custom && typeof out.custom === 'object') {
      const c = { ...(out.custom as Record<string, unknown>) };
      for (const d of restrictedCustom) delete c[d.key];
      out.custom = c;
    }
    return out;
  }

  private async recordProvenance(db: Db, p: Principal, writes: FieldWrite[], opts: WriteOptions) {
    const source = this.sourceOf(p, opts);
    for (const w of writes) {
      await db.query(
        `INSERT INTO field_provenance (tenant_id, object, record_id, field, old_value, new_value, source, actor_id, agent_action_id, confidence, evidence)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          p.tenantId,
          w.object,
          w.id,
          w.field,
          JSON.stringify(w.old ?? null),
          JSON.stringify(w.new ?? null),
          source,
          p.actorId,
          opts.agentActionId ?? null,
          opts.confidence ?? null,
          JSON.stringify(opts.evidence ?? []),
        ],
      );
    }
  }

  private async raw(db: Db, rt: RecordType, id: string, lock = false): Promise<Row | undefined> {
    const row = await one<Record<string, unknown>>(
      db,
      `SELECT * FROM ${rt.table} WHERE id = $1 AND deleted_at IS NULL ${lock ? 'FOR UPDATE' : ''}`,
      [id],
    );
    return row ? normalise(rt, row) : undefined;
  }

  private async applyStageLogic(db: Db, rt: RecordType, merged: Record<string, unknown>, core: Record<string, unknown>, prevStage?: unknown) {
    if (rt.object !== 'opportunities') return;
    if (core.stage_key === undefined && prevStage !== undefined) return;
    const stageKey = (core.stage_key as string | undefined) ?? (prevStage as string | undefined);
    if (!stageKey) {
      const first = (await this.metadata.stages(db))[0];
      if (!first) throw unprocessable('no_pipeline', 'No pipeline stages configured');
      core.stage_key = first.key;
      merged.stage_key = first.key;
      return;
    }
    if (stageKey === prevStage) return;
    const stage = await this.metadata.stage(db, stageKey);
    const failed = failedRules(stage.entry_rules, merged);
    if (failed.length) {
      throw unprocessable('stage_gate_failed', `Cannot move to "${stage.label}"`, failed);
    }
    core.closed_at = stage.is_closed ? new Date().toISOString() : null;
  }

  async create(db: Db, p: Principal, object: ObjectName, input: unknown, opts: WriteOptions = {}): Promise<Row> {
    const rt = this.type(object);
    const { core, custom } = await this.parseInput(db, p, rt, input, 'create');
    await this.applyStageLogic(db, rt, { ...core }, core);

    const cols = ['tenant_id', ...Object.keys(core), 'custom'];
    const vals = [p.tenantId, ...Object.values(core).map((v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v)), JSON.stringify(custom)];
    const row = await one<Record<string, unknown>>(
      db,
      `INSERT INTO ${rt.table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
      vals,
    );
    const rec = normalise(rt, row!);
    const writes: FieldWrite[] = [
      ...Object.entries(core).map(([field, v]) => ({ object, id: rec.id, field, old: null, new: v, created: true })),
      ...Object.entries(custom).map(([k, v]) => ({ object, id: rec.id, field: `custom.${k}`, old: null, new: v, created: true })),
    ];
    await this.recordProvenance(db, p, writes, opts);
    await this.events.publish(db, p.tenantId, `${object}.created`, {
      id: rec.id,
      source: this.sourceOf(p, opts),
      actorId: p.actorId,
      agentActionId: opts.agentActionId ?? null,
    });
    return this.mask(db, p, rt, rec);
  }

  async update(
    db: Db,
    p: Principal,
    object: ObjectName,
    id: string,
    patch: unknown,
    opts: WriteOptions = {},
  ): Promise<{ record: Row; writes: FieldWrite[] }> {
    const rt = this.type(object);
    const current = await this.raw(db, rt, id, true);
    if (!current) throw notFound(rt.label);
    if (opts.expectedVersion !== undefined && opts.expectedVersion !== current.version) {
      throw conflict('version_conflict', `${rt.label} changed since you read it (version ${current.version})`);
    }
    const { core, custom } = await this.parseInput(db, p, rt, patch, 'update');
    const merged = { ...current, ...core };
    await this.applyStageLogic(db, rt, merged, core, current.stage_key);

    const writes: FieldWrite[] = [];
    for (const [field, v] of Object.entries(core)) {
      if (!sameValue(current[field], v)) writes.push({ object, id, field, old: current[field] ?? null, new: v });
    }
    const currentCustom = (current.custom as Record<string, unknown>) ?? {};
    for (const [k, v] of Object.entries(custom)) {
      if (!sameValue(currentCustom[k], v)) writes.push({ object, id, field: `custom.${k}`, old: currentCustom[k] ?? null, new: v });
    }
    if (!writes.length) return { record: await this.mask(db, p, rt, current), writes };

    const coreChanged = Object.keys(core).filter((k) => writes.some((w) => w.field === k));
    const sets = coreChanged.map((k, i) => `${k} = $${i + 2}`);
    const vals: unknown[] = coreChanged.map((k) => {
      const v = core[k];
      return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
    });
    if (Object.keys(custom).length) {
      sets.push(`custom = custom || $${vals.length + 2}::jsonb`);
      vals.push(JSON.stringify(custom));
    }
    const row = await one<Record<string, unknown>>(
      db,
      `UPDATE ${rt.table} SET ${sets.join(', ')}, version = version + 1, updated_at = now() WHERE id = $1 RETURNING *`,
      [id, ...vals],
    );
    const rec = normalise(rt, row!);
    await this.recordProvenance(db, p, writes, opts);
    const payload = {
      id,
      changed: writes.map((w) => w.field),
      source: this.sourceOf(p, opts),
      actorId: p.actorId,
      agentActionId: opts.agentActionId ?? null,
    };
    await this.events.publish(db, p.tenantId, `${object}.updated`, payload);
    if (object === 'opportunities' && core.stage_key !== undefined && core.stage_key !== current.stage_key) {
      await this.events.publish(db, p.tenantId, 'opportunities.stage_changed', { ...payload, from: current.stage_key, to: core.stage_key });
    }
    return { record: await this.mask(db, p, rt, rec), writes };
  }

  /** Soft delete; used by rollback of agent-created records and by admins. */
  async remove(db: Db, p: Principal, object: ObjectName, id: string, opts: WriteOptions = {}): Promise<void> {
    const rt = this.type(object);
    const r = await db.query(`UPDATE ${rt.table} SET deleted_at = now(), version = version + 1 WHERE id = $1 AND deleted_at IS NULL`, [id]);
    if (!r.rowCount) throw notFound(rt.label);
    await this.recordProvenance(db, p, [{ object, id, field: 'deleted_at', old: null, new: 'deleted' }], opts);
    await this.events.publish(db, p.tenantId, `${object}.deleted`, { id, actorId: p.actorId });
  }

  async get(db: Db, p: Principal, object: ObjectName, id: string): Promise<Row> {
    const rt = this.type(object);
    const row = await this.raw(db, rt, id);
    if (!row) throw notFound(rt.label);
    return this.mask(db, p, rt, row);
  }

  /** Unmasked read for internal services (agents, ingestion). */
  async getRaw(db: Db, object: ObjectName, id: string): Promise<Row | undefined> {
    return this.raw(db, this.type(object), id);
  }

  async list(db: Db, p: Principal, object: ObjectName, query: ListQuery = {}): Promise<{ items: Row[]; total: number }> {
    const rt = this.type(object);
    const where = ['deleted_at IS NULL'];
    const params: unknown[] = [];
    for (const [k, v] of Object.entries(query.filters ?? {})) {
      if (!rt.fields[k]) throw badRequest('unknown_filter', `Cannot filter ${object} by "${k}"`);
      params.push(v);
      where.push(`${k}::text = $${params.length}`);
    }
    if (query.q) {
      params.push(`%${query.q}%`);
      where.push(`(${rt.searchable.map((c) => `${c} ILIKE $${params.length}`).join(' OR ')})`);
    }
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const offset = Math.max(query.offset ?? 0, 0);
    const total = await one<{ n: string }>(db, `SELECT count(*) AS n FROM ${rt.table} WHERE ${where.join(' AND ')}`, params);
    const rows = await many<Record<string, unknown>>(
      db,
      `SELECT * FROM ${rt.table} WHERE ${where.join(' AND ')} ORDER BY updated_at DESC LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    const items = await Promise.all(rows.map((r) => this.mask(db, p, rt, normalise(rt, r))));
    return { items, total: Number(total?.n ?? 0) };
  }

  /** Field history with sources (citations / provenance view). */
  async history(db: Db, object: ObjectName, id: string) {
    this.type(object);
    return many(
      db,
      `SELECT field, old_value, new_value, source, actor_id, agent_action_id, confidence, evidence, created_at
         FROM field_provenance WHERE object = $1 AND record_id = $2 ORDER BY created_at DESC, id DESC LIMIT 500`,
      [object, id],
    );
  }

  /** Last write source per field; agents use it to avoid overriding human corrections (FR-CAP-13). */
  async humanSetFields(db: Db, object: ObjectName, id: string): Promise<Set<string>> {
    const rows = await many<{ field: string; source: string }>(
      db,
      `SELECT DISTINCT ON (field) field, source FROM field_provenance
        WHERE object = $1 AND record_id = $2 ORDER BY field, created_at DESC, id DESC`,
      [object, id],
    );
    return new Set(rows.filter((r) => r.source === 'user').map((r) => r.field));
  }
}

export const objectNames = Object.keys(RECORD_TYPES) as ObjectName[];
