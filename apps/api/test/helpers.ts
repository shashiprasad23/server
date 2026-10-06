import { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';
import { createApp } from '../src/app.factory';
import { loadConfig } from '../src/config/config';
import { migrate } from '../src/db/migrate';
import { SEED, seed } from '../src/db/seed';
import { EventBus } from '../src/events/event-bus';
import { OutboundService } from '../src/outbound/outbound.service';
import { RecordingMailSender } from '../src/outbound/mail-sender';
import { sign } from '../src/ingestion/ingestion.controller';
import { Source } from '../src/ingestion/normalized-event';

const OWNER_URL = process.env.TEST_MIGRATION_DATABASE_URL ?? 'postgres://atlas:atlas@localhost:5432/atlas_test';
const APP_URL = process.env.TEST_DATABASE_URL ?? 'postgres://atlas_app:atlas_app@localhost:5432/atlas_test';

export const secrets: Record<Source, string> = {
  marketplace: 'test-marketplace',
  usp: 'test-usp',
  outlook: 'test-outlook',
  teams: 'test-teams',
  whatsapp: 'test-whatsapp',
};

export interface TestContext {
  app: INestApplication;
  http: ReturnType<typeof request>;
  mailer: RecordingMailSender;
  events: EventBus;
  outbound: OutboundService;
  owner: Client;
  token(email: string): Promise<string>;
  send(source: Source, body: unknown, signature?: string): request.Test;
  drain(): Promise<number>;
}

/** Fresh schema, migrations, seed and an app instance with workers off (tests drive the outbox). */
export async function setup(): Promise<TestContext> {
  process.env.NODE_ENV = 'test';
  const reset = new Client({ connectionString: OWNER_URL });
  await reset.connect();
  await reset.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await reset.end();
  await migrate(OWNER_URL, 'atlas_app', () => undefined);
  await seed(OWNER_URL);

  const config = loadConfig({
    DATABASE_URL: APP_URL,
    MIGRATION_DATABASE_URL: OWNER_URL,
    JWT_SECRET: 'test-secret-123',
    AUTH_DEV_TOKENS: 'true',
    WORKERS_ENABLED: 'false',
    OUTBOUND_UNDO_WINDOW_SECONDS: '0',
    LLM_PROVIDER: 'heuristic',
    CHANNEL_SECRET_MARKETPLACE: secrets.marketplace,
    CHANNEL_SECRET_USP: secrets.usp,
    CHANNEL_SECRET_OUTLOOK: secrets.outlook,
    CHANNEL_SECRET_TEAMS: secrets.teams,
    CHANNEL_SECRET_WHATSAPP: secrets.whatsapp,
  });
  const mailer = new RecordingMailSender();
  const app = await createApp(config, { mailSender: mailer });
  await app.init();
  const http = request(app.getHttpServer());
  const owner = new Client({ connectionString: OWNER_URL });
  await owner.connect();
  const tokens = new Map<string, string>();
  const events = app.get(EventBus);

  return {
    app,
    http,
    mailer,
    events,
    outbound: app.get(OutboundService),
    owner,
    async token(email) {
      if (!tokens.has(email)) {
        const r = await request(app.getHttpServer()).post('/v1/auth/dev-token').send({ email }).expect(201);
        tokens.set(email, r.body.token);
      }
      return tokens.get(email)!;
    },
    send(source, body, signature) {
      const raw = JSON.stringify(body);
      return request(app.getHttpServer())
        .post(`/v1/channel-events/${source}`)
        .set('content-type', 'application/json')
        .set('x-atlas-signature', signature ?? sign(secrets[source], raw))
        .send(raw);
    },
    drain: () => events.drain(),
  };
}

export async function teardown(ctx: TestContext) {
  await ctx.owner.end();
  await ctx.app.close();
}

export const U = SEED.users;
