import { describe, expect, it } from 'vitest';
import {
  estimateTokens,
  estimateTokensForMessages,
  formatTokenCount,
  resolveTokenProfile,
  tokensToChars,
} from '../../../src/utils/token-estimator.js';

describe('token estimator', () => {
  it('estimates tokens for plain English text', () => {
    const text = 'The quick brown fox jumps over the lazy dog.';
    const result = estimateTokens(text, 'generic');
    expect(result.tokens).toBeGreaterThan(0);
    expect(result.characters).toBe(text.length);
    expect(result.method).toBe('heuristic');
  });

  it('uses tokenizer-backed counting when requested profile is available', () => {
    const result = estimateTokens('console.log("hello");', 'openai_cl100k');
    expect(result.tokens).toBeGreaterThan(0);
    expect(['tiktoken', 'heuristic']).toContain(result.method);
  });

  it('resolves auto profile without throwing', () => {
    const profile = resolveTokenProfile('auto');
    expect(['openai_o200k', 'generic']).toContain(profile.active);
  });

  it('sums token estimates across messages', () => {
    const messages = ['Hello world', 'This is a test message', 'Another line'];
    const total = estimateTokensForMessages(messages);
    const sum = messages.reduce((acc, message) => acc + estimateTokens(message).tokens, 0);
    expect(total).toBe(sum);
  });

  it('converts token budgets to characters', () => {
    expect(tokensToChars(100, false)).toBe(400);
    expect(tokensToChars(100, true)).toBe(300);
  });

  it('formats token counts cleanly', () => {
    expect(formatTokenCount(500)).toBe('500 tokens');
    expect(formatTokenCount(1500)).toBe('1.5K tokens');
  });
});
