#!/usr/bin/env node
import { createServer } from './server.js';
import { logger } from './utils/logger.js';
import { loadConfigFromEnv, parseConfig } from './config/schema.js';
import { DEFAULT_CONFIG } from './config/defaults.js';
import { runSetup } from './adapters/generic.js';
import { doctorTool } from './tools/doctor.js';
import { statsReportTool } from './tools/stats-report.js';
import { handleHook } from './hooks/handler.js';
import { startLifecycleGuard } from './runtime/lifecycle.js';

function applyRuntimeConfig(): void {
  const merged = parseConfig(loadConfigFromEnv());
  Object.assign(DEFAULT_CONFIG.compression, merged.compression);
  Object.assign(DEFAULT_CONFIG.sandbox, merged.sandbox);
  Object.assign(DEFAULT_CONFIG.security, merged.security);
  Object.assign(DEFAULT_CONFIG.storage, merged.storage);
  Object.assign(DEFAULT_CONFIG.tokens, merged.tokens);
  Object.assign(DEFAULT_CONFIG.logging, merged.logging);
  Object.assign(DEFAULT_CONFIG.stats, merged.stats);
  Object.assign(DEFAULT_CONFIG.knowledgeBase, merged.knowledgeBase);
  Object.assign(DEFAULT_CONFIG.web, merged.web);
  logger.setLevel(merged.logging.level);
}

applyRuntimeConfig();

const args = process.argv.slice(2);

if (args[0] === 'setup') {
  const ide = args[1] as string | undefined;
  const enableHooks = args.includes('--hooks');
  runSetup(ide, enableHooks).catch(err => {
    logger.error('Setup failed', err);
    process.exit(1);
  });
} else if (args[0] === 'doctor') {
  console.log(doctorTool({ response_mode: 'full' }));
} else if (args[0] === 'stats') {
  console.log(statsReportTool({ response_mode: 'full' }));
} else if (args[0] === 'hook') {
  const host = args[1] ?? '';
  const event = args[2] ?? '';
  let stdin = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    stdin += chunk;
  });
  process.stdin.on('end', () => {
    process.stdout.write(handleHook(host, event, stdin));
  });
  process.stdin.resume();
} else {
  startServer().catch(err => {
    logger.error('Server failed to start', err);
    process.exit(1);
  });
}

async function startServer() {
  logger.info('Starting kanso-context-mode MCP server', { pid: process.pid });
  const { server, transport } = createServer();
  await server.connect(transport);
  logger.info('MCP server connected via stdio');

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Received ${signal}, shutting down`);
    try {
      await server.close();
    } catch (err) {
      logger.error('Failed to close server cleanly', {
        signal,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    process.exit(0);
  };

  process.on('uncaughtException', err => {
    logger.error('Uncaught exception', { error: err.message, stack: err.stack });
    process.exit(1);
  });

  process.on('unhandledRejection', reason => {
    logger.error('Unhandled rejection', {
      reason: reason instanceof Error ? reason.message : String(reason),
    });
    process.exit(1);
  });

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  startLifecycleGuard({
    onShutdown: () => {
      void shutdown('parent-exit');
    },
  });
}
