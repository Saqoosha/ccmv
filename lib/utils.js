import { createHash } from 'node:crypto';
import { statSync, existsSync, writeFileSync, utimesSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';

/**
 * Encode path for Claude projects directory
 * Rule: / -> -, : -> -, space -> -
 */
export function encodePath(path) {
  return path.replace(/[\/: ]/g, '-');
}

/**
 * Convert filesystem path to file:// URI with URL encoding
 */
export function pathToFileUri(path) {
  // URL encode the path, keeping / as safe character
  const encoded = path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `file://${encoded}`;
}

/**
 * Calculate VSCode/Cursor workspace hash from path
 * Hash = MD5(path + birthtime_ms)
 */
export function getWorkspaceHash(path) {
  if (!existsSync(path)) {
    return null;
  }

  try {
    const stat = statSync(path);
    const birthtimeMs = stat.birthtime.getTime();
    const hash = createHash('md5')
      .update(path)
      .update(String(birthtimeMs))
      .digest('hex');
    return hash;
  } catch {
    return null;
  }
}

/**
 * Resolve path to absolute, handling relative paths
 */
export function resolvePath(inputPath) {
  // Expand ~ to home directory
  if (inputPath.startsWith('~')) {
    inputPath = inputPath.replace(/^~/, process.env.HOME || '');
  }
  return resolve(inputPath).replace(/\/$/, ''); // Remove trailing slash
}

/**
 * Resolve new path (which may not exist yet)
 */
export function resolveNewPath(inputPath) {
  // Expand ~ to home directory
  if (inputPath.startsWith('~')) {
    inputPath = inputPath.replace(/^~/, process.env.HOME || '');
  }

  const parent = dirname(inputPath);
  const name = basename(inputPath);

  // Resolve parent (which should exist)
  const resolvedParent = resolve(parent);
  return `${resolvedParent}/${name}`.replace(/\/$/, '');
}

/**
 * Convert path to tilde form if under home directory
 */
export function pathToTilde(path) {
  const home = process.env.HOME || '';
  if (path.startsWith(home)) {
    return path.replace(home, '~');
  }
  return path;
}

/**
 * Write file content while preserving the original modification time.
 * Claude Code uses file mtime to sort sessions, so we must not alter it.
 * mtime restoration is best-effort — a write that succeeds but fails to
 * restore mtime is not treated as an error.
 */
export function writeFilePreserveMtime(filePath, content) {
  const stat = statSync(filePath);
  writeFileSync(filePath, content);
  try {
    utimesSync(filePath, stat.atime, stat.mtime);
  } catch {
    // mtime preservation is best-effort; the write itself succeeded
  }
}

/**
 * Format timestamp for backup directory
 */
export function formatTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}
