import { Controller, Get, Inject } from '@nestjs/common';
import { Public } from './auth/auth.guard';
import { DbService } from './db/db.service';
import { LlmService } from './llm/llm.service';
import { FINANCE_SYSTEM, FinanceSystemAdapter } from './adapters/finance-system.adapter';
import { MAIL_SENDER, MailSender } from './outbound/mail-sender';

@Controller('health')
export class HealthController {
  constructor(
    private readonly db: DbService,
    private readonly llm: LlmService,
    @Inject(FINANCE_SYSTEM) private readonly finance: FinanceSystemAdapter,
    @Inject(MAIL_SENDER) private readonly mail: MailSender,
  ) {}

  @Public()
  @Get()
  async health() {
    await this.db.pool.query('SELECT 1');
    return { status: 'ok', llm: this.llm.provider, financeSystem: this.finance.name, mailSender: this.mail.name };
  }
}
