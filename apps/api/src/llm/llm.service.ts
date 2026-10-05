import { Inject, Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { AppConfig, CONFIG } from '../config/config';
import { Db } from '../db/db.service';
import { heuristicSignals } from './heuristic.provider';
import { SIGNALS_PROMPT_VERSION, SIGNALS_SYSTEM_PROMPT, Signals, SignalsSchema } from './signals';

export interface ExtractionResult {
  signals: Signals;
  model: string;
  promptVersion: string;
}

/** Longest input sent for extraction; longer threads are cut at a message boundary by the caller. */
const MAX_INPUT_CHARS = 60_000;

/**
 * LLM gateway (tech spec 6.1): one place for model choice, prompt versions, metering and
 * fallbacks. Agents never call a model SDK directly.
 */
@Injectable()
export class LlmService {
  private readonly log = new Logger('LlmService');
  private readonly client?: Anthropic;

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {
    if (config.LLM_PROVIDER === 'anthropic') this.client = new Anthropic();
  }

  get provider(): string {
    return this.client ? this.config.LLM_MODEL : 'heuristic';
  }

  async extractSignals(db: Db, tenantId: string, agentId: string, text: string): Promise<ExtractionResult> {
    const input = text.slice(0, MAX_INPUT_CHARS);
    if (!this.client) {
      return { signals: heuristicSignals(input), model: 'heuristic', promptVersion: SIGNALS_PROMPT_VERSION };
    }
    try {
      const response = await this.client.beta.messages.parse({
        model: this.config.LLM_MODEL,
        max_tokens: 16000,
        // Route policy declines to a fallback model instead of failing the capture.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'low', format: betaZodOutputFormat(SignalsSchema) },
        system: [{ type: 'text', text: SIGNALS_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: `<communication>\n${input}\n</communication>` }],
      });
      await db.query(
        'INSERT INTO llm_usage (tenant_id, agent_id, purpose, model, input_tokens, output_tokens) VALUES ($1,$2,$3,$4,$5,$6)',
        [tenantId, agentId, 'extract_signals', response.model, response.usage.input_tokens, response.usage.output_tokens],
      );
      if (response.stop_reason === 'refusal' || !response.parsed_output) {
        this.log.warn(`extraction declined or unparsable (stop_reason=${response.stop_reason}); using heuristic`);
        return { signals: { ...heuristicSignals(input), confidence: 0.3 }, model: 'heuristic', promptVersion: SIGNALS_PROMPT_VERSION };
      }
      return { signals: response.parsed_output, model: response.model, promptVersion: SIGNALS_PROMPT_VERSION };
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError || err instanceof Anthropic.APIConnectionError) {
        this.log.warn(`model unavailable (${err.message}); using heuristic extraction`);
        return { signals: { ...heuristicSignals(input), confidence: 0.3 }, model: 'heuristic', promptVersion: SIGNALS_PROMPT_VERSION };
      }
      throw err;
    }
  }
}
