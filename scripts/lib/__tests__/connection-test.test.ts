import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testLocalConnection, testOpenRouterKey, testOpenAIConnection, testAnthropicKey } from '../connection-test';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('connection-test', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('testLocalConnection', () => {
    it('returns success with model list on valid response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: [{ id: 'model-1' }, { id: 'model-2' }],
        }),
      });

      const result = await testLocalConnection('http://localhost:1234/v1');

      expect(result.success).toBe(true);
      expect(result.models).toEqual(['model-1', 'model-2']);
    });

    it('returns failure on connection error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await testLocalConnection('http://localhost:1234/v1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Connection refused');
    });

    it('returns failure on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const result = await testLocalConnection('http://localhost:1234/v1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('404');
    });
  });

  describe('testOpenRouterKey', () => {
    it('returns success on valid key', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { limit: 50 } }),
      });

      const result = await testOpenRouterKey('sk-or-v1-valid');

      expect(result.success).toBe(true);
    });

    it('returns failure on invalid key', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      const result = await testOpenRouterKey('invalid-key');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid API key');
    });
  });

  describe('testOpenAIConnection', () => {
    it('returns success on valid connection', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: [{ id: 'gpt-4o' }],
        }),
      });

      const result = await testOpenAIConnection('https://api.openai.com/v1', 'sk-valid');

      expect(result.success).toBe(true);
      expect(result.models).toContain('gpt-4o');
    });

    it('returns failure on invalid key', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      const result = await testOpenAIConnection('https://api.openai.com/v1', 'invalid');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid API key');
    });
  });

  describe('testAnthropicKey', () => {
    it('returns success on valid key format', async () => {
      // Valid Anthropic key format: sk-ant-api03-<80+ base64 chars>
      const validKey = 'sk-ant-api03-' + 'a'.repeat(100);
      const result = await testAnthropicKey(validKey);

      expect(result.success).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled(); // Should NOT make an API call
    });

    it('returns failure for key not starting with sk-ant-', async () => {
      const result = await testAnthropicKey('sk-invalid-key');

      expect(result.success).toBe(false);
      expect(result.error).toContain('should start with sk-ant-');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns failure for malformed key', async () => {
      // Starts correctly but too short
      const result = await testAnthropicKey('sk-ant-api03-tooshort');

      expect(result.success).toBe(false);
      expect(result.error).toContain('malformed');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
