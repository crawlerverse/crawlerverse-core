#!/usr/bin/env npx tsx
/**
 * AI Setup Wizard
 *
 * Interactive CLI for configuring AI providers.
 * Run with: pnpm setup:ai
 */

import { select, input, confirm, password } from '@inquirer/prompts';
import { join } from 'path';
import { updateEnvVars, readEnvFile, findProjectRoot } from './lib/env-utils';
import {
  testLocalConnection,
  testOpenRouterKey,
  testOpenAIConnection,
  testAnthropicKey,
} from './lib/connection-test';

const PROVIDERS = {
  local: {
    name: 'Local LLM (LMStudio/Ollama)',
    description: 'Free, private, requires local setup',
  },
  openrouter: {
    name: 'Cloud free tier (OpenRouter)',
    description: 'Free, no GPU needed, 50 req/day limit',
  },
  byok: {
    name: 'Bring your own API key',
    description: 'OpenAI, Anthropic, or other provider',
  },
} as const;

type ProviderChoice = keyof typeof PROVIDERS;

const BYOK_PROVIDERS = {
  openai: {
    name: 'OpenAI',
    description: 'gpt-4o, gpt-4o-mini',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
  },
  anthropic: {
    name: 'Anthropic',
    description: 'claude-3-haiku, claude-3-sonnet',
    defaultModel: 'claude-3-haiku-20240307',
  },
  other: {
    name: 'Other OpenAI-compatible',
    description: 'Groq, Together, Fireworks, etc.',
  },
} as const;

type BYOKProvider = keyof typeof BYOK_PROVIDERS;

const ENV_FILE = join(findProjectRoot(), '.env.local');

async function configureLocal(): Promise<void> {
  const baseUrl = await input({
    message: 'Local server URL?',
    default: 'http://localhost:1234/v1',
  });

  console.log('\nTesting connection...');
  const result = await testLocalConnection(baseUrl);

  if (!result.success) {
    console.log(`\n${result.error}\n`);
    console.log('Troubleshooting:');
    console.log('  - Is LMStudio/Ollama running?');
    console.log('  - Check the URL includes /v1 suffix');
    console.log('  - Ensure the server accepts external connections\n');

    const retry = await confirm({ message: 'Try again?', default: true });
    if (retry) {
      return configureLocal();
    }
    process.exit(1);
  }

  console.log(`Connected! Found ${result.models?.length || 0} model(s)`);

  let modelName: string;
  if (result.models && result.models.length > 0) {
    if (result.models.length === 1) {
      modelName = result.models[0];
      console.log(`   Using model: ${modelName}`);
    } else {
      modelName = await select({
        message: 'Which model?',
        choices: result.models.map((m) => ({ value: m, name: m })),
      });
    }
  } else {
    modelName = await input({
      message: 'Model name?',
      default: 'local-model',
    });
  }

  const config = {
    AI_PROVIDER: 'openai-compatible',
    OPENAI_COMPATIBLE_BASE_URL: baseUrl,
    OPENAI_COMPATIBLE_MODEL: modelName,
  };

  updateEnvVars(ENV_FILE, config);

  console.log(`\nConfiguration saved to .env.local\n`);
  console.log(`   AI_PROVIDER=openai-compatible`);
  console.log(`   OPENAI_COMPATIBLE_BASE_URL=${baseUrl}`);
  console.log(`   OPENAI_COMPATIBLE_MODEL=${modelName}`);
  console.log(`\nStart the game with: pnpm dev\n`);
}

async function configureOpenRouter(): Promise<void> {
  console.log("\nTo use OpenRouter's free tier, you'll need an API key.");
  console.log('Get one at: https://openrouter.ai/keys (free, no credit card)\n');

  const apiKey = await password({
    message: 'API key:',
    mask: '*',
  });

  console.log('\nTesting connection...');
  const result = await testOpenRouterKey(apiKey);

  if (!result.success) {
    console.log(`\n${result.error}\n`);
    console.log('Please check:');
    console.log('  - Key copied correctly (no extra spaces)');
    console.log("  - Key hasn't been revoked\n");

    const retry = await confirm({ message: 'Try again?', default: true });
    if (retry) {
      return configureOpenRouter();
    }
    process.exit(1);
  }

  console.log('Valid key');

  const model = await select({
    message: 'Which model?',
    choices: [
      {
        value: 'mistralai/devstral-2512:free',
        name: 'Devstral (recommended)',
        description: '262k context, clean JSON output',
      },
      {
        value: 'mistralai/mistral-small-3.1-24b-instruct:free',
        name: 'Mistral Small 3.1',
        description: '128k context, good structured output',
      },
      {
        value: 'meta-llama/llama-3.3-70b-instruct:free',
        name: 'Llama 3.3 70B',
        description: '131k context, reliable',
      },
    ],
  });

  const config = {
    AI_PROVIDER: 'openrouter',
    OPENROUTER_API_KEY: apiKey,
    OPENROUTER_MODEL: model,
  };

  updateEnvVars(ENV_FILE, config);

  console.log(`\nConfiguration saved to .env.local\n`);
  console.log(`   AI_PROVIDER=openrouter`);
  console.log(`   OPENROUTER_API_KEY=sk-or-v1-****`);
  console.log(`   OPENROUTER_MODEL=${model}`);
  console.log(`\nStart the game with: pnpm dev\n`);
}

async function configureBYOK(): Promise<void> {
  const provider = await select<BYOKProvider>({
    message: 'Which provider?',
    choices: Object.entries(BYOK_PROVIDERS).map(([value, { name, description }]) => ({
      value: value as BYOKProvider,
      name,
      description,
    })),
  });

  if (provider === 'openai') {
    await configureOpenAI();
  } else if (provider === 'anthropic') {
    await configureAnthropic();
  } else {
    await configureOtherCompatible();
  }
}

