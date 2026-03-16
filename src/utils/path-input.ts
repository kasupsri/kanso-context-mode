const WSL_MOUNT_PATH = /^\/mnt\/([a-zA-Z])\/(.*)$/;
const GIT_BASH_DRIVE_PATH = /^\/([a-zA-Z])\/(.*)$/;
const WINDOWS_DRIVE_PATH = /^[a-zA-Z]:[\\/]/;

function toWindowsPath(drive: string, rest: string): string {
  const normalizedRest = rest.replace(/\//g, '\\');
  return `${drive.toUpperCase()}:\\${normalizedRest}`;
}

export function normalizeIncomingPath(inputPath: string, platform = process.platform): string {
  const trimmed = inputPath.trim();
  if (!trimmed || platform !== 'win32') return trimmed;
  if (WINDOWS_DRIVE_PATH.test(trimmed) || trimmed.startsWith('\\\\')) return trimmed;

  const wsl = WSL_MOUNT_PATH.exec(trimmed);
  if (wsl?.[1]) {
    return toWindowsPath(wsl[1], wsl[2] ?? '');
  }

  const gitBash = GIT_BASH_DRIVE_PATH.exec(trimmed);
  if (gitBash?.[1]) {
    return toWindowsPath(gitBash[1], gitBash[2] ?? '');
  }

  return trimmed;
}
