import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { CurrentPrincipal, Roles } from '../auth/auth.guard';
import { Principal } from '../common/principal';
import { badRequest } from '../common/errors';
import { ObjectName } from './record-types';
import { RecordsService } from './records.service';

const parseVersion = (h?: string) => {
  if (h === undefined) return undefined;
  const n = Number(h.replace(/"/g, ''));
  if (!Number.isInteger(n)) throw badRequest('invalid_if_match', 'If-Match must be the record version');
  return n;
};

/** Generic CRUD for every CRM object: /v1/accounts, /v1/contacts, /v1/leads, /v1/opportunities, /v1/activities. */
@Controller('v1/records')
export class RecordsController {
  constructor(
    private readonly db: DbService,
    private readonly records: RecordsService,
  ) {}

  @Get(':object')
  list(@CurrentPrincipal() p: Principal, @Param('object') object: ObjectName, @Query() q: Record<string, string>) {
    const { q: search, limit, offset, ...filters } = q;
    this.records.type(object);
    return this.db.tx(p.tenantId, (db) =>
      this.records.list(db, p, object, { q: search, limit: limit ? Number(limit) : undefined, offset: offset ? Number(offset) : undefined, filters }),
    );
  }

  @Post(':object')
  create(@CurrentPrincipal() p: Principal, @Param('object') object: ObjectName, @Body() body: unknown) {
    return this.db.tx(p.tenantId, (db) => this.records.create(db, p, object, body));
  }

  @Get(':object/:id')
  get(@CurrentPrincipal() p: Principal, @Param('object') object: ObjectName, @Param('id') id: string) {
    return this.db.tx(p.tenantId, (db) => this.records.get(db, p, object, id));
  }

  @Get(':object/:id/history')
  history(@CurrentPrincipal() p: Principal, @Param('object') object: ObjectName, @Param('id') id: string) {
    return this.db.tx(p.tenantId, (db) => this.records.history(db, object, id));
  }

  @Patch(':object/:id')
  async update(
    @CurrentPrincipal() p: Principal,
    @Param('object') object: ObjectName,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('if-match') ifMatch?: string,
  ) {
    const { record } = await this.db.tx(p.tenantId, (db) =>
      this.records.update(db, p, object, id, body, { expectedVersion: parseVersion(ifMatch) }),
    );
    return record;
  }

  @Delete(':object/:id')
  @Roles('admin')
  async remove(@CurrentPrincipal() p: Principal, @Param('object') object: ObjectName, @Param('id') id: string) {
    await this.db.tx(p.tenantId, (db) => this.records.remove(db, p, object, id));
    return { deleted: true };
  }
}
