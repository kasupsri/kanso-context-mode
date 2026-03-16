import { cwd } from 'process';
import { type BaseAdapter } from './base-adapter.js';
import { ClaudeCodeAdapter } from './claude-code.js';
import { CodexAdapter } from './codex.js';
import { CursorAdapter } from './cursor.js';

const ADAPTERS: BaseAdapter[] = [new CursorAdapter(), new ClaudeCodeAdapter(), new CodexAdapter()];
const SERVER_PACKAGE = 'kanso-context-mode';

async function detectIde(projectRoot: string): Promise<BaseAdapter | null> {
  for (const adapter of ADAPTERS) {
    if (await adapter.detect(projectRoot)) return adapter;
  }
  return null;
}

export async function runSetup(ideHint?: string, enableHooks = false): Promise<void> {
  const projectRoot = cwd();
  const config = { projectRoot, serverPackage: SERVER_PACKAGE, enableHooks };

  let adapter: BaseAdapter | null = null;
  if (ideHint && ideHint !== 'auto') {
    const hint = ideHint.toLowerCase();
    adapter = ADAPTERS.find(candidate => candidate.ideName.toLowerCase().includes(hint)) ?? null;
    if (!adapter) {
      console.error(`Unknown IDE: ${ideHint}`);
      console.error(
        `Available: ${ADAPTERS.map(item => item.ideName.toLowerCase()).join(', ')}, auto`
      );
      process.exit(1);
    }
  } else {
    adapter = await detectIde(projectRoot);
  }

  if (!adapter) {
    console.log('No supported project metadata detected.');
    console.log('Try one of:');
    console.log('  kanso-context-mode setup codex');
    console.log('  kanso-context-mode setup cursor');
    console.log('  kanso-context-mode setup claude');
    return;
  }

  console.log(`Setting up ${SERVER_PACKAGE} for ${adapter.ideName}...`);
  const result = await adapter.setup(config);
  if (result.filesCreated.length > 0) {
    console.log('\nFiles created/updated:');
    for (const file of result.filesCreated) {
      console.log(`  - ${file}`);
    }
  }
  console.log('\nNext steps:');
  for (const step of result.nextSteps) {
    console.log(`  ${step}`);
  }
}
