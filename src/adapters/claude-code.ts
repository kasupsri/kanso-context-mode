import { join } from 'path';
import { spawnSync } from 'child_process';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { type AdapterConfig, type BaseAdapter, type SetupResult } from './base-adapter.js';
import { pathExists, upsertManagedBlock, writeTextFile } from './helpers.js';

const CLAUDE_BLOCK = `# Kanso Context Mode

Use \`kanso-context-mode\` tools to minimize context usage.
- Prefer \`execute\` for commands with long output.
- Prefer \`read_file\`, \`read_symbols\`, and \`read_references\` for code navigation.
- Prefer \`workspace_search\` and \`tree_focus\` for repo exploration before broad reads.
- Prefer \`git_focus\` and \`diagnostics_focus\` for diffs and logs.
- Prefer \`terminal_history\` and \`run_focus\` for prior command output.
- Use \`web_search\` for grounded web research when configured.
- Use \`edit_targets\` before editing when the likely files are unclear.
- On a fresh or resumed conversation, call \`session_resume\` before re-reading large context.
- Default to \`response_mode: "minimal"\` and \`max_output_tokens: 400\`.
- Use \`stats_report\` to see estimated token savings.`;

function buildClaudeHookConfig(pkg: string): Record<string, unknown> {
  return {
    hooks: {
      PreToolUse: [
        {
          matcher: 'Bash|Read|Grep|WebFetch|Task',
          hooks: [{ type: 'command', command: `npx -y ${pkg} hook claude pretooluse` }],
        },
      ],
      PostToolUse: [
        {
          matcher: '',
          hooks: [{ type: 'command', command: `npx -y ${pkg} hook claude posttooluse` }],
        },
      ],
      PreCompact: [
        {
          matcher: '',
          hooks: [{ type: 'command', command: `npx -y ${pkg} hook claude precompact` }],
        },
      ],
      SessionStart: [
        {
          matcher: '',
          hooks: [{ type: 'command', command: `npx -y ${pkg} hook claude sessionstart` }],
        },
      ],
    },
  };
}

export class ClaudeCodeAdapter implements BaseAdapter {
  readonly ideName = 'Claude Code';
  readonly detectionPaths = ['.claude', 'CLAUDE.md'];

  async detect(cwd: string): Promise<boolean> {
    return (await pathExists(join(cwd, '.claude'))) || (await pathExists(join(cwd, 'CLAUDE.md')));
  }

  async setup(config: AdapterConfig): Promise<SetupResult> {
    const filesCreated: string[] = [];
    const claudePath = join(config.projectRoot, 'CLAUDE.md');
    await upsertManagedBlock(claudePath, 'kanso-context-mode', CLAUDE_BLOCK);
    filesCreated.push(claudePath);

    const installScriptPath = join(config.projectRoot, 'templates', 'claude-code', 'install.sh');
    const installScript = `#!/usr/bin/env bash\nset -euo pipefail\nclaude mcp add kanso-context-mode -- npx -y ${config.serverPackage}\nclaude mcp list\n`;
    await writeTextFile(installScriptPath, installScript);
    filesCreated.push(installScriptPath);

    if (config.enableHooks) {
      const claudeDir = join(config.projectRoot, '.claude');
      await mkdir(claudeDir, { recursive: true });
      const settingsPath = join(claudeDir, 'settings.local.json');
      let existing: Record<string, unknown> = {};
      try {
        existing = JSON.parse(await readFile(settingsPath, 'utf8')) as Record<string, unknown>;
      } catch {
        existing = {};
      }
      const merged = { ...existing, ...buildClaudeHookConfig(config.serverPackage) };
      await writeFile(settingsPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
      filesCreated.push(settingsPath);
    }

    return {
      ide: this.ideName,
      filesCreated,
      nextSteps: [
        spawnSync(
          'claude',
          ['mcp', 'add', 'kanso-context-mode', '--', 'npx', '-y', 'kanso-context-mode'],
          {
            stdio: 'ignore',
            windowsHide: true,
          }
        ).status === 0
          ? 'Claude MCP server registered automatically.'
          : 'Run: claude mcp add kanso-context-mode -- npx -y kanso-context-mode',
        'Verify: claude mcp list',
        config.enableHooks
          ? 'Open a new Claude Code session so the local hook config, `CLAUDE.md`, and automatic `session_resume` hints take effect.'
          : 'Re-run setup with `--hooks` later if you want stronger routing nudges.',
      ],
    };
  }
}
