import { existsSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  DATABASE_URL: z.string().default('postgres://atlas_app:atlas_app@localhost:5432/atlas_dev'),
  MIGRATION_DATABASE_URL: z.string().default('postgres://atlas:atlas@localhost:5432/atlas_dev'),
  APP_DB_ROLE: z.string().default('atlas_app'),
  PORT: z.coerce.number().default(3000),
  JWT_SECRET: z.string().min(8).default('change-me-in-every-environment'),
  AUTH_DEV_TOKENS: bool,
  DEFAULT_TENANT_ID: z.guid().default('00000000-0000-0000-0000-000000000001'),
  CHANNEL_SECRET_MARKETPLACE: z.string().default('dev-marketplace-secret'),
  CHANNEL_SECRET_USP: z.string().default('dev-usp-secret'),
  CHANNEL_SECRET_OUTLOOK: z.string().default('dev-outlook-secret'),
  CHANNEL_SECRET_TEAMS: z.string().default('dev-teams-secret'),
  CHANNEL_SECRET_WHATSAPP: z.string().default('dev-whatsapp-secret'),
  LLM_PROVIDER: z.enum(['anthropic', 'heuristic']).default('heuristic'),
  LLM_MODEL: z.string().default('claude-opus-5-5'),
  WORKERS_ENABLED: bool,
  OUTBOUND_UNDO_WINDOW_SECONDS: z.coerce.number().int().min(0).default(120),
});

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  if (env.NODE_ENV === 'production') {
    if (parsed.data.JWT_SECRET === 'change-me-in-every-environment') throw new Error('Set JWT_SECRET in production');
    if (parsed.data.AUTH_DEV_TOKENS) throw new Error('AUTH_DEV_TOKENS must be off in production');
  }
  return parsed.data;
}

/**
 * For the local entrypoints (API, migrate, seed): loads apps/api/.env if present.
 * Variables already set in the environment win, so Docker and CI settings are unaffected.
 */
export function loadDotEnv(file = join(__dirname, '..', '..', '.env')) {
  if (existsSync(file) && typeof process.loadEnvFile === 'function') process.loadEnvFile(file);
}

export const CONFIG = Symbol('CONFIG');
