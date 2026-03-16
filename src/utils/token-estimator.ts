import { getEncoding } from 'js-tiktoken';
import { DEFAULT_CONFIG, type TokenProfile } from '../config/defaults.js';

const AVG_CHARS_PER_TOKEN = 4;
const CODE_CHARS_PER_TOKEN = 3;

export type TokenMethod = 'tiktoken' | 'heuristic';

export interface TokenEstimate {
  tokens: number;
  characters: number;
  ratio: number;
  profile: Exclude<TokenProfile, 'auto'>;
  method: TokenMethod;
}

export interface ResolvedTokenProfile {
  requested: TokenProfile;
  active: Exclude<TokenProfile, 'auto'>;
  method: TokenMethod;
}

const ENCODING_BY_PROFILE: Record<Exclude<TokenProfile, 'auto' | 'generic'>, string> = {
  openai_o200k: 'o200k_base',
  openai_cl100k: 'cl100k_base',
};

const encoderCache = new Map<string, ReturnType<typeof getEncoding>>();
let cachedResolvedProfile: ResolvedTokenProfile | null = null;

function isCodeHeavy(text: string): boolean {
  const codeIndicators = ['{', '}', '=>', '::', '()', '[]', '#!/', 'function ', 'class '];
  return codeIndicators.filter(indicator => text.includes(indicator)).length >= 3;
}

function heuristicEstimate(text: string): TokenEstimate {
  const characters = text.length;
  const ratio = isCodeHeavy(text) ? CODE_CHARS_PER_TOKEN : AVG_CHARS_PER_TOKEN;
  const tokens = Math.ceil(characters / ratio);
  return {
    tokens,
    characters,
    ratio,
    profile: 'generic',
    method: 'heuristic',
  };
}

function loadEncoding(name: string): ReturnType<typeof getEncoding> | null {
  const cached = encoderCache.get(name);
  if (cached) return cached;

  try {
    const encoding = getEncoding(name as never);
    encoderCache.set(name, encoding);
    return encoding;
  } catch {
    return null;
  }
}

export function resolveTokenProfile(
  requested: TokenProfile = DEFAULT_CONFIG.tokens.profile
): ResolvedTokenProfile {
  if (cachedResolvedProfile && cachedResolvedProfile.requested === requested) {
    return cachedResolvedProfile;
  }

  const explicit = requested === 'auto' ? 'openai_o200k' : requested;
  if (explicit !== 'generic') {
    const encodingName = ENCODING_BY_PROFILE[explicit];
    const encoder = loadEncoding(encodingName);
    if (encoder) {
      cachedResolvedProfile = {
        requested,
        active: explicit,
        method: 'tiktoken',
      };
      return cachedResolvedProfile;
    }
  }

  cachedResolvedProfile = {
    requested,
    active: 'generic',
    method: 'heuristic',
  };
  return cachedResolvedProfile;
}

export function estimateTokens(
  text: string,
  requested: TokenProfile = DEFAULT_CONFIG.tokens.profile
): TokenEstimate {
  const resolved = resolveTokenProfile(requested);
  const characters = text.length;

  if (resolved.method === 'tiktoken' && resolved.active !== 'generic') {
    const encoding = loadEncoding(ENCODING_BY_PROFILE[resolved.active]);
    if (encoding) {
      const tokens = encoding.encode(text).length;
      return {
        tokens,
        characters,
        ratio: characters === 0 ? AVG_CHARS_PER_TOKEN : characters / Math.max(tokens, 1),
        profile: resolved.active,
        method: 'tiktoken',
      };
    }
  }

  return heuristicEstimate(text);
}

export function estimateTokensForMessages(messages: string[]): number {
  return messages.reduce((total, message) => total + estimateTokens(message).tokens, 0);
}

export function tokensToChars(tokens: number, isCode = false): number {
  return tokens * (isCode ? CODE_CHARS_PER_TOKEN : AVG_CHARS_PER_TOKEN);
}

export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M tokens`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K tokens`;
  return `${tokens} tokens`;
}

export function resetTokenEstimatorForTests(): void {
  cachedResolvedProfile = null;
}
