import { compress, type CompressionStrategy } from './strategies.js';
import { DEFAULT_CONFIG, type ResponseMode } from '../config/defaults.js';
import { estimateTokens } from '../utils/token-estimator.js';

export interface OptimizeResponseOptions {
  intent?: string;
  maxOutputTokens?: number;
  preferredStrategy?: CompressionStrategy;
  toolName?: string;
  isError?: boolean;
  responseMode?: ResponseMode;
}

export interface OptimizationCandidate {
  label: string;
  strategy: CompressionStrategy;
  output: string;
  outputChars: number;
  outputTokens: number;
  withinBudget: boolean;
  withinTokenBudget: boolean;
  nonEmpty: boolean;
  keepsErrorMarker: boolean;
  valid: boolean;
}

export interface OptimizeResponseResult {
  output: string;
  chosenStrategy: CompressionStrategy;
  inputTokens: number;
  outputTokens: number;
  budgetChars: number;
  budgetTokens: number;
  budgetForced: boolean;
  changed: boolean;
  candidates: OptimizationCandidate[];
}

const DEFAULT_CHARS_PER_TOKEN = 3;
const SMALL_FAST_PATH_CHARS = 256;
const ERROR_MARKERS = ['Error', 'STDERR', 'Exit code', 'TIMEOUT'] as const;
const STRATEGY_ORDER: Record<CompressionStrategy, number> = {
  ultra: 0,
  filter: 1,
  summarize: 2,
  truncate: 3,
  auto: 4,
  'as-is': 5,
};

function resolveBudgetTokens(maxOutputTokens?: number): number {
  const configuredDefault = DEFAULT_CONFIG.compression.defaultMaxOutputTokens;
  const configuredHard = DEFAULT_CONFIG.compression.hardMaxOutputTokens;
  const defaultTokens =
    Number.isFinite(configuredDefault) && configuredDefault > 0
      ? Math.floor(configuredDefault)
      : 400;
  const hardCap =
    Number.isFinite(configuredHard) && configuredHard > 0 ? Math.floor(configuredHard) : 800;
  const requested =
    typeof maxOutputTokens === 'number' && Number.isFinite(maxOutputTokens) && maxOutputTokens > 0
      ? Math.floor(maxOutputTokens)
      : defaultTokens;

  return Math.max(1, Math.min(requested, hardCap));
}

function resolveBudget(maxOutputTokens?: number): { budgetTokens: number; budgetChars: number } {
  const budgetTokens = resolveBudgetTokens(maxOutputTokens);
  let budgetChars = Math.max(1, Math.floor(budgetTokens * DEFAULT_CHARS_PER_TOKEN));
  const configuredBytes = DEFAULT_CONFIG.compression.maxOutputBytes;
  if (Number.isFinite(configuredBytes) && configuredBytes > 0) {
    budgetChars = Math.max(1, Math.min(budgetChars, Math.floor(configuredBytes)));
  }
  return { budgetTokens, budgetChars };
}

function clampToBudget(text: string, budgetChars: number): string {
  return text.length <= budgetChars ? text : text.slice(0, budgetChars);
}

function clampToTokenBudget(text: string, budgetTokens: number, budgetChars: number): string {
  const clampedChars = clampToBudget(text, budgetChars);
  if (estimateTokens(clampedChars).tokens <= budgetTokens) {
    return clampedChars;
  }

  let low = 0;
  let high = clampedChars.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = clampedChars.slice(0, mid);
    if (estimateTokens(candidate).tokens <= budgetTokens) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return clampedChars.slice(0, low);
}

function getPresentErrorMarkers(text: string): string[] {
  const normalized = text.toLowerCase();
  return ERROR_MARKERS.filter(marker => normalized.includes(marker.toLowerCase()));
}

function keepsAnyMarker(text: string, markers: string[]): boolean {
  if (markers.length === 0) return true;
  const normalized = text.toLowerCase();
  return markers.some(marker => normalized.includes(marker.toLowerCase()));
}

function bestErrorMarker(markers: string[], budgetChars: number): string | null {
  const fitting = markers.filter(marker => marker.length <= budgetChars);
  if (fitting.length === 0) return null;
  return fitting.sort((a, b) => a.length - b.length)[0] ?? null;
}

function asCandidate(
  label: string,
  strategy: CompressionStrategy,
  output: string,
  budgetChars: number,
  budgetTokens: number,
  requireNonEmpty: boolean,
  enforceErrorMarkers: boolean,
  markers: string[]
): OptimizationCandidate {
  const outputChars = output.length;
  const outputTokens = estimateTokens(output).tokens;
  const withinBudget = outputChars <= budgetChars;
  const withinTokenBudget = outputTokens <= budgetTokens;
  const nonEmpty = output.length > 0;
  const keepsErrorMarker = keepsAnyMarker(output, markers);
  const valid =
    withinBudget &&
    withinTokenBudget &&
    (!requireNonEmpty || nonEmpty) &&
    (!enforceErrorMarkers || keepsErrorMarker);

  return {
    label,
    strategy,
    output,
    outputChars,
    outputTokens,
    withinBudget,
    withinTokenBudget,
    nonEmpty,
    keepsErrorMarker,
    valid,
  };
}

