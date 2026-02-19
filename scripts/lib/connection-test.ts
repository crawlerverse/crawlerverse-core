/**
 * Connection testing utilities for AI providers
 */

export interface ConnectionResult {
  success: boolean;
  error?: string;
  models?: string[];
}

/**
 * Test connection to a local OpenAI-compatible server (LMStudio, Ollama, etc.)
 */
export async function testLocalConnection(baseUrl: string): Promise<ConnectionResult> {
  try {
    const response = await fetch(`${baseUrl}/models`);

    if (!response.ok) {
      return {
        success: false,
        error: `Server returned ${response.status} ${response.statusText}`,
      };
    }

    const data = await response.json();
    const models = data.data?.map((m: { id: string }) => m.id) || [];

    return { success: true, models };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Test an OpenRouter API key
 */
export async function testOpenRouterKey(apiKey: string): Promise<ConnectionResult> {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/auth/key', {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      return {
        success: false,
        error: 'Invalid API key',
      };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Test connection to OpenAI or compatible API
 */
export async function testOpenAIConnection(
  baseUrl: string,
  apiKey: string
): Promise<ConnectionResult> {
  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        return { success: false, error: 'Invalid API key' };
      }
      return {
        success: false,
        error: `Server returned ${response.status} ${response.statusText}`,
      };
    }

    const data = await response.json();
    const models = data.data?.map((m: { id: string }) => m.id) || [];

    return { success: true, models };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Validate Anthropic API key format (no API call to avoid using credits)
 *
 * Anthropic keys follow the format: sk-ant-api03-<base64-encoded-data>
 * We validate the format without making a network request.
 */
export async function testAnthropicKey(apiKey: string): Promise<ConnectionResult> {
  // Anthropic keys start with sk-ant- and have a specific structure
  // Format: sk-ant-api03-<base64 characters>
  const anthropicKeyPattern = /^sk-ant-api\d{2}-[A-Za-z0-9_-]{80,}$/;

  if (!apiKey.startsWith('sk-ant-')) {
    return {
      success: false,
      error: 'Invalid key format (should start with sk-ant-)',
    };
  }

  if (!anthropicKeyPattern.test(apiKey)) {
    return {
      success: false,
      error: 'Invalid key format (key appears malformed)',
    };
  }

  // Format looks valid - we trust the user's key without making an API call
  // that would use their credits
  return { success: true };
}
