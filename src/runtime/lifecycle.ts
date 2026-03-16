export interface LifecycleGuardOptions {
  checkIntervalMs?: number;
  onShutdown: () => void | Promise<void>;
  isParentAlive?: () => boolean;
}

const originalParentPid = process.ppid;

function defaultIsParentAlive(): boolean {
  const ppid = process.ppid;
  if (ppid !== originalParentPid) return false;
  if (ppid === 0 || ppid === 1) return false;
  return true;
}

export function startLifecycleGuard(options: LifecycleGuardOptions): () => void {
  const interval = options.checkIntervalMs ?? 30_000;
  const isParentAlive = options.isParentAlive ?? defaultIsParentAlive;
  let stopped = false;

  const shutdown = () => {
    if (stopped) return;
    stopped = true;
    void options.onShutdown();
  };

  const timer = setInterval(() => {
    if (!isParentAlive()) shutdown();
  }, interval);
  timer.unref();

  const onStdinClose = () => shutdown();
  process.stdin.resume();
  process.stdin.on('end', onStdinClose);
  process.stdin.on('close', onStdinClose);
  process.stdin.on('error', onStdinClose);

  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  if (process.platform !== 'win32') {
    signals.push('SIGHUP');
  }
  for (const signal of signals) {
    process.on(signal, shutdown);
  }

  return () => {
    stopped = true;
    clearInterval(timer);
    process.stdin.removeListener('end', onStdinClose);
    process.stdin.removeListener('close', onStdinClose);
    process.stdin.removeListener('error', onStdinClose);
    for (const signal of signals) {
      process.removeListener(signal, shutdown);
    }
  };
}
