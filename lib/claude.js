import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, renameSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { homedir } from 'node:os';
import { logInfo, logOk, logError, logBackup, logFile, logReplace, logRename, logDryrun, logRollback } from './logger.js';
import { encodePath, formatTimestamp } from './utils.js';

const CLAUDE_DIR = join(homedir(), '.claude');
const PROJECTS_DIR = join(CLAUDE_DIR, 'projects');
const HISTORY_FILE = join(CLAUDE_DIR, 'history.jsonl');

/**
 * Check if Claude Code project data exists
 * Returns true if exists, false if not (but doesn't fail - Cursor-only migration is OK)
 */
export function checkClaudeExists(encodedOld) {
  const oldProjectDir = join(PROJECTS_DIR, encodedOld);

  if (existsSync(oldProjectDir)) {
    logOk(`Claude project dir exists: ${oldProjectDir.replace(homedir(), '~')}/`);
    return true;
  } else {
    logInfo(`No Claude project data found (OK if Cursor-only)`);
    return false;
  }
}

/**
 * Create backup of Claude data
 */
export function createBackup(encodedOld, dryRun, claudeExists) {
  const timestamp = formatTimestamp();
  const backupDir = join(CLAUDE_DIR, 'backups', `ccmv-${timestamp}`);

  logBackup('Creating backups...');

  if (dryRun) {
    logDryrun(`Would create backup at: ${backupDir.replace(homedir(), '~')}/`);
    return backupDir;
  }

  mkdirSync(join(backupDir, 'projects'), { recursive: true });

  // Backup project directory (only if Claude data exists)
  if (claudeExists) {
    const oldProjectDir = join(PROJECTS_DIR, encodedOld);
    if (existsSync(oldProjectDir)) {
      cpSync(oldProjectDir, join(backupDir, 'projects', encodedOld), { recursive: true });
      logBackup(`${oldProjectDir.replace(homedir(), '~')}/ -> ${backupDir.replace(homedir(), '~')}/projects/`);
    }
  }

  // Backup history.jsonl
  if (existsSync(HISTORY_FILE)) {
    cpSync(HISTORY_FILE, join(backupDir, 'history.jsonl'));
    logBackup(`${HISTORY_FILE.replace(homedir(), '~')} -> ${backupDir.replace(homedir(), '~')}/history.jsonl`);
  }

  console.log('');
  return backupDir;
}

/**
 * Rename Claude projects directory
 */
export function renameClaudeDir(encodedOld, encodedNew, dryRun, claudeExists) {
  if (!claudeExists) return;

  const oldProjectDir = join(PROJECTS_DIR, encodedOld);
  const newProjectDir = join(PROJECTS_DIR, encodedNew);

  if (dryRun) {
    logDryrun(`Would rename: ${oldProjectDir.replace(homedir(), '~')}/ -> ${newProjectDir.replace(homedir(), '~')}/`);
    console.log('');
    return;
  }

  logRename(`${oldProjectDir.replace(homedir(), '~')}/ -> ${newProjectDir.replace(homedir(), '~')}/`);
  renameSync(oldProjectDir, newProjectDir);
  console.log('');
}

/**
 * Update all files containing cwd field in Claude projects directory
 */
export function updateProjectFiles(oldPath, newPath, encodedOld, encodedNew, dryRun, claudeExists) {
  if (!claudeExists) return;

  // For dry-run, use old path since rename hasn't happened yet
  const projectDir = dryRun
    ? join(PROJECTS_DIR, encodedOld)
    : join(PROJECTS_DIR, encodedNew);

  logInfo('Updating project files...');

  const cwdPattern = `"cwd":"${oldPath}"`;
  const cwdReplacement = `"cwd":"${newPath}"`;

  const filesToUpdate = findFilesWithContent(projectDir, cwdPattern);

  if (filesToUpdate.length === 0) {
    logInfo('No files with cwd field found');
    console.log('');
    return;
  }

  for (const file of filesToUpdate) {
    const relpath = relative(projectDir, file);
    const content = readFileSync(file, 'utf-8');
    const count = (content.match(new RegExp(escapeRegex(cwdPattern), 'g')) || []).length;

    if (count > 0) {
      logFile(relpath);

      if (dryRun) {
        logReplace(`${count} occurrences would be updated`);
      } else {
        const newContent = content.split(cwdPattern).join(cwdReplacement);
        writeFileSync(file, newContent);
        logReplace(`${count} occurrences updated`);
      }
    }
  }

  console.log('');
}

/**
 * Update global history file
 */
