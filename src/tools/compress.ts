import { compress, type CompressionStrategy } from '../compression/strategies.js';
import { DEFAULT_CONFIG, type ResponseMode } from '../config/defaults.js';

export interface CompressToolInput {
  content: string;
  intent?: string;
  strategy?: CompressionStrategy;
  max_output_tokens?: number;
  response_mode?: ResponseMode;
}

export function compressTool(input: CompressToolInput): string {
  const mode = input.response_mode ?? DEFAULT_CONFIG.compression.responseMode;
  const strategy = input.strategy ?? (mode === 'minimal' ? 'ultra' : 'summarize');
  const maxChars =
    typeof input.max_output_tokens === 'number' &&
    Number.isFinite(input.max_output_tokens) &&
    input.max_output_tokens > 0
      ? Math.floor(input.max_output_tokens) * 3
      : undefined;

  return compress(input.content, {
    intent: input.intent,
    strategy,
    maxOutputChars: maxChars,
  }).output;
}
