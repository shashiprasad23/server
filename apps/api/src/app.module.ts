import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AppConfig, CONFIG } from './config/config';
import { ErrorFilter } from './common/errors';
import { DbModule } from './db/db.module';
import { EventsModule } from './events/events.module';
import { AuthGuard } from './auth/auth.guard';
import { AuthController } from './auth/auth.controller';
import { MetadataService } from './metadata/metadata.service';
import { MetadataController } from './metadata/metadata.controller';
import { RecordsService } from './records/records.service';
import { RecordsController } from './records/records.controller';
import { TimelineController } from './timeline/timeline.controller';
import { LlmService } from './llm/llm.service';
import { OutboundService } from './outbound/outbound.service';
import { MAIL_SENDER, MailSender, mailSenderFromEnv } from './outbound/mail-sender';
import { AgentRuntime } from './agents/agent-runtime.service';
import { ApprovalsService } from './agents/approvals.service';
import { AgentsController, ApprovalsController } from './agents/agents.controller';
import { CaptureAgent } from './agents/builtin/capture.agent';
import { InboundSdrAgent } from './agents/builtin/inbound-sdr.agent';
import { IdentityService } from './ingestion/identity.service';
import { PipelineService } from './ingestion/pipeline.service';
import { IngestionController } from './ingestion/ingestion.controller';
import { FINANCE_SYSTEM, FinanceSystemAdapter, ManualFinanceSystem } from './adapters/finance-system.adapter';
import { CloseController } from './deals/close.controller';
import { WorkersService } from './workers/workers.service';
import { HealthController } from './health.controller';
import { CpqService } from './cpq/cpq.service';
import { CpqController } from './cpq/cpq.controller';
import { ComplianceService } from './compliance/compliance.service';
import { ComplianceController } from './compliance/compliance.controller';
import { InsightsService } from './insights/insights.service';
import { InsightsController } from './insights/insights.controller';
import { DemoDataService } from './insights/demo-data.service';
import { InstalledBaseService } from './cs/installed-base.service';
import { DealCoachAgent } from './agents/builtin/deal-coach.agent';
import { QuoteAgent } from './agents/builtin/quote.agent';

export interface AppOverrides {
  mailSender?: MailSender;
  financeSystem?: FinanceSystemAdapter;
}

@Module({})
export class AppModule {
  static forRoot(config: AppConfig, overrides: AppOverrides = {}): DynamicModule {
    return {
      module: AppModule,
      imports: [
        { module: class ConfigModule {}, global: true, providers: [{ provide: CONFIG, useValue: config }], exports: [CONFIG] },
        DbModule,
        EventsModule,
      ],
      controllers: [
        HealthController,
        AuthController,
        MetadataController,
        RecordsController,
        TimelineController,
        AgentsController,
        ApprovalsController,
        IngestionController,
        CloseController,
        CpqController,
        ComplianceController,
        InsightsController,
      ],
      providers: [
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_FILTER, useClass: ErrorFilter },
        { provide: MAIL_SENDER, useValue: overrides.mailSender ?? mailSenderFromEnv() },
        { provide: FINANCE_SYSTEM, useValue: overrides.financeSystem ?? new ManualFinanceSystem() },
        MetadataService,
        RecordsService,
        LlmService,
        OutboundService,
        AgentRuntime,
        ApprovalsService,
        CaptureAgent,
        InboundSdrAgent,
        IdentityService,
        PipelineService,
        WorkersService,
        CpqService,
        ComplianceService,
        InsightsService,
        DemoDataService,
        InstalledBaseService,
        DealCoachAgent,
        QuoteAgent,
      ],
    };
  }
}
