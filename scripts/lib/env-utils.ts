/**
 * Utilities for reading and writing .env files
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export type EnvVars = Record<string, string>;

/**
 * Find the project root directory (where package.json with workspaces is located).
 */
export function findProjectRoot(): string {
  let dir = process.cwd();
  while (dir !== '/') {
    try {
      const pkgPath = join(dir, 'package.json');
      if (existsSync(pkgPath)) {
        const content = readFileSync(pkgPath, 'utf-8');
        const pkg = JSON.parse(content) as { workspaces?: unknown };
        if (pkg.workspaces) return dir;
      }
    } catch {
      // Continue searching
    }
    dir = join(dir, '..');
  }
  return process.cwd();
}

/**
 * Read and parse a .env file into key-value pairs.
 * Returns empty object if file doesn't exist.
 */
export function readEnvFile(filePath: string): EnvVars {
  if (!existsSync(filePath)) {
    return {};
  }

  const content = readFileSync(filePath, 'utf-8');
  const vars: EnvVars = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/i);
    if (match) {
      const [, key, rawValue] = match;
      // Remove surrounding quotes if present
      let value = rawValue;
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      vars[key] = value;
    }
  }

  return vars;
}

/**
 * Write key-value pairs to a .env file.
 * Quotes values containing spaces.
 */
export function writeEnvFile(filePath: string, vars: EnvVars): void {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(vars)) {
    if (value.includes(' ')) {
      lines.push(`${key}="${value}"`);
    } else {
      lines.push(`${key}=${value}`);
    }
  }

  writeFileSync(filePath, lines.join('\n') + '\n');
}

/**
 * Update specific env vars while preserving others.
 * Creates file if it doesn't exist.
 */
export function updateEnvVars(filePath: string, updates: EnvVars): void {
  const existing = readEnvFile(filePath);
  const merged = { ...existing, ...updates };
  writeEnvFile(filePath, merged);
}