export function updateHistory(oldPath, newPath, dryRun) {
  if (!existsSync(HISTORY_FILE)) {
    logInfo('No global history file found');
    console.log('');
    return;
  }

  logInfo('Updating global history...');

  const cwdPattern = `"cwd":"${oldPath}"`;
  const cwdReplacement = `"cwd":"${newPath}"`;

  const content = readFileSync(HISTORY_FILE, 'utf-8');
  const count = (content.match(new RegExp(escapeRegex(cwdPattern), 'g')) || []).length;

  if (count > 0) {
    if (dryRun) {
      logReplace(`${count} entries would be updated`);
    } else {
      const newContent = content.split(cwdPattern).join(cwdReplacement);
      writeFileSync(HISTORY_FILE, newContent);
      logReplace(`${count} entries updated`);
    }
  } else {
    logInfo('No matching entries found in history');
  }

  console.log('');
}

/**
 * Verify the migration
 */
export function verifyClaude(oldPath, encodedNew, dryRun, claudeExists) {
  if (!claudeExists) return true;

  logInfo('Verifying Claude migration...');

  if (dryRun) {
    logDryrun('Verification skipped in dry-run mode');
    console.log('');
    return true;
  }

  const newProjectDir = join(PROJECTS_DIR, encodedNew);

  // Check new Claude projects dir exists
  if (existsSync(newProjectDir)) {
    logOk('New Claude project dir exists');
  } else {
    logError('New Claude project dir not found!');
    return false;
  }

  // Check JSONL files are valid (spot check first file)
  const jsonlFiles = findFiles(newProjectDir, /\.jsonl$/);
  if (jsonlFiles.length > 0) {
    const firstJsonl = jsonlFiles[0];
    try {
      const content = readFileSync(firstJsonl, 'utf-8');
      const firstLine = content.split('\n')[0];
      if (firstLine) {
        JSON.parse(firstLine);
      }
      logOk('JSONL files appear valid');
    } catch {
      logError(`JSONL file may be corrupted: ${firstJsonl}`);
      return false;
    }
  }

  // Verify no old path references remain
  const cwdPattern = `"cwd":"${oldPath}"`;
  const filesWithOldPath = findFilesWithContent(newProjectDir, cwdPattern);
  let remaining = 0;

  for (const file of filesWithOldPath) {
    const content = readFileSync(file, 'utf-8');
    remaining += (content.match(new RegExp(escapeRegex(cwdPattern), 'g')) || []).length;
  }

  if (remaining > 0) {
    logError(`Found ${remaining} remaining references to old path!`);
    return false;
  }
  logOk('No stale path references found');

  console.log('');
  return true;
}

/**
 * Rollback Claude data from backup
 */
export function rollbackClaude(backupDir, encodedOld, encodedNew) {
  // Restore history.jsonl
  const backupHistory = join(backupDir, 'history.jsonl');
  if (existsSync(backupHistory)) {
    cpSync(backupHistory, HISTORY_FILE);
    logRollback('Restored history.jsonl');
  }

  // Restore project dir
  const backupProjectDir = join(backupDir, 'projects', encodedOld);
  const oldProjectDir = join(PROJECTS_DIR, encodedOld);
  const newProjectDir = join(PROJECTS_DIR, encodedNew);

  if (existsSync(backupProjectDir)) {
    if (existsSync(newProjectDir)) {
      rmSync(newProjectDir, { recursive: true });
    }
    cpSync(backupProjectDir, oldProjectDir, { recursive: true });
    logRollback('Restored project directory');
  }
}

/**
 * Remove backup directory
 */
export function removeBackup(backupDir) {
  if (backupDir && existsSync(backupDir)) {
    rmSync(backupDir, { recursive: true });
    logInfo('Backup removed');
  }
}

// Helper functions

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findFiles(dir, pattern) {
  const results = [];

  function walk(currentDir) {
    if (!existsSync(currentDir)) return;

    const entries = readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (pattern.test(entry.name)) {
        results.push(fullPath);
      }
    }
  }

  walk(dir);
  return results;
}

function findFilesWithContent(dir, searchString) {
  const results = [];

  function walk(currentDir) {
    if (!existsSync(currentDir)) return;

    const entries = readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        try {
          const content = readFileSync(fullPath, 'utf-8');
          if (content.includes(searchString)) {
            results.push(fullPath);
          }
        } catch {
          // Skip files that can't be read
        }
      }
    }
  }

  walk(dir);
  return results;
}

export { CLAUDE_DIR, PROJECTS_DIR, HISTORY_FILE };
