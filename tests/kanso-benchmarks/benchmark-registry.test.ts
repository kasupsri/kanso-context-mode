import { describe, expect, it } from 'vitest';
import { TOOLS } from '../../src/server.js';
import { BENCHMARK_SCENARIOS } from '../../scripts/benchmark-scenarios.js';

describe('benchmark registry coverage', () => {
  it('covers every exposed Kanso tool exactly once', () => {
    const toolNames = TOOLS.map(tool => tool.name).sort();
    const scenarioNames = BENCHMARK_SCENARIOS.map(scenario => scenario.tool).sort();

    expect(scenarioNames).toEqual(toolNames);
  });
});
