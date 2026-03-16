import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { workspaceSearchTool } from '../../../src/tools/workspace-search.js';
import { treeFocusTool } from '../../../src/tools/tree-focus.js';
import { editTargetsTool } from '../../../src/tools/edit-targets.js';
import { cleanupTempStateDir, useTempStateDir } from '../test-helpers.js';

let stateDir: string | undefined;

afterEach(() => cleanupTempStateDir(stateDir));

describe('workspace tools', () => {
  it('searches the workspace and returns a reusable context link', async () => {
    stateDir = useTempStateDir('kcm-workspace-');
    const root = mkdtempSync(join(tmpdir(), 'kcm-workspace-root-'));
    writeFileSync(
      join(root, 'app.ts'),
      ['export function loadBudget() {', '  return "token budget";', '}'].join('\n'),
      'utf8'
    );
    writeFileSync(join(root, 'notes.md'), 'token budget notes', 'utf8');

    const result = await workspaceSearchTool({
      root_path: root,
      query: 'token budget',
      response_mode: 'full',
    });

    expect(result.text).toContain('Workspace Search');
    expect(result.resourceLinks?.some(link => link.uri.startsWith('context://'))).toBe(true);
  });

  it('summarizes tree structure and ranks edit targets', async () => {
    stateDir = useTempStateDir('kcm-edit-');
    const root = mkdtempSync(join(tmpdir(), 'kcm-edit-root-'));
    mkdirSync(join(root, 'src'));
    writeFileSync(
      join(root, 'src', 'billing.ts'),
      ['export function calculateInvoice() {', '  return 42;', '}'].join('\n'),
      'utf8'
    );
    writeFileSync(
      join(root, 'src', 'profile.ts'),
      ['export function updateProfile() {', '  return true;', '}'].join('\n'),
      'utf8'
    );

    const tree = await treeFocusTool({ path: root, response_mode: 'full' });
    expect(tree).toContain('billing.ts');

    const targets = await editTargetsTool({
      task: 'update billing invoice logic',
      paths: [root],
      response_mode: 'full',
    });
    expect(targets.text).toContain('billing.ts');
  });
});
