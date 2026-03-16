import { describe, expect, it } from 'vitest';
import { optimizeResponse } from '../../../src/compression/response-optimizer.js';
import { compress } from '../../../src/compression/strategies.js';
import { DEFAULT_CONFIG } from '../../../src/config/defaults.js';

function minValidTokens(result: ReturnType<typeof optimizeResponse>): number {
  const valid = result.candidates.filter(candidate => candidate.valid);
  return valid.length === 0
    ? result.outputTokens
    : Math.min(...valid.map(candidate => candidate.outputTokens));
}

describe('optimizeResponse', () => {
  it('selects the minimum-token valid candidate', () => {
    const text = Array.from({ length: 250 }, (_, i) => `Line ${i}: value ${i * 3}`).join('\n');
    const result = optimizeResponse(text, {
      maxOutputTokens: 120,
      intent: 'errors and warnings',
      preferredStrategy: 'summarize',
      toolName: 'execute',
    });

    expect(result.outputTokens).toBe(minValidTokens(result));
  });

  it('enforces output budget', () => {
    const text = 'abcdefghijklmnopqrstuvwxyz'.repeat(200);
    const result = optimizeResponse(text, { maxOutputTokens: 40, toolName: 'read_file' });

    expect(result.outputTokens).toBeLessThanOrEqual(40);
    expect(result.budgetForced).toBe(true);
  });

  it('retains an error marker when the input is error-like', () => {
    const text = 'Error: command failed\nSTDERR:\nconnection refused\n[Exit code: 1]';
    const result = optimizeResponse(text, {
      maxOutputTokens: 4,
      toolName: 'execute',
      isError: true,
    });

    expect(/error|stderr|exit code|timeout/i.test(result.output)).toBe(true);
  });

  it('applies the default token budget when none is provided', () => {
    const text = 'x'.repeat(10000);
    const result = optimizeResponse(text, { toolName: 'execute' });
    expect(result.budgetTokens).toBe(DEFAULT_CONFIG.compression.defaultMaxOutputTokens);
  });

  it('preserves valid minimal outputs instead of recompressing them', () => {
    const text = [
      'search n=3 q="Large JSON 99% overflow-96 token window" kb=stress-kb',
      '1. s=0.10 src=bench.md h=Kanso Compression Benchmarks',
      'Large JSON saved 99% with the ultra strategy.',
      '2. s=0.20 src=bench.md h=Development Workflow Benchmarks',
      'balanced overflow-96 token window benchmark hit 34436 ops/sec.',
    ].join('\n');
    const result = optimizeResponse(text, {
      maxOutputTokens: 400,
      toolName: 'search',
      responseMode: 'minimal',
    });

    expect(result.output).toBe(text);
    expect(result.changed).toBe(false);
  });

  it('does not misclassify line-numbered file excerpts as csv', () => {
    const text = ['1| # Heading', '2| ', '3| import { x } from "./y";', '4| const z = 1;'].join(
      '\n'
    );
    const result = compress(text, { strategy: 'ultra', maxOutputChars: 120 });

    expect(result.contentType).not.toBe('csv');
    expect(result.output).not.toMatch(/^csv rows=/);
  });
});
