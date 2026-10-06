import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { CurrentPrincipal, Roles } from '../auth/auth.guard';
import { Principal } from '../common/principal';
import { RECORD_TYPES } from '../records/record-types';
import { DEFAULT_SETTINGS, MetadataService, SettingKey } from './metadata.service';
import { notFound } from '../common/errors';

@Controller('v1/metadata')
export class MetadataController {
  constructor(
    private readonly db: DbService,
    private readonly metadata: MetadataService,
  ) {}

  /** Object model: core fields per object plus the tenant's custom fields. */
  @Get('objects')
  async objects(@CurrentPrincipal() p: Principal) {
    const custom = await this.db.tx(p.tenantId, (db) => this.metadata.fieldDefinitions(db));
    return Object.values(RECORD_TYPES).map((rt) => ({
      object: rt.object,
      label: rt.label,
      fields: rt.fields,
      customFields: custom.filter((c) => c.object === rt.object),
    }));
  }

  @Get('fields')
  fields(@CurrentPrincipal() p: Principal, @Query('object') object?: string) {
    return this.db.tx(p.tenantId, (db) => this.metadata.fieldDefinitions(db, object));
  }

  @Post('fields')
  @Roles('admin')
  createField(@CurrentPrincipal() p: Principal, @Body() body: unknown) {
    return this.db.tx(p.tenantId, (db) => this.metadata.createFieldDefinition(db, p.tenantId, body));
  }

  @Get('stages')
  stages(@CurrentPrincipal() p: Principal) {
    return this.db.tx(p.tenantId, (db) => this.metadata.stages(db));
  }

  @Get('settings/:key')
  setting(@CurrentPrincipal() p: Principal, @Param('key') key: string) {
    if (!(key in DEFAULT_SETTINGS)) throw notFound(`Setting "${key}"`);
    return this.db.tx(p.tenantId, (db) => this.metadata.setting(db, key as SettingKey));
  }

  @Put('settings/:key')
  @Roles('admin')
  async putSetting(@CurrentPrincipal() p: Principal, @Param('key') key: string, @Body() body: unknown) {
    await this.db.tx(p.tenantId, (db) => this.metadata.putSetting(db, p.tenantId, key, body));
    return this.db.tx(p.tenantId, (db) => this.metadata.setting(db, key as SettingKey));
  }
}