function compareCandidates(a: OptimizationCandidate, b: OptimizationCandidate): number {
  if (a.outputTokens !== b.outputTokens) return a.outputTokens - b.outputTokens;
  if (a.outputChars !== b.outputChars) return a.outputChars - b.outputChars;
  const ar = STRATEGY_ORDER[a.strategy] ?? Number.MAX_SAFE_INTEGER;
  const br = STRATEGY_ORDER[b.strategy] ?? Number.MAX_SAFE_INTEGER;
  if (ar !== br) return ar - br;
  return a.label.localeCompare(b.label);
}

function buildFallbackCandidate(
  text: string,
  budgetChars: number,
  budgetTokens: number,
  markers: string[],
  requireNonEmpty: boolean,
  enforceErrorMarkers: boolean
): OptimizationCandidate {
  let output = clampToTokenBudget(text, budgetTokens, budgetChars);

  if (!output && text.length > 0) {
    output = text.slice(0, 1);
  }

  if (enforceErrorMarkers && !keepsAnyMarker(output, markers)) {
    const marker = bestErrorMarker(markers, budgetChars);
    if (marker) {
      output = marker;
    }
  }

  return asCandidate(
    'fallback-clamp',
    'truncate',
    output,
    budgetChars,
    budgetTokens,
    requireNonEmpty,
    false,
    markers
  );
}

export function optimizeResponse(
  text: string,
  options: OptimizeResponseOptions = {}
): OptimizeResponseResult {
  const { budgetTokens, budgetChars } = resolveBudget(options.maxOutputTokens);
  const responseMode = options.responseMode ?? DEFAULT_CONFIG.compression.responseMode;
  const inputTokens = estimateTokens(text).tokens;
  const presentMarkers = options.isError ? getPresentErrorMarkers(text) : [];
  const minMarkerChars = presentMarkers.reduce(
    (min, marker) => Math.min(min, marker.length),
    Number.MAX_SAFE_INTEGER
  );
  const enforceErrorMarkers =
    Boolean(options.isError) &&
    presentMarkers.length > 0 &&
    budgetChars >= (Number.isFinite(minMarkerChars) ? minMarkerChars : 0);
  const requireNonEmpty = text.length > 0;

  const candidates: OptimizationCandidate[] = [];
  const seen = new Set<string>();

  const pushCandidate = (label: string, strategy: CompressionStrategy, rawOutput: string): void => {
    const key = `${strategy}\u0000${rawOutput}`;
    if (seen.has(key)) return;
    seen.add(key);
    const output = clampToTokenBudget(rawOutput, budgetTokens, budgetChars);
    candidates.push(
      asCandidate(
        label,
        strategy,
        output,
        budgetChars,
        budgetTokens,
        requireNonEmpty,
        enforceErrorMarkers,
        presentMarkers
      )
    );
  };

  pushCandidate('raw', 'as-is', text);
  const rawCandidate = candidates[0]!;

  const smallFastPath =
    rawCandidate.valid &&
    (responseMode === 'full' || rawCandidate.outputChars <= SMALL_FAST_PATH_CHARS);
  if (smallFastPath) {
    return {
      output: rawCandidate.output,
      chosenStrategy: rawCandidate.strategy,
      inputTokens,
      outputTokens: rawCandidate.outputTokens,
      budgetChars,
      budgetTokens,
      budgetForced: text.length > budgetChars || inputTokens > budgetTokens,
      changed: rawCandidate.output !== text,
      candidates,
    };
  }

  pushCandidate('hard-clamp', 'truncate', text);

  if (options.preferredStrategy) {
    const preferred = compress(text, {
      intent: options.intent,
      strategy: options.preferredStrategy,
      maxOutputChars: budgetChars,
    }).output;
    pushCandidate('preferred', options.preferredStrategy, preferred);
  }

  if (responseMode !== 'full') {
    const ultra = compress(text, {
      intent: options.intent,
      strategy: 'ultra',
      maxOutputChars: budgetChars,
    }).output;
    pushCandidate('ultra', 'ultra', ultra);
  }

  const summarize = compress(text, {
    intent: options.intent,
    strategy: 'summarize',
    maxOutputChars: budgetChars,
  }).output;
  pushCandidate('summarize', 'summarize', summarize);

  const truncate = compress(text, {
    intent: options.intent,
    strategy: 'truncate',
    maxOutputChars: budgetChars,
  }).output;
  pushCandidate('truncate', 'truncate', truncate);

  if (options.intent) {
    const filter = compress(text, {
      intent: options.intent,
      strategy: 'filter',
      maxOutputChars: budgetChars,
    }).output;
    pushCandidate('filter', 'filter', filter);
  }

  const valid = candidates.filter(candidate => candidate.valid);
  const ranked = valid.sort(compareCandidates);
  const chosen =
    ranked[0] ??
    buildFallbackCandidate(
      text,
      budgetChars,
      budgetTokens,
      presentMarkers,
      requireNonEmpty,
      enforceErrorMarkers
    );

  return {
    output: chosen.output,
    chosenStrategy: chosen.strategy,
    inputTokens,
    outputTokens: chosen.outputTokens,
    budgetChars,
    budgetTokens,
    budgetForced: text.length > budgetChars || inputTokens > budgetTokens,
    changed: chosen.output !== text,
    candidates,
  };
}
