import { describe, expect, it } from 'vitest';
import { executeTool } from '../../../src/tools/execute.js';
import { getRuntimeForLanguage } from '../../../src/sandbox/runtimes.js';

const rustTest = getRuntimeForLanguage('rust') ? it : it.skip;

describe('execute rust', () => {
  rustTest('compiles and runs rust code', async () => {
    const result = await executeTool({
      language: 'rust',
      code: 'fn main() { println!("hello-rust"); }',
      response_mode: 'full',
    });

    expect(result).toContain('hello-rust');
  });
});
