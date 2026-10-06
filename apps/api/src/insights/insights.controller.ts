import { Body, Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { AppConfig, CONFIG } from '../config/config';
import { DbService, one } from '../db/db.service';
import { CurrentPrincipal, Roles } from '../auth/auth.guard';
import { Principal } from '../common/principal';
import { notFound } from '../common/errors';
import { validate } from '../common/validate';
import { InsightsService } from './insights.service';
import { InstalledBaseService } from '../cs/installed-base.service';
import { DealCoachAgent } from '../agents/builtin/deal-coach.agent';
import { DemoDataService } from './demo-data.service';

@Controller('v1')
export class InsightsController {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly db: DbService,
    private readonly insights: InsightsService,
    private readonly installed: InstalledBaseService,
    private readonly coach: DealCoachAgent,
    private readonly demo: DemoDataService,
  ) {}

  @Get('insights/dashboard')
  dashboard(@CurrentPrincipal() p: Principal) {
    return this.db.tx(p.tenantId, (db) => this.insights.dashboard(db, p));
  }

  @Get('insights/forecast')
  forecast(@CurrentPrincipal() p: Principal, @Query('months') months?: string) {
    return this.db.tx(p.tenantId, (db) => this.insights.forecast(db, p, Math.min(Math.max(Number(months) || 6, 1), 12)));
  }

  @Post('insights/forecast/calls')
  @Roles('rep', 'sales_leader')
  call(@CurrentPrincipal() p: Principal, @Body() body: unknown) {
    return this.db.tx(p.tenantId, (db) => this.insights.submitCall(db, p, body));
  }

  @Get('insights/supply-demand')
  supplyDemand(@CurrentPrincipal() p: Principal) {
    return this.db.tx(p.tenantId, (db) => this.insights.supplyDemand(db));
  }

  @Get('insights/leaks')
  leaks(@CurrentPrincipal() p: Principal) {
    return this.db.tx(p.tenantId, (db) => this.insights.leaks(db));
  }

  @Get('insights/inspection')
  inspection(@CurrentPrincipal() p: Principal) {
    return this.db.tx(p.tenantId, (db) => this.insights.inspection(db));
  }

  @Get('insights/weekly-summary')
  summary(@CurrentPrincipal() p: Principal) {
    return this.db.tx(p.tenantId, (db) => this.insights.weeklySummary(db, p));
  }

  @Post('ask')
  ask(@CurrentPrincipal() p: Principal, @Body() body: unknown) {
    const { question } = validate(z.object({ question: z.string().min(3).max(500) }), body);
    return this.db.tx(p.tenantId, (db) => this.insights.ask(db, p, question));
  }

  @Get('opportunities/:id/insights')
  score(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.db.tx(p.tenantId, (db) => this.insights.score(db, id));
  }

  @Get('opportunities/:id/brief')
  brief(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.db.tx(p.tenantId, (db) => this.insights.brief(db, p, id));
  }

  @Get('accounts/:id/committee')
  committee(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.db.tx(p.tenantId, (db) =>
      db
        .query('SELECT id, name, title, email, committee_role FROM contacts WHERE account_id = $1 AND deleted_at IS NULL ORDER BY committee_role NULLS LAST, name', [id])
        .then((r) => r.rows),
    );
  }

  // installed base and renewals
  @Get('installed-base')
  assets(@CurrentPrincipal() p: Principal, @Query('accountId') accountId?: string) {
    return this.db.tx(p.tenantId, (db) => this.installed.list(db, accountId));
  }

  @Post('agents/renewal_agent/run')
  @Roles('sales_leader')
  runRenewals(@CurrentPrincipal() p: Principal) {
    return this.installed.sweep(p.tenantId);
  }

  @Post('agents/deal_coach/run')
  @Roles('sales_leader')
  async runCoach(@CurrentPrincipal() p: Principal) {
    return { rescored: await this.coach.sweep(p.tenantId) };
  }

  // tasks
  @Post('tasks/:id/complete')
  complete(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.db.tx(p.tenantId, async (db) => {
      const t = await one(db, "UPDATE tasks SET status = 'done' WHERE id = $1 RETURNING *", [id]);
      if (!t) throw notFound('Task');
      return t;
    });
  }

  /** Development only: load a realistic demo pipeline for walkthroughs. */
  @Post('dev/demo-data')
  @Roles('admin', 'sales_leader')
  demoData(@CurrentPrincipal() p: Principal) {
    if (!this.config.AUTH_DEV_TOKENS) throw notFound('Route');
    return this.demo.load(p.tenantId);
  }
}
