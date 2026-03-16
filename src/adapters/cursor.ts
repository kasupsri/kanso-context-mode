import { join } from 'path';
import { access, mkdir, writeFile } from 'fs/promises';
import { type AdapterConfig, type BaseAdapter, type SetupResult } from './base-adapter.js';
import { writeTextFile } from './helpers.js';

const CURSOR_RULES = `---
description: Route large-output work through kanso-context-mode
globs: ["**/*"]
alwaysApply: true
---

Use \`kanso-context-mode\` tools for token-efficient coding workflows.
- Prefer \`execute\` for shell commands with large output.
- Prefer \`read_file\`, \`read_symbols\`, and \`read_references\` for large files.
- Prefer \`workspace_search\` and \`tree_focus\` for repo exploration before broad reads.
- Prefer \`git_focus\` and \`diagnostics_focus\` for diffs and logs.
- Prefer \`terminal_history\` and \`run_focus\` for prior command output.
- Use \`web_search\` for grounded web research when configured.
- Use \`edit_targets\` before editing when the likely files are unclear.
- On a fresh chat, call \`session_resume\` before re-reading large project state.
- Default to \`response_mode: "minimal"\` and \`max_output_tokens: 400\`.
- Use \`stats_report\` to verify estimated token savings.`;

const MCP_CONFIG = (pkg: string) =>
  JSON.stringify(
    {
      mcpServers: {
        'kanso-context-mode': {
          command: 'npx',
          args: ['-y', pkg],
        },
      },
    },
    null,
    2
  ) + '\n';

const HOOK_CONFIG = (pkg: string) =>
  JSON.stringify(
    {
      version: 1,
      hooks: {
        preToolUse: [
          {
            command: `npx -y ${pkg} hook cursor pretooluse`,
            matcher:
              'Shell|Read|Grep|WebFetch|Task|MCP:read_file|MCP:read_symbols|MCP:read_references|MCP:workspace_search|MCP:tree_focus|MCP:git_focus|MCP:diagnostics_focus|MCP:terminal_history|MCP:run_focus|MCP:web_search|MCP:edit_targets|MCP:session_resume',
            failClosed: false,
          },
        ],
        postToolUse: [
          {
            command: `npx -y ${pkg} hook cursor posttooluse`,
            failClosed: false,
          },
        ],
      },
    },
    null,
    2
  ) + '\n';

export class CursorAdapter implements BaseAdapter {
  readonly ideName = 'Cursor';
  readonly detectionPaths = ['.cursor'];

  async detect(cwd: string): Promise<boolean> {
    try {
      await access(join(cwd, '.cursor'));
      return true;
    } catch {
      return false;
    }
  }

  async setup(config: AdapterConfig): Promise<SetupResult> {
    const filesCreated: string[] = [];
    const cursorDir = join(config.projectRoot, '.cursor');
    const rulesDir = join(cursorDir, 'rules');
    await mkdir(rulesDir, { recursive: true });

    const mcpPath = join(cursorDir, 'mcp.json');
    await writeFile(mcpPath, MCP_CONFIG(config.serverPackage), 'utf8');
    filesCreated.push(mcpPath);

    const rulesPath = join(rulesDir, 'kanso-context-mode.mdc');
    await writeTextFile(rulesPath, CURSOR_RULES + '\n');
    filesCreated.push(rulesPath);

    if (config.enableHooks) {
      const hooksPath = join(cursorDir, 'hooks.json');
      await writeFile(hooksPath, HOOK_CONFIG(config.serverPackage), 'utf8');
      filesCreated.push(hooksPath);
    }

    return {
      ide: this.ideName,
      filesCreated,
      nextSteps: [
        'Restart Cursor to reload MCP servers.',
        'Open the MCP panel and confirm `kanso-context-mode` is connected.',
        config.enableHooks
          ? 'Cursor hooks are installed and the rules file now nudges the agent to call `session_resume` at the start of a fresh conversation.'
          : 'Install again with `--hooks` later if you want stronger routing nudges.',
      ],
    };
  }
}
