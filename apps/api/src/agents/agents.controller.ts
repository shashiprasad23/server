import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { DbService, many } from '../db/db.service';
import { CurrentPrincipal, Roles } from '../auth/auth.guard';
import { Principal } from '../common/principal';
import { validate } from '../common/validate';
import { notFound } from '../common/errors';
import { AgentRuntime } from './agent-runtime.service';
import { ApprovalsService } from './approvals.service';
import { agentDefinition } from './agent-definitions';
import { effectiveDefinition } from './policy-engine';

const overridesInput = z
  .object({
    dailyActionCap: z.number().int().min(0).max(100000),
    confidenceThreshold: z.number().min(0).max(1),
    outboundMode: z.enum(['approval', 'autonomous']),
    templates: z.array(z.string()),
  })
  .partial();

@Controller('v1/agents')
export class AgentsController {
  constructor(
    private readonly db: DbService,
    private readonly runtime: AgentRuntime,
  ) {}

  @Get()
  list(@CurrentPrincipal() p: Principal) {
    return this.db.tx(p.tenantId, async (db) => {
      const out = [];
      for (const def of this.runtime.definitions()) {
        const state = await this.runtime.state(db, def.id);
        out.push({ ...effectiveDefinition(def, state.overrides), enabled: state.enabled, killed: state.killed, actionsToday: state.actionsToday });
      }
      return out;
    });
  }

  /** Audit trail: every decision with its inputs, evidence, model, prompt version and writes (FR-AI-05). */
  @Get('actions')
  actions(@CurrentPrincipal() p: Principal, @Query('agentId') agentId?: string, @Query('decision') decision?: string, @Query('targetId') targetId?: string) {
    return this.db.tx(p.tenantId, (db) =>
      many(
        db,
        `SELECT * FROM agent_actions
          WHERE ($1::text IS NULL OR agent_id = $1) AND ($2::text IS NULL OR decision = $2) AND ($3::uuid IS NULL OR target_id = $3)
          ORDER BY created_at DESC LIMIT 200`,
        [agentId ?? null, decision ?? null, targetId ?? null],
      ),
    );
  }

  @Post('actions/:id/rollback')
  @Roles('sales_leader', 'rep')
  rollback(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.db.tx(p.tenantId, (db) => this.runtime.rollback(db, p, id));
  }

  @Post('runs/:runId/rollback')
  @Roles('sales_leader')
  rollbackRun(@CurrentPrincipal() p: Principal, @Param('runId') runId: string) {
    return this.db.tx(p.tenantId, (db) => this.runtime.rollbackRun(db, p, runId));
  }

  /** FR-AI-07: per-agent kill switch. */
  @Post(':id/kill')
  @Roles('sales_leader')
  async kill(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    await this.db.tx(p.tenantId, (db) => this.runtime.setKilled(db, p.tenantId, id, true));
    return { id, killed: true };
  }

  @Post(':id/resume')
  @Roles('sales_leader')
  async resume(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    await this.db.tx(p.tenantId, (db) => this.runtime.setKilled(db, p.tenantId, id, false));
    return { id, killed: false };
  }

  @Put(':id/overrides')
  @Roles('admin')
  async overrides(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body() body: unknown) {
    if (!agentDefinition(id)) throw notFound(`Agent "${id}"`);
    const o = validate(overridesInput, body);
    await this.db.tx(p.tenantId, (db) => this.runtime.setOverrides(db, p.tenantId, id, o));
    return { id, overrides: o };
  }

  /** AI usage and cost visibility per agent (FR-AI-09). */
  @Get('usage')
  usage(@CurrentPrincipal() p: Principal) {
    return this.db.tx(p.tenantId, (db) =>
      many(
        db,
        `SELECT agent_id, model, date_trunc('day', created_at) AS day, count(*)::int AS calls,
                sum(input_tokens)::int AS input_tokens, sum(output_tokens)::int AS output_tokens
           FROM llm_usage GROUP BY 1, 2, 3 ORDER BY day DESC LIMIT 500`,
      ),
    );
  }
}

@Controller('v1/approvals')
export class ApprovalsController {
  constructor(
    private readonly db: DbService,
    private readonly approvals: ApprovalsService,
  ) {}

  @Get()
  list(@CurrentPrincipal() p: Principal, @Query('status') status?: string) {
    return this.db.tx(p.tenantId, (db) => this.approvals.list(db, p, status));
  }

  @Post(':id/approve')
  approve(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body() body: unknown) {
    return this.db.tx(p.tenantId, (db) => this.approvals.approve(db, p, id, body));
  }

  @Post(':id/reject')
  reject(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body() body: unknown) {
    return this.db.tx(p.tenantId, (db) => this.approvals.reject(db, p, id, body));
  }
}
