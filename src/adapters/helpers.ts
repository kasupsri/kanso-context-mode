import { access, mkdir, readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function ensureParent(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
}

export async function writeTextFile(path: string, content: string): Promise<void> {
  await ensureParent(path);
  await writeFile(path, content, 'utf8');
}

export async function readTextFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

export async function upsertManagedBlock(
  path: string,
  marker: string,
  block: string
): Promise<void> {
  const start = `<!-- ${marker}:start -->`;
  const end = `<!-- ${marker}:end -->`;
  const managed = `${start}\n${block.trim()}\n${end}`;
  const existing = await readTextFile(path);

  if (!existing) {
    await writeTextFile(path, `${managed}\n`);
    return;
  }

  const pattern = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`, 'm');
  const next = pattern.test(existing)
    ? existing.replace(pattern, managed)
    : `${existing.trimEnd()}\n\n${managed}\n`;
  await writeTextFile(path, next);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
