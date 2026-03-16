import { homedir } from 'os';
import { join } from 'path';
import { DEFAULT_CONFIG } from '../config/defaults.js';

/**
 * Build environment variables for sandboxed execution.
 * Keeps a minimal env by default. Auth credentials are only passed when enabled.
 */
export function buildSandboxEnv(
  additionalEnv?: Record<string, string>,
  allowAuthPassthrough = DEFAULT_CONFIG.sandbox.allowAuthPassthrough
): NodeJS.ProcessEnv {
  const home = homedir();
  const isWindows = process.platform === 'win32';

  const baseEnv: NodeJS.ProcessEnv = {
    // Core runtime environment
    HOME: home,
    PATH: process.env['PATH'] ?? (isWindows ? '' : '/usr/local/bin:/usr/bin:/bin'),
    LANG: process.env['LANG'] ?? 'en_US.UTF-8',
    TERM: 'dumb',
    USERPROFILE: process.env['USERPROFILE'] ?? home,
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONUNBUFFERED: '1',
    PYTHONUTF8: '1',
    NO_COLOR: '1',
    NODE_ENV: 'production',

    // User additions
    ...additionalEnv,
  };

  if (allowAuthPassthrough) {
    Object.assign(baseEnv, {
      // GitHub CLI
      GITHUB_TOKEN: process.env['GITHUB_TOKEN'],
      GH_TOKEN: process.env['GH_TOKEN'],
      GH_CONFIG_DIR: process.env['GH_CONFIG_DIR'] ?? join(home, '.config', 'gh'),

      // AWS
      AWS_ACCESS_KEY_ID: process.env['AWS_ACCESS_KEY_ID'],
      AWS_SECRET_ACCESS_KEY: process.env['AWS_SECRET_ACCESS_KEY'],
      AWS_SESSION_TOKEN: process.env['AWS_SESSION_TOKEN'],
      AWS_DEFAULT_REGION: process.env['AWS_DEFAULT_REGION'],
      AWS_PROFILE: process.env['AWS_PROFILE'],
      AWS_CONFIG_FILE: process.env['AWS_CONFIG_FILE'] ?? join(home, '.aws', 'config'),
      AWS_SHARED_CREDENTIALS_FILE:
        process.env['AWS_SHARED_CREDENTIALS_FILE'] ?? join(home, '.aws', 'credentials'),

      // Google Cloud
      GOOGLE_APPLICATION_CREDENTIALS: process.env['GOOGLE_APPLICATION_CREDENTIALS'],
      CLOUDSDK_CONFIG: process.env['CLOUDSDK_CONFIG'] ?? join(home, '.config', 'gcloud'),
      GOOGLE_CLOUD_PROJECT: process.env['GOOGLE_CLOUD_PROJECT'],

      // Kubernetes
      KUBECONFIG: process.env['KUBECONFIG'] ?? join(home, '.kube', 'config'),

      // Docker
      DOCKER_CONFIG: process.env['DOCKER_CONFIG'] ?? join(home, '.docker'),
      DOCKER_HOST: process.env['DOCKER_HOST'],

      // Node/npm + Python
      NPM_CONFIG_USERCONFIG: process.env['NPM_CONFIG_USERCONFIG'],
      PYTHONPATH: process.env['PYTHONPATH'],
      VIRTUAL_ENV: process.env['VIRTUAL_ENV'],
    });
  }

  if (isWindows) {
    const windowsVars = [
      'SYSTEMROOT',
      'SystemRoot',
      'COMSPEC',
      'PATHEXT',
      'APPDATA',
      'LOCALAPPDATA',
      'TEMP',
      'TMP',
      'ProgramData',
    ];
    for (const key of windowsVars) {
      if (process.env[key]) {
        baseEnv[key] = process.env[key];
      }
    }
  }

  // Remove undefined values
  const cleaned: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (value !== undefined && value !== null) {
      cleaned[key] = value;
    }
  }

  return cleaned;
}
