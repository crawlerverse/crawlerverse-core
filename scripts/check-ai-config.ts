#!/usr/bin/env npx tsx
/**
 * Pre-dev hook to check AI configuration.
 * Prompts user to run setup:ai if no config exists.
 */

import { confirm } from '@inquirer/prompts';
import { execSync } from 'child_process';
import { join } from 'path';
import { readEnvFile, findProjectRoot } from './lib/env-utils';

async function main() {
  const envFile = join(findProjectRoot(), '.env.local');
  const env = readEnvFile(envFile);

  // Check if AI is configured
  const hasProvider = !!env.AI_PROVIDER;
  const hasGatewayKey = !!env.AI_GATEWAY_API_KEY;
  const hasLocalUrl = !!env.OPENAI_COMPATIBLE_BASE_URL;
  const hasOpenRouterKey = !!env.OPENROUTER_API_KEY;

  // Detect misconfiguration: has local URL but no provider set
  if (!hasProvider && hasLocalUrl) {
    console.log('\nFound OPENAI_COMPATIBLE_BASE_URL but AI_PROVIDER is not set.');
    console.log('   Add AI_PROVIDER=openai-compatible to .env.local');
    console.log('   Or run: pnpm setup:ai\n');
    process.exit(1);
  }

  // No config at all
  if (!hasProvider && !hasGatewayKey && !hasLocalUrl && !hasOpenRouterKey) {
    console.log('\nNo AI provider configured.\n');

    const runSetup = await confirm({
      message: 'Run setup wizard?',
      default: true,
    });

    if (runSetup) {
      // Run setup:ai in the same terminal
      execSync('pnpm setup:ai', { stdio: 'inherit' });
    } else {
      console.log('\nTo configure later, run: pnpm setup:ai');
      console.log('Or manually edit .env.local (see docs/ai-providers.md)\n');
      process.exit(1);
    }
  }

  // Config exists, proceed silently
}

main().catch((error) => {
  // User cancelled (Ctrl+C) - exit gracefully
  if (error.message?.includes('User force closed')) {
    console.log('\n');
    process.exit(0);
  }
  console.error(error);
  process.exit(1);
});
