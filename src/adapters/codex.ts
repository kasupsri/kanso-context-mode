import { spawnSync } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';
import { type AdapterConfig, type BaseAdapter, type SetupResult } from './base-adapter.js';
import { pathExists, upsertManagedBlock, writeTextFile, readTextFile } from './helpers.js';

const AGENTS_BLOCK = `# Kanso Context Mode

Use \`kanso-context-mode\` tools first for token-heavy tasks.
- Prefer \`execute\` instead of raw shell for long output.
- Prefer \`read_file\`, \`read_symbols\`, and \`read_references\` over dumping full files.
- Prefer \`workspace_search\` and \`tree_focus\` for repo exploration before broad reads.
- Prefer \`git_focus\` and \`diagnostics_focus\` for diffs and logs.
- Prefer \`terminal_history\` and \`run_focus\` for prior command output.
- Use \`web_search\` for grounded web research when configured.
- Use \`edit_targets\` before editing when target files are unclear.
- On a new session, call \`session_resume\` before reloading lots of context manually.
- Default to \`response_mode: "minimal"\` and \`max_output_tokens: 400\`.
- Use \`stats_report\` to see estimated token savings so far.`;

async function ensureCodexConfig(pkg: string): Promise<string> {
  const codexDir = join(homedir(), '.codex');
  const configPath = join(codexDir, 'config.toml');
  const blockHeader = '[mcp_servers.kanso-context-mode]';
  const block = [blockHeader, 'command = "npx"', `args = ["-y", "${pkg}"]`, ''].join('\n');

  const existing = (await readTextFile(configPath)) ?? '';
  if (!existing.includes(blockHeader)) {
    await writeTextFile(
      configPath,
      `${existing.trimEnd()}${existing.trim().length > 0 ? '\n\n' : ''}${block}`.trimEnd() + '\n'
    );
  }

  return configPath;
}

export class CodexAdapter implements BaseAdapter {
  readonly ideName = 'Codex';
  readonly detectionPaths = [];

  async detect(cwd: string): Promise<boolean> {
    return pathExists(join(cwd, 'AGENTS.md'));
  }

  async setup(config: AdapterConfig): Promise<SetupResult> {
    const filesCreated: string[] = [];
    const agentsPath = join(config.projectRoot, 'AGENTS.md');
    await upsertManagedBlock(agentsPath, 'kanso-context-mode', AGENTS_BLOCK);
    filesCreated.push(agentsPath);

    const codexResult = spawnSync(
      'codex',
      ['mcp', 'add', 'kanso-context-mode', '--', 'npx', '-y', config.serverPackage],
      {
        stdio: 'ignore',
        windowsHide: true,
      }
    );

    let codexConfigPath: string | null = null;
    if (codexResult.status !== 0) {
      codexConfigPath = await ensureCodexConfig(config.serverPackage);
      filesCreated.push(codexConfigPath);
    }

    return {
      ide: this.ideName,
      filesCreated,
      nextSteps: [
        codexResult.status === 0
          ? 'Codex MCP server registered automatically.'
          : `Codex CLI not available, wrote fallback config to ${codexConfigPath}.`,
        'Verify: codex mcp list',
        'Open a new Codex session in this project.',
      ],
    };
  }
}
