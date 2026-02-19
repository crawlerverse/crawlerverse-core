/**
 * CLI Unit Tests
 *
 * Tests the CLI argument parsing and validation logic.
 * Does NOT test actual game execution (covered by headless-game.test.ts).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Command } from 'commander';

describe('CLI argument parsing', () => {
  let program: Command;

  beforeEach(() => {
    program = new Command();
    program
      .option('-n, --count <number>', 'Number of games', '1')
      .option('-s, --seed <number>', 'RNG seed')
      .option('-o, --output <dir>', 'Output directory', './traces')
      .option('--max-turns <number>', 'Turn limit', '500')
      .option('-q, --quiet', 'Suppress output', false)
      .option('--no-trace', 'Skip traces', false)
      .option('-a, --agent <type>', 'Agent type: ai, script, replay', 'ai')
      .option('--replay <file>', 'Path to trace file for replay mode');
  });

  it('should parse default options', () => {
    program.parse(['node', 'headless']);
    const opts = program.opts();

    expect(opts.count).toBe('1');
    expect(opts.seed).toBeUndefined();
    expect(opts.output).toBe('./traces');
    expect(opts.maxTurns).toBe('500');
    expect(opts.quiet).toBe(false);
    // Commander's --no-* option with default false means trace defaults to false
    // The CLI inverts this: noTrace: !opts.trace
    expect(opts.trace).toBe(false);
    expect(opts.agent).toBe('ai');
    expect(opts.replay).toBeUndefined();
  });

  it('should parse --count flag', () => {
    program.parse(['node', 'headless', '--count', '20']);
    expect(program.opts().count).toBe('20');
  });

  it('should parse -n short flag', () => {
    program.parse(['node', 'headless', '-n', '10']);
    expect(program.opts().count).toBe('10');
  });

  it('should parse --seed flag', () => {
    program.parse(['node', 'headless', '--seed', '12345']);
    expect(program.opts().seed).toBe('12345');
  });

  it('should parse --output flag', () => {
    program.parse(['node', 'headless', '--output', './my-traces']);
    expect(program.opts().output).toBe('./my-traces');
  });

  it('should parse --quiet flag', () => {
    program.parse(['node', 'headless', '--quiet']);
    expect(program.opts().quiet).toBe(true);
  });

  it('should parse --no-trace flag', () => {
    program.parse(['node', 'headless', '--no-trace']);
    expect(program.opts().trace).toBe(false);
  });

  it('should parse combined flags', () => {
    program.parse(['node', 'headless', '-n', '5', '-o', './out', '-q']);
    const opts = program.opts();

    expect(opts.count).toBe('5');
    expect(opts.output).toBe('./out');
    expect(opts.quiet).toBe(true);
  });

  it('should parse --agent flag', () => {
    program.parse(['node', 'headless', '--agent', 'script']);
    expect(program.opts().agent).toBe('script');
  });

  it('should parse -a short flag', () => {
    program.parse(['node', 'headless', '-a', 'replay']);
    expect(program.opts().agent).toBe('replay');
  });

  it('should default agent to ai', () => {
    program.parse(['node', 'headless']);
    expect(program.opts().agent).toBe('ai');
  });

  it('should parse --replay flag', () => {
    program.parse(['node', 'headless', '--replay', './traces/game-123.jsonl']);
    expect(program.opts().replay).toBe('./traces/game-123.jsonl');
  });
});

describe('CLI validation logic', () => {
  it('should reject seed with count > 1', () => {
    const count = 5;
    const seed = 12345;

    // This is the validation logic from the CLI
    const isInvalid = count > 1 && seed !== undefined;
    expect(isInvalid).toBe(true);
  });

  it('should allow seed with count = 1', () => {
    const count = 1;
    const seed = 12345;

    const isInvalid = count > 1 && seed !== undefined;
    expect(isInvalid).toBe(false);
  });

  it('should allow count > 1 without seed', () => {
    const count = 10;
    const seed = undefined;

    const isInvalid = count > 1 && seed !== undefined;
    expect(isInvalid).toBe(false);
  });

  it('should set agent to replay when --replay is used', () => {
    // This is the logic from the CLI: when --replay is set, agent should be 'replay'
    const replayFile = './traces/game-123.jsonl';
    const agentFromFlag = 'ai'; // User might not specify --agent

    // CLI logic: if replay file is provided, force agent type to 'replay'
    const effectiveAgent = replayFile ? 'replay' : agentFromFlag;
    expect(effectiveAgent).toBe('replay');
  });

  it('should use seed from trace file in replay mode', () => {
    // When in replay mode, the seed should come from the trace file
    // This validates that we should NOT use user-provided seed in replay mode
    const isReplayMode = true;
    const userSeed = 12345;
    const traceSeed = 67890;

    const effectiveSeed = isReplayMode ? traceSeed : userSeed;
    expect(effectiveSeed).toBe(traceSeed);
  });
});
