import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { DbService } from '../db/db.service';
import { CurrentPrincipal } from '../auth/auth.guard';
import { Principal } from '../common/principal';
import { validate } from '../common/validate';
import { ComplianceService } from './compliance.service';

@Controller('v1/compliance')
export class ComplianceController {
  constructor(
    private readonly db: DbService,
    private readonly compliance: ComplianceService,
  ) {}

  @Get('queue')
  queue(@CurrentPrincipal() p: Principal) {
    return this.db.tx(p.tenantId, (db) => this.compliance.queue(db));
  }

  @Get('opportunities/:id')
  checks(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.db.tx(p.tenantId, (db) => this.compliance.checks(db, id));
  }

  @Post('opportunities/:id/screen')
  screen(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.db.tx(p.tenantId, (db) => this.compliance.screen(db, p, id));
  }

  @Post('opportunities/:id/eus/:action')
  eus(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Param('action') action: string, @Body() body: unknown) {
    const a = validate(z.enum(['request', 'receive']), action);
    return this.db.tx(p.tenantId, (db) => this.compliance.endUserStatement(db, p, id, a, body));
  }

  @Post('opportunities/:id/decision')
  decide(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body() body: unknown) {
    return this.db.tx(p.tenantId, (db) => this.compliance.decide(db, p, id, body));
  }
}
