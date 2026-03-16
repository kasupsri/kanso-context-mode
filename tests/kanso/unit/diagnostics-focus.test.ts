import { describe, expect, it } from 'vitest';
import { diagnosticsFocusTool } from '../../../src/tools/diagnostics-focus.js';

describe('diagnostics_focus', () => {
  it('falls back to auto-detection for unknown formats and captures compiler/test failures', () => {
    const result = diagnosticsFocusTool({
      content: [
        "src/demo.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.",
        'error TS2554: Expected 2 arguments, but got 1.',
        'FAIL tests/demo.test.ts',
        '  × fails fast',
        '  ● demo › fails fast',
      ].join('\n'),
      format: 'bullets' as never,
      response_mode: 'full',
    });

    expect(result).toContain('TS2322');
    expect(result).toContain('TS2554');
    expect(result).toContain('FAIL tests/demo.test.ts');
    expect(result).toContain('fails fast');
  });
});
