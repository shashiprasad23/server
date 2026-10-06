import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { DbService } from '../db/db.service';
import { CurrentPrincipal, Roles } from '../auth/auth.guard';
import { Principal, systemPrincipal } from '../common/principal';
import { validate } from '../common/validate';
import { RecordsService } from '../records/records.service';
import { CpqService } from './cpq.service';
import { Requirements } from './configurator';
import { renderProposal } from './proposal';

@Controller('v1')
export class CpqController {
  constructor(
    private readonly db: DbService,
    private readonly cpq: CpqService,
    private readonly records: RecordsService,
  ) {}

  @Get('catalog')
  catalog(@CurrentPrincipal() p: Principal) {
    return this.db.tx(p.tenantId, (db) => this.cpq.listProducts(db, p));
  }

  @Post('catalog/import')
  @Roles('procurement', 'deal_desk')
  importPriceList(@CurrentPrincipal() p: Principal, @Body() body: unknown) {
    return this.db.tx(p.tenantId, (db) => this.cpq.importPriceList(db, p, body));
  }

  /** Configure from the requirement sheet (optionally overridden) and check supply, without saving. */
  @Post('opportunities/:id/configure')
  configure(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body() body: Requirements) {
    return this.db.tx(p.tenantId, async (db) => {
      const config = await this.cpq.configureFor(db, id, body && typeof body === 'object' ? body : undefined);
      const supply = config.valid ? await this.cpq.supplyCheck(db, id, config.lines) : [];
      return {
        ...config,
        lines: config.lines.map((l, i) => ({
          sku: l.product.sku,
          name: l.product.name,
          category: l.product.category,
          qty: l.qty,
          reason: l.reason,
          unit_price: l.product.list_price,
          power_kw: l.product.power_kw,
          supply: supply[i] ?? null,
        })),
      };
    });
  }

  @Get('opportunities/:id/readiness')
  readiness(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.db.tx(p.tenantId, (db) => this.cpq.readiness(db, id));
  }

  @Post('opportunities/:id/readiness/tasks')
  readinessTasks(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.db.tx(p.tenantId, (db) => this.cpq.readinessTasks(db, p, id));
  }

  // holds
  @Get('supply/holds')
  holds(@CurrentPrincipal() p: Principal, @Query('opportunityId') opportunityId?: string) {
    return this.db.tx(p.tenantId, (db) => this.cpq.holds(db, opportunityId));
  }

  @Post('opportunities/:id/holds')
  hold(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body() body: unknown) {
    return this.db.tx(p.tenantId, (db) => this.cpq.createHold(db, p, id, body));
  }

  @Delete('supply/holds/:id')
  release(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.db.tx(p.tenantId, (db) => this.cpq.releaseHold(db, p, id));
  }

  // deal registrations
  @Get('deal-registrations')
  dealRegs(@CurrentPrincipal() p: Principal, @Query('opportunityId') opportunityId?: string) {
    return this.db.tx(p.tenantId, (db) => this.cpq.dealRegistrations(db, opportunityId));
  }

  @Post('opportunities/:id/deal-registrations')
  createDealReg(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body() body: unknown) {
    const { oem } = validate(z.object({ oem: z.string().min(1) }), body);
    return this.db.tx(p.tenantId, (db) => this.cpq.createDealRegistration(db, p, id, oem));
  }

  @Post('deal-registrations/:id/:action')
  dealRegAction(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Param('action') action: string, @Body() body: unknown) {
    const a = validate(z.enum(['submit', 'approve', 'reject']), action);
    return this.db.tx(p.tenantId, (db) => this.cpq.updateDealRegistration(db, p, id, a, body));
  }

  // quotes
  @Get('quotes')
  quotes(@CurrentPrincipal() p: Principal, @Query('opportunityId') opportunityId?: string, @Query('status') status?: string) {
    return this.db.tx(p.tenantId, (db) => this.cpq.listQuotes(db, p, opportunityId, status));
  }

  @Post('opportunities/:id/quotes')
  createQuote(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body() body: unknown) {
    return this.db.tx(p.tenantId, async (db) => this.cpq.getQuote(db, p, (await this.cpq.createQuote(db, p, id, body)).id));
  }

  @Get('quotes/:id')
  quote(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.db.tx(p.tenantId, (db) => this.cpq.getQuote(db, p, id));
  }

  @Post('quotes/:id/submit')
  submit(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.db.tx(p.tenantId, (db) => this.cpq.submitQuote(db, p, id));
  }

  @Post('quotes/:id/approve')
  approve(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body() body: { note?: string }) {
    return this.db.tx(p.tenantId, (db) => this.cpq.decideQuote(db, p, id, true, body?.note));
  }

  @Post('quotes/:id/reject')
  reject(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body() body: { note?: string }) {
    return this.db.tx(p.tenantId, (db) => this.cpq.decideQuote(db, p, id, false, body?.note));
  }

  @Post('quotes/:id/publish')
  @Roles('rep', 'sales_leader')
  publish(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body() body: unknown) {
    const { channel } = validate(z.object({ channel: z.enum(['marketplace', 'usp', 'email']) }), body);
    return this.db.tx(p.tenantId, (db) => this.cpq.publishQuote(db, p, id, channel));
  }

  @Post('quotes/:id/accept')
  @Roles('rep', 'sales_leader')
  accept(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.db.tx(p.tenantId, (db) => this.cpq.acceptQuote(db, p, id));
  }

  @Post('quotes/:id/revalidate')
  revalidate(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.db.tx(p.tenantId, (db) => this.cpq.revalidate(db, p, id));
  }

  /** FR-CPQ-09: printable proposal (HTML; use the browser's Save as PDF). */
  @Get('quotes/:id/proposal')
  @Header('content-type', 'text/html; charset=utf-8')
  proposal(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.db.tx(p.tenantId, async (db) => {
      const sys = systemPrincipal(p.tenantId);
      const quote = await this.cpq.getQuote(db, p, id);
      const opportunity = (await this.records.getRaw(db, 'opportunities', quote.opportunity_id))!;
      const account = opportunity.account_id ? await this.records.getRaw(db, 'accounts', String(opportunity.account_id)) : undefined;
      const contact = opportunity.primary_contact_id ? await this.records.getRaw(db, 'contacts', String(opportunity.primary_contact_id)) : undefined;
      const milestones = (await this.cpq.defaultPlan(db, sys, quote.opportunity_id)) as never;
      return renderProposal({ quote, opportunity, account, contact, milestones });
    });
  }

  // mutual action plan
  @Get('opportunities/:id/milestones')
  milestones(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.db.tx(p.tenantId, (db) => this.cpq.milestones(db, id));
  }

  @Post('opportunities/:id/milestones')
  addMilestone(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body() body: unknown) {
    return this.db.tx(p.tenantId, (db) => this.cpq.addMilestone(db, p, id, body));
  }

  @Post('opportunities/:id/milestones/default')
  defaultPlan(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.db.tx(p.tenantId, (db) => this.cpq.defaultPlan(db, p, id));
  }

  @Patch('milestones/:id')
  updateMilestone(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body() body: unknown) {
    return this.db.tx(p.tenantId, (db) => this.cpq.updateMilestone(db, id, body));
  }
}
