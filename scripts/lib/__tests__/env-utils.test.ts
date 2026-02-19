import { describe, it, expect, afterEach } from 'vitest';
import { readEnvFile, writeEnvFile, updateEnvVars } from '../env-utils';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('env-utils', () => {
  const testDir = tmpdir();
  const testFile = join(testDir, '.env.test');

  afterEach(() => {
    if (existsSync(testFile)) {
      unlinkSync(testFile);
    }
  });

  describe('readEnvFile', () => {
    it('returns empty object for non-existent file', () => {
      const result = readEnvFile('/nonexistent/.env');
      expect(result).toEqual({});
    });

    it('parses simple key=value pairs', () => {
      writeFileSync(testFile, 'FOO=bar\nBAZ=qux\n');
      const result = readEnvFile(testFile);
      expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' });
    });

    it('handles comments and empty lines', () => {
      writeFileSync(testFile, '# Comment\nFOO=bar\n\n# Another\nBAZ=qux\n');
      const result = readEnvFile(testFile);
      expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' });
    });

    it('handles quoted values', () => {
      writeFileSync(testFile, 'FOO="bar baz"\nQUX=\'single\'\n');
      const result = readEnvFile(testFile);
      expect(result).toEqual({ FOO: 'bar baz', QUX: 'single' });
    });
  });

  describe('writeEnvFile', () => {
    it('writes key=value pairs', () => {
      writeEnvFile(testFile, { FOO: 'bar', BAZ: 'qux' });
      const content = readFileSync(testFile, 'utf-8');
      expect(content).toContain('FOO=bar');
      expect(content).toContain('BAZ=qux');
    });

    it('quotes values with spaces', () => {
      writeEnvFile(testFile, { FOO: 'bar baz' });
      const content = readFileSync(testFile, 'utf-8');
      expect(content).toContain('FOO="bar baz"');
    });
  });

  describe('updateEnvVars', () => {
    it('preserves existing vars when adding new ones', () => {
      writeFileSync(testFile, 'EXISTING=value\n');
      updateEnvVars(testFile, { NEW: 'added' });
      const result = readEnvFile(testFile);
      expect(result).toEqual({ EXISTING: 'value', NEW: 'added' });
    });

    it('overwrites existing vars', () => {
      writeFileSync(testFile, 'FOO=old\n');
      updateEnvVars(testFile, { FOO: 'new' });
      const result = readEnvFile(testFile);
      expect(result).toEqual({ FOO: 'new' });
    });

    it('creates file if it does not exist', () => {
      const newFile = join(testDir, '.env.new');
      updateEnvVars(newFile, { FOO: 'bar' });
      expect(existsSync(newFile)).toBe(true);
      unlinkSync(newFile);
    });
  });
});
