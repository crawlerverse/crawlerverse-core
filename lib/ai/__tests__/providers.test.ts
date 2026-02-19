import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getAIModel, getProviderConfig, isLocalProvider } from '../providers';

describe('getProviderConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns gateway config by default', () => {
    process.env.AI_GATEWAY_API_KEY = 'test-key';
    const config = getProviderConfig();
    expect(config.provider).toBe('gateway');
    expect(config.model).toBe('anthropic/claude-3-haiku');
  });

  it('returns openai-compatible config when AI_PROVIDER is set', () => {
    process.env.AI_PROVIDER = 'openai-compatible';
    process.env.OPENAI_COMPATIBLE_BASE_URL = 'http://localhost:1234/v1';
    process.env.OPENAI_COMPATIBLE_MODEL = 'devstral-mini';

    const config = getProviderConfig();
    expect(config.provider).toBe('openai-compatible');
    expect(config.baseURL).toBe('http://localhost:1234/v1');
    expect(config.model).toBe('devstral-mini');
  });

  it('throws if openai-compatible selected but BASE_URL missing', () => {
    process.env.AI_PROVIDER = 'openai-compatible';
    expect(() => getProviderConfig()).toThrow('OPENAI_COMPATIBLE_BASE_URL');
  });

  it('allows AI_MODEL to override default model', () => {
    process.env.AI_GATEWAY_API_KEY = 'test-key';
    process.env.AI_MODEL = 'anthropic/claude-3-sonnet';
    const config = getProviderConfig();
    expect(config.model).toBe('anthropic/claude-3-sonnet');
  });

  it('throws helpful error when local URL exists but AI_PROVIDER missing', () => {
    vi.stubEnv('AI_PROVIDER', '');
    vi.stubEnv('OPENAI_COMPATIBLE_BASE_URL', 'http://localhost:1234/v1');
    vi.stubEnv('AI_GATEWAY_API_KEY', '');

    expect(() => getProviderConfig()).toThrow('AI_PROVIDER=openai-compatible');
    expect(() => getProviderConfig()).toThrow('pnpm setup:ai');
  });

  it('throws helpful error when no config exists', () => {
    vi.stubEnv('AI_PROVIDER', '');
    vi.stubEnv('OPENAI_COMPATIBLE_BASE_URL', '');
    vi.stubEnv('AI_GATEWAY_API_KEY', '');
    vi.stubEnv('OPENROUTER_API_KEY', '');

    expect(() => getProviderConfig()).toThrow('pnpm setup:ai');
  });
});

describe('getAIModel', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns a model instance for gateway provider', () => {
    process.env.AI_PROVIDER = 'gateway';
    process.env.AI_GATEWAY_API_KEY = 'test-key';
    const model = getAIModel();
    expect(model).toBeDefined();
    expect(typeof model).toBe('object');
  });

  it('returns a model instance for openai-compatible provider', () => {
    process.env.AI_PROVIDER = 'openai-compatible';
    process.env.OPENAI_COMPATIBLE_BASE_URL = 'http://localhost:1234/v1';
    const model = getAIModel();
    expect(model).toBeDefined();
    expect(typeof model).toBe('object');
  });

  it('uses modelOverride when provided', () => {
    process.env.AI_PROVIDER = 'gateway';
    const model = getAIModel('custom-model');
    expect(model).toBeDefined();
  });
});

describe('isLocalProvider', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns false for gateway provider', () => {
    process.env.AI_PROVIDER = 'gateway';
    expect(isLocalProvider()).toBe(false);
  });

  it('returns true for openai-compatible provider', () => {
    process.env.AI_PROVIDER = 'openai-compatible';
    process.env.OPENAI_COMPATIBLE_BASE_URL = 'http://localhost:1234/v1';
    expect(isLocalProvider()).toBe(true);
  });
});
