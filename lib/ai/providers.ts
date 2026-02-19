/**
 * AI Provider Configuration
 *
 * Supports multiple AI backends:
 * - gateway: Vercel AI Gateway (production default)
 * - openrouter: OpenRouter API (supports many models including free tier)
 * - openai-compatible: LMStudio, vLLM, or any OpenAI-compatible API
 */

import { gateway } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createLogger } from '../logging/logger';

const logger = createLogger({ module: 'ai-providers' });

export type AIProviderType = 'gateway' | 'openrouter' | 'openai-compatible';

export interface ProviderConfig {
  provider: AIProviderType;
  model: string;
  baseURL?: string;
  apiKey?: string;
}

const DEFAULT_GATEWAY_MODEL = 'anthropic/claude-3-haiku';
const DEFAULT_LOCAL_MODEL = 'local-model';

/**
 * Get provider configuration from environment variables.
 *
 * Environment variables:
 * - AI_PROVIDER: 'gateway' | 'openrouter' | 'openai-compatible' (default: 'gateway')
 * - AI_MODEL: Override the default model for any provider
 * - AI_GATEWAY_API_KEY: Required for gateway provider
 * - OPENROUTER_API_KEY: Required for openrouter provider
 * - OPENROUTER_MODEL: Model name for OpenRouter (default: 'mistralai/devstral-2512:free')
 * - OPENAI_COMPATIBLE_BASE_URL: Required for openai-compatible provider
 * - OPENAI_COMPATIBLE_API_KEY: Optional API key (some local servers don't need it)
 * - OPENAI_COMPATIBLE_MODEL: Model name for local server (default: 'local-model')
 */
const VALID_PROVIDERS: AIProviderType[] = ['gateway', 'openrouter', 'openai-compatible'];

export function getProviderConfig(): ProviderConfig {
  const rawProvider = process.env.AI_PROVIDER;

  // Detect misconfiguration: local URL set but provider not specified
  if (!rawProvider && process.env.OPENAI_COMPATIBLE_BASE_URL) {
    throw new Error(
      'Found OPENAI_COMPATIBLE_BASE_URL but AI_PROVIDER is not set.\n' +
        'Add AI_PROVIDER=openai-compatible to your .env.local\n' +
        'Or run: pnpm setup:ai'
    );
  }

  // No provider configured at all
  if (!rawProvider) {
    // Check if gateway key exists (legacy config)
    if (!process.env.AI_GATEWAY_API_KEY) {
      throw new Error(
        'No AI provider configured.\n' +
          'Run: pnpm setup:ai'
      );
    }
    // Has gateway key but no provider - assume gateway (legacy behavior)
  }

  // Continue with existing validation logic
  const effectiveProvider = rawProvider || 'gateway';
  const isValidProvider = VALID_PROVIDERS.includes(effectiveProvider as AIProviderType);

  if (!isValidProvider) {
    // Log as error since using wrong provider could incur unexpected costs
    logger.error(
      { invalidProvider: effectiveProvider, validOptions: VALID_PROVIDERS },
      'Invalid AI_PROVIDER, defaulting to "gateway" which may incur costs'
    );
  }

  const provider: AIProviderType = isValidProvider
    ? (effectiveProvider as AIProviderType)
    : 'gateway';

  if (provider === 'openrouter') {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error(
        'OPENROUTER_API_KEY is required when AI_PROVIDER=openrouter'
      );
    }

    return {
      provider: 'openrouter',
      apiKey,
      model: process.env.AI_MODEL || process.env.OPENROUTER_MODEL || 'mistralai/devstral-2512:free',
    };
  }

  if (provider === 'openai-compatible') {
    const baseURL = process.env.OPENAI_COMPATIBLE_BASE_URL;
    if (!baseURL) {
      throw new Error(
        'OPENAI_COMPATIBLE_BASE_URL is required when AI_PROVIDER=openai-compatible'
      );
    }

    return {
      provider: 'openai-compatible',
      baseURL,
      apiKey: process.env.OPENAI_COMPATIBLE_API_KEY || 'not-needed',
      model: process.env.AI_MODEL || process.env.OPENAI_COMPATIBLE_MODEL || DEFAULT_LOCAL_MODEL,
    };
  }

  // Default: gateway provider
  return {
    provider: 'gateway',
    model: process.env.AI_MODEL || DEFAULT_GATEWAY_MODEL,
  };
}

/**
 * Get a configured AI model instance based on environment configuration.
 *
 * Returns a model that can be passed to generateObject(), generateText(), etc.
 *
 * @param modelOverride - Optional model ID to override the configured default
 * @param configOverride - Optional pre-fetched config to avoid redundant getProviderConfig() calls
 */
export function getAIModel(modelOverride?: string, configOverride?: ProviderConfig) {
  const config = configOverride || getProviderConfig();
  const modelId = modelOverride || config.model;

  if (config.provider === 'openrouter') {
    const openrouter = createOpenRouter({
      apiKey: config.apiKey,
    });
    return openrouter(modelId);
  }

  if (config.provider === 'openai-compatible') {
    const openai = createOpenAI({
      baseURL: config.baseURL,
      apiKey: config.apiKey,
    });
    // Use .chat() to force /v1/chat/completions endpoint
    // The default openai(modelId) uses /v1/responses which local LLMs don't support
    return openai.chat(modelId);
  }

  // Default: Vercel AI Gateway
  return gateway(modelId);
}

/**
 * Check if using a local LLM provider.
 * Useful for adjusting behavior (e.g., more lenient retries, different timeouts).
 */
export function isLocalProvider(): boolean {
  return getProviderConfig().provider === 'openai-compatible';
}