async function configureOpenAI(): Promise<void> {
  console.log('\nGet your API key from: https://platform.openai.com/api-keys\n');

  const apiKey = await password({
    message: 'API key:',
    mask: '*',
  });

  console.log('\nTesting connection...');
  const result = await testOpenAIConnection('https://api.openai.com/v1', apiKey);

  if (!result.success) {
    console.log(`\n${result.error}\n`);
    const retry = await confirm({ message: 'Try again?', default: true });
    if (retry) {
      return configureOpenAI();
    }
    process.exit(1);
  }

  console.log('Connected');

  const model = await input({
    message: 'Model?',
    default: 'gpt-4o-mini',
  });

  const config = {
    AI_PROVIDER: 'openai-compatible',
    OPENAI_COMPATIBLE_BASE_URL: 'https://api.openai.com/v1',
    OPENAI_COMPATIBLE_API_KEY: apiKey,
    OPENAI_COMPATIBLE_MODEL: model,
  };

  updateEnvVars(ENV_FILE, config);

  console.log(`\nConfiguration saved to .env.local\n`);
  console.log(`   AI_PROVIDER=openai-compatible`);
  console.log(`   OPENAI_COMPATIBLE_BASE_URL=https://api.openai.com/v1`);
  console.log(`   OPENAI_COMPATIBLE_API_KEY=sk-****`);
  console.log(`   OPENAI_COMPATIBLE_MODEL=${model}`);
  console.log(`\nStart the game with: pnpm dev\n`);
}

async function configureAnthropic(): Promise<void> {
  console.log('\nGet your API key from: https://console.anthropic.com/\n');

  const apiKey = await password({
    message: 'API key:',
    mask: '*',
  });

  console.log('\nTesting connection...');
  const result = await testAnthropicKey(apiKey);

  if (!result.success) {
    console.log(`\n${result.error}\n`);
    const retry = await confirm({ message: 'Try again?', default: true });
    if (retry) {
      return configureAnthropic();
    }
    process.exit(1);
  }

  console.log('Valid key');

  const model = await select({
    message: 'Model?',
    choices: [
      { value: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku (fast, cheap)' },
      { value: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet (better reasoning)' },
      { value: 'claude-3-opus-20240229', name: 'Claude 3 Opus (best quality)' },
    ],
  });

  // Anthropic uses gateway provider, not openai-compatible
  const config = {
    AI_PROVIDER: 'gateway',
    AI_GATEWAY_API_KEY: apiKey,
    AI_MODEL: `anthropic/${model}`,
  };

  updateEnvVars(ENV_FILE, config);

  console.log(`\nConfiguration saved to .env.local\n`);
  console.log(`   AI_PROVIDER=gateway`);
  console.log(`   AI_GATEWAY_API_KEY=sk-ant-****`);
  console.log(`   AI_MODEL=anthropic/${model}`);
  console.log(`\nStart the game with: pnpm dev\n`);
}

async function configureOtherCompatible(): Promise<void> {
  console.log('\nConfigure any OpenAI-compatible API endpoint.\n');

  const baseUrl = await input({
    message: 'Base URL (e.g., https://api.groq.com/openai/v1):',
  });

  const apiKey = await password({
    message: 'API key:',
    mask: '*',
  });

  console.log('\nTesting connection...');
  const result = await testOpenAIConnection(baseUrl, apiKey);

  if (!result.success) {
    console.log(`\n${result.error}\n`);
    const retry = await confirm({ message: 'Try again?', default: true });
    if (retry) {
      return configureOtherCompatible();
    }
    process.exit(1);
  }

  console.log('Connected');

  let model: string;
  if (result.models && result.models.length > 0) {
    model = await select({
      message: 'Model?',
      choices: result.models.slice(0, 10).map((m) => ({ value: m, name: m })),
    });
  } else {
    model = await input({
      message: 'Model name:',
    });
  }

  const config = {
    AI_PROVIDER: 'openai-compatible',
    OPENAI_COMPATIBLE_BASE_URL: baseUrl,
    OPENAI_COMPATIBLE_API_KEY: apiKey,
    OPENAI_COMPATIBLE_MODEL: model,
  };

  updateEnvVars(ENV_FILE, config);

  console.log(`\nConfiguration saved to .env.local\n`);
  console.log(`   AI_PROVIDER=openai-compatible`);
  console.log(`   OPENAI_COMPATIBLE_BASE_URL=${baseUrl}`);
  console.log(`   OPENAI_COMPATIBLE_API_KEY=****`);
  console.log(`   OPENAI_COMPATIBLE_MODEL=${model}`);
  console.log(`\nStart the game with: pnpm dev\n`);
}

async function main() {
  console.log('\nCrawler AI Setup\n');

  // Check existing config
  const existing = readEnvFile(ENV_FILE);
  if (existing.AI_PROVIDER) {
    console.log(`Current config: ${existing.AI_PROVIDER}`);
    const proceed = await confirm({
      message: 'Reconfigure AI provider?',
      default: false,
    });
    if (!proceed) {
      console.log('Keeping existing configuration.\n');
      return;
    }
  }

  const provider = await select<ProviderChoice>({
    message: 'How do you want to run AI inference?',
    choices: Object.entries(PROVIDERS).map(([value, { name, description }]) => ({
      value: value as ProviderChoice,
      name,
      description,
    })),
  });

  switch (provider) {
    case 'local':
      await configureLocal();
      break;
    case 'openrouter':
      await configureOpenRouter();
      break;
    case 'byok':
      await configureBYOK();
      break;
  }
}

main().catch(console.error);
