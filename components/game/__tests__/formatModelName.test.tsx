import { describe, it, expect } from 'vitest';
import { formatModelName } from '../PlayGame';

describe('formatModelName', () => {
  it('returns empty string for null', () => {
    expect(formatModelName(null)).toBe('');
  });

  it('keeps "openrouter/free" as-is', () => {
    expect(formatModelName('openrouter/free')).toBe('openrouter/free');
  });

  it('strips provider prefix and :free suffix', () => {
    expect(formatModelName('meta-llama/llama-3.3-70b-instruct:free')).toBe('llama-3.3-70b-instruct');
  });

  it('strips provider prefix and -it suffix', () => {
    expect(formatModelName('google/gemma-3-12b-it')).toBe('gemma-3-12b');
  });

  it('strips provider prefix only when no known suffix', () => {
    expect(formatModelName('anthropic/claude-3-haiku')).toBe('claude-3-haiku');
  });
});
