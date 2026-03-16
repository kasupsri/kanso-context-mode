import { describe, expect, it } from 'vitest';
import { optimizeResponse } from '../../../src/compression/response-optimizer.js';
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
});
