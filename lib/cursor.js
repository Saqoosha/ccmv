import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, renameSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir, platform } from 'node:os';
import { execSync } from 'node:child_process';
import { logInfo, logOk, logError, logBackup, logFile, logReplace, logDryrun, logRollback } from './logger.js';
import { getWorkspaceHash, pathToFileUri, pathToTilde } from './utils.js';

// Cursor paths - support both macOS and Linux
const IS_MACOS = platform() === 'darwin';
const CURSOR_APP_SUPPORT = IS_MACOS
  ? join(homedir(), 'Library', 'Application Support', 'Cursor')
  : join(homedir(), '.config', 'Cursor');
const CURSOR_USER_DIR = join(CURSOR_APP_SUPPORT, 'User');
const CURSOR_GLOBAL_STORAGE = join(CURSOR_USER_DIR, 'globalStorage');
const CURSOR_WORKSPACE_STORAGE = join(CURSOR_USER_DIR, 'workspaceStorage');
const CURSOR_STORAGE_JSON = join(CURSOR_GLOBAL_STORAGE, 'storage.json');
const CURSOR_STATE_VSCDB = join(CURSOR_GLOBAL_STORAGE, 'state.vscdb');

let Database;

/**
 * Initialize SQLite database module
 */
async function initDatabase() {
  if (!Database) {
    try {
      const betterSqlite3 = await import('better-sqlite3');
      Database = betterSqlite3.default;
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Detect if Cursor is installed
 */
export function detectCursor(skipCursor) {
  if (skipCursor) {
    logInfo('Cursor update skipped (--no-cursor)');
    return false;
  }

  if (existsSync(CURSOR_USER_DIR)) {
    logOk('Cursor detected');
    return true;
  } else {
    logInfo('Cursor not installed, skipping');
    return false;
  }
}

/**
 * Check if Cursor is running
 */
export function checkCursorNotRunning(cursorDetected, dryRun) {
  if (!cursorDetected || dryRun) {
    return true;
  }

  try {
    const result = execSync('pgrep -x "Cursor"', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    if (result.trim()) {
      logError('Cursor is running. Please close Cursor before migration to prevent data corruption.');
      return false;
    }
  } catch {
    // pgrep returns non-zero if no process found - that's what we want
  }

  logOk('Cursor is not running');
  return true;
}

/**
 * Find workspace directories using hash calculation
 */
export function findCursorWorkspaces(cursorDetected, oldPath) {
  const result = {
    oldWorkspaceHash: null,
    workspaceDirs: [],
  };

  if (!cursorDetected || !existsSync(CURSOR_WORKSPACE_STORAGE)) {
    return result;
  }

  logInfo('Calculating workspace hash...');

  const hash = getWorkspaceHash(oldPath);
  if (!hash) {
    logInfo('Could not calculate workspace hash');
    return result;
  }

  result.oldWorkspaceHash = hash;
  logInfo(`  Old path hash: ${hash}`);

  const workspaceDir = join(CURSOR_WORKSPACE_STORAGE, hash);
  if (existsSync(workspaceDir)) {
    result.workspaceDirs.push(workspaceDir);
    logOk(`Found workspace directory: ${hash}`);
  } else {
    logInfo('No matching Cursor workspace found for this path');
  }

  return result;
}

/**
 * Backup Cursor data
 */
export function backupCursorData(cursorDetected, workspaceDirs, backupDir, dryRun) {
  if (!cursorDetected) return;

  logBackup('Backing up Cursor data...');

  if (dryRun) {
    logDryrun('Would backup Cursor data');
    return;
  }

  const cursorBackupDir = join(backupDir, 'cursor', 'workspaces');
  mkdirSync(cursorBackupDir, { recursive: true });

  // Backup storage.json
  if (existsSync(CURSOR_STORAGE_JSON)) {
    cpSync(CURSOR_STORAGE_JSON, join(backupDir, 'cursor', 'storage.json'));
    logBackup('storage.json');
  }

  // Backup global state.vscdb
  if (existsSync(CURSOR_STATE_VSCDB)) {
    cpSync(CURSOR_STATE_VSCDB, join(backupDir, 'cursor', 'state.vscdb'));
    logBackup('state.vscdb (global)');
  }

  // Backup workspace directories
  for (const wsDir of workspaceDirs) {
    const dirname = basename(wsDir);
    cpSync(wsDir, join(cursorBackupDir, dirname), { recursive: true });
    logBackup(`workspace: ${dirname}`);
  }

  console.log('');
}

/**
 * Rename Cursor workspace storage directory
 */
export function renameCursorWorkspace(cursorDetected, oldWorkspaceHash, newPath, oldFileUri, newFileUri, dryRun) {
  const result = {
    newWorkspaceHash: null,
    workspaceDirs: [],
  };

  if (!cursorDetected || !oldWorkspaceHash) {
    return result;
  }

  if (dryRun) {
    logDryrun('Would rename workspace directory (hash calculated after move)');
    return result;
  }

  logInfo('Calculating new workspace hash...');

  const newHash = getWorkspaceHash(newPath);
  if (!newHash) {
    logError('Could not calculate new workspace hash');
    return result;
  }

  result.newWorkspaceHash = newHash;
  logInfo(`  New path hash: ${newHash}`);

  const oldWsDir = join(CURSOR_WORKSPACE_STORAGE, oldWorkspaceHash);
  const newWsDir = join(CURSOR_WORKSPACE_STORAGE, newHash);

  if (oldWorkspaceHash === newHash) {
    logInfo('Workspace hash unchanged (same birthtime)');
    result.workspaceDirs.push(newWsDir);
    return result;
  }

  if (existsSync(oldWsDir)) {
    if (existsSync(newWsDir)) {
      logInfo('Target workspace directory already exists, merging...');
      // Compare state.vscdb sizes and keep the larger one
      const oldDb = join(oldWsDir, 'state.vscdb');
      const newDb = join(newWsDir, 'state.vscdb');

      if (existsSync(oldDb) && existsSync(newDb)) {
        const oldSize = statSync(oldDb).size;
        const newSize = statSync(newDb).size;
        if (oldSize > newSize) {
          logInfo(`  Using larger state.vscdb from old workspace (${oldSize} > ${newSize} bytes)`);
          cpSync(oldDb, newDb);
        }
      } else if (existsSync(oldDb)) {
        cpSync(oldDb, newDb);
      }

      // Copy other files from old (don't overwrite existing)
      const entries = readdirSync(oldWsDir, { withFileTypes: true });
      for (const entry of entries) {
        const src = join(oldWsDir, entry.name);
        const dest = join(newWsDir, entry.name);
        if (!existsSync(dest)) {
          if (entry.isDirectory()) {
            cpSync(src, dest, { recursive: true });
          } else {
            cpSync(src, dest);
          }
        }
      }
      rmSync(oldWsDir, { recursive: true });
    } else {
      renameSync(oldWsDir, newWsDir);
    }
    result.workspaceDirs.push(newWsDir);
    logOk('Renamed workspace directory');
  }

  // Merge duplicate workspaces
  mergeDuplicateWorkspaces(newHash, newFileUri);

  return result;
}

/**
 * Merge duplicate workspaces pointing to the same path
 */
function mergeDuplicateWorkspaces(newWorkspaceHash, newFileUri) {
  const targetDir = join(CURSOR_WORKSPACE_STORAGE, newWorkspaceHash);
  if (!existsSync(targetDir)) return;

  logInfo('Checking for duplicate workspaces...');

  let foundDuplicates = false;
  const entries = readdirSync(CURSOR_WORKSPACE_STORAGE, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === newWorkspaceHash) continue;

    const workspaceJson = join(CURSOR_WORKSPACE_STORAGE, entry.name, 'workspace.json');
    if (!existsSync(workspaceJson)) continue;

    try {
      const content = readFileSync(workspaceJson, 'utf-8');
      if (content.includes(newFileUri)) {
        foundDuplicates = true;
        logInfo(`  Found duplicate workspace: ${entry.name}`);

        // Compare state.vscdb and merge if duplicate has more data
        const dupDb = join(CURSOR_WORKSPACE_STORAGE, entry.name, 'state.vscdb');
        const targetDb = join(targetDir, 'state.vscdb');

        if (existsSync(dupDb)) {
          const dupSize = statSync(dupDb).size;
          const targetSize = existsSync(targetDb) ? statSync(targetDb).size : 0;

          if (dupSize > targetSize) {
            logInfo(`  Merging larger state.vscdb (${dupSize} > ${targetSize} bytes)`);
            cpSync(dupDb, targetDb);
          }
        }

        // Remove the duplicate workspace
        rmSync(join(CURSOR_WORKSPACE_STORAGE, entry.name), { recursive: true });
        logOk('  Removed duplicate workspace');
      }
    } catch {
      // Skip on error
    }
  }

  if (!foundDuplicates) {
    logInfo('  No duplicates found');
  }
}

/**
 * Update Cursor storage.json
 */
export function updateCursorStorageJson(cursorDetected, oldPath, newPath, oldFileUri, newFileUri, dryRun) {
  if (!cursorDetected || !existsSync(CURSOR_STORAGE_JSON)) return;

  logInfo('Updating Cursor storage.json...');

  const home = homedir();
  const oldTildePath = pathToTilde(oldPath);
  const newTildePath = pathToTilde(newPath);

  const content = readFileSync(CURSOR_STORAGE_JSON, 'utf-8');

  // Count occurrences
  const regex = new RegExp(escapeRegex(oldPath) + '|' + escapeRegex(oldFileUri), 'g');
  const matches = content.match(regex) || [];
  const count = matches.length;

  if (count > 0) {
    if (dryRun) {
      logReplace(`${count} occurrences would be updated`);
    } else {
      let newContent = content;
      // Replace with delimiters to avoid partial matches
      newContent = replaceWithDelimiters(newContent, oldFileUri, newFileUri);
      newContent = replaceWithDelimiters(newContent, oldPath, newPath);
      newContent = replaceWithDelimiters(newContent, oldTildePath, newTildePath);
      writeFileSync(CURSOR_STORAGE_JSON, newContent);
      logReplace(`${count} occurrences updated`);
    }
  } else {
    logInfo('No matching entries in storage.json');
  }

  console.log('');
}

/**
 * Update Cursor global state.vscdb (SQLite)
 */
export async function updateCursorStateVscdb(cursorDetected, oldPath, newPath, oldFileUri, newFileUri, dryRun) {
  if (!cursorDetected || !existsSync(CURSOR_STATE_VSCDB)) return;

  logInfo('Updating Cursor global state.vscdb...');

  if (!(await initDatabase())) {
    logError('Could not load SQLite module');
    return;
  }

  const home = homedir();
  const oldTildePath = pathToTilde(oldPath);
  const newTildePath = pathToTilde(newPath);

  try {
    const db = new Database(CURSOR_STATE_VSCDB);

    // Count matching rows
    const countStmt = db.prepare("SELECT COUNT(*) as count FROM ItemTable WHERE value LIKE ?");
    const result = countStmt.get(`%${oldPath}%`);
    const count = result?.count || 0;

    if (dryRun) {
      logReplace(`${count} rows would be updated`);
    } else if (count > 0) {
      // Replace with delimiters to avoid partial matches
      db.exec('BEGIN TRANSACTION');

      const updatePatterns = [
        [oldFileUri + '"', newFileUri + '"'],
        [oldFileUri + '/', newFileUri + '/'],
        [oldFileUri + ',', newFileUri + ','],
        [oldPath + '"', newPath + '"'],
        [oldPath + '/', newPath + '/'],
        [oldPath + ',', newPath + ','],
        [oldTildePath + '"', newTildePath + '"'],
        [oldTildePath + '/', newTildePath + '/'],
        [oldTildePath + ',', newTildePath + ','],
      ];

      for (const [oldPattern, newPattern] of updatePatterns) {
        db.prepare(
          "UPDATE ItemTable SET value = REPLACE(value, ?, ?) WHERE value LIKE ?"
        ).run(oldPattern, newPattern, `%${oldPattern}%`);
      }

      db.exec('COMMIT');
      logReplace(`${count} rows updated`);
    } else {
      logInfo('No matching entries in global state.vscdb');
    }

    db.close();
  } catch (err) {
    logError(`Failed to update state.vscdb: ${err.message}`);
  }

  console.log('');
}

/**
 * Update Cursor workspace storage
 */
export async function updateCursorWorkspaceStorage(cursorDetected, workspaceDirs, oldPath, newPath, oldFileUri, newFileUri, dryRun) {
  if (!cursorDetected || workspaceDirs.length === 0) return;

  logInfo('Updating Cursor workspace storage...');

  if (!(await initDatabase())) {
    logError('Could not load SQLite module');
    return;
  }

  const home = homedir();
  const oldTildePath = pathToTilde(oldPath);
  const newTildePath = pathToTilde(newPath);

  for (const wsDir of workspaceDirs) {
    const dirname = basename(wsDir);
    logFile(`Workspace: ${dirname}`);

    // Update workspace.json
    const workspaceJson = join(wsDir, 'workspace.json');
    if (existsSync(workspaceJson)) {
      const content = readFileSync(workspaceJson, 'utf-8');
      const regex = new RegExp(escapeRegex(oldPath) + '|' + escapeRegex(oldFileUri), 'g');
      const matches = content.match(regex) || [];
      const count = matches.length;

      if (count > 0) {
        if (dryRun) {
          logReplace(`workspace.json: ${count} occurrences would be updated`);
        } else {
          let newContent = content;
          newContent = replaceWithDelimiters(newContent, oldFileUri, newFileUri);
          newContent = replaceWithDelimiters(newContent, oldPath, newPath);
          newContent = replaceWithDelimiters(newContent, oldTildePath, newTildePath);
          writeFileSync(workspaceJson, newContent);
          logReplace(`workspace.json: ${count} occurrences updated`);
        }
      }
    }

    // Update state.vscdb
    const stateVscdb = join(wsDir, 'state.vscdb');
    if (existsSync(stateVscdb)) {
      try {
        const db = new Database(stateVscdb);

        const countStmt = db.prepare("SELECT COUNT(*) as count FROM ItemTable WHERE value LIKE ?");
        const result = countStmt.get(`%${oldPath}%`);
        const dbCount = result?.count || 0;

        if (dbCount > 0) {
          if (dryRun) {
            logReplace(`state.vscdb: ${dbCount} rows would be updated`);
          } else {
            db.exec('BEGIN TRANSACTION');

            const updatePatterns = [
              [oldFileUri + '"', newFileUri + '"'],
              [oldFileUri + '/', newFileUri + '/'],
              [oldPath + '"', newPath + '"'],
              [oldPath + '/', newPath + '/'],
              [oldTildePath + '"', newTildePath + '"'],
              [oldTildePath + '/', newTildePath + '/'],
            ];

            for (const [oldPattern, newPattern] of updatePatterns) {
              db.prepare(
                "UPDATE ItemTable SET value = REPLACE(value, ?, ?) WHERE value LIKE ?"
              ).run(oldPattern, newPattern, `%${oldPattern}%`);
            }

            db.exec('COMMIT');
            logReplace(`state.vscdb: ${dbCount} rows updated`);
          }
        }

        db.close();
      } catch (err) {
        logError(`Failed to update workspace state.vscdb: ${err.message}`);
      }
    }
  }

  console.log('');
}

/**
 * Verify Cursor migration
 */
export function verifyCursorMigration(cursorDetected, workspaceDirs, oldPath, newPath, dryRun) {
  if (!cursorDetected || dryRun) return true;

  logInfo('Verifying Cursor migration...');

  let hasError = false;

  // Check storage.json
  if (existsSync(CURSOR_STORAGE_JSON)) {
    const content = readFileSync(CURSOR_STORAGE_JSON, 'utf-8');
    // Find OLD_PATH but exclude lines with NEW_PATH (to handle SPNFY vs SPNFY-test case)
    const lines = content.split('\n');
    let count = 0;
    for (const line of lines) {
      if (line.includes(oldPath) && !line.includes(newPath)) {
        count++;
      }
    }
    if (count > 0) {
      logError(`Found ${count} stale references in storage.json`);
      hasError = true;
    }
  }

  // Check workspaces
  for (const wsDir of workspaceDirs) {
    const workspaceJson = join(wsDir, 'workspace.json');
    if (existsSync(workspaceJson)) {
      const content = readFileSync(workspaceJson, 'utf-8');
      const lines = content.split('\n');
      let count = 0;
      for (const line of lines) {
        if (line.includes(oldPath) && !line.includes(newPath)) {
          count++;
        }
      }
      if (count > 0) {
        logError(`Found ${count} stale references in ${basename(wsDir)}/workspace.json`);
        hasError = true;
      }
    }
  }

  if (hasError) {
    return false;
  }

  logOk('Cursor migration verified');
  console.log('');
  return true;
}

/**
 * Rollback Cursor data from backup
 */
export function rollbackCursor(backupDir) {
  const cursorBackupDir = join(backupDir, 'cursor');

  // Restore storage.json
  const backupStorageJson = join(cursorBackupDir, 'storage.json');
  if (existsSync(backupStorageJson)) {
    cpSync(backupStorageJson, CURSOR_STORAGE_JSON);
    logRollback('Restored Cursor storage.json');
  }

  // Restore global state.vscdb
  const backupStateVscdb = join(cursorBackupDir, 'state.vscdb');
  if (existsSync(backupStateVscdb)) {
    cpSync(backupStateVscdb, CURSOR_STATE_VSCDB);
    logRollback('Restored Cursor global state.vscdb');
  }

  // Restore workspace directories
  const workspacesBackupDir = join(cursorBackupDir, 'workspaces');
  if (existsSync(workspacesBackupDir)) {
    const entries = readdirSync(workspacesBackupDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const targetDir = join(CURSOR_WORKSPACE_STORAGE, entry.name);
        if (existsSync(targetDir)) {
          rmSync(targetDir, { recursive: true });
        }
        cpSync(join(workspacesBackupDir, entry.name), targetDir, { recursive: true });
        logRollback(`Restored Cursor workspace: ${entry.name}`);
      }
    }
  }
}

// Helper functions

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceWithDelimiters(content, oldStr, newStr) {
  // Replace with delimiters to avoid partial matches
  const delimiters = ['"', '/', ','];
  let result = content;
  for (const delim of delimiters) {
    result = result.split(oldStr + delim).join(newStr + delim);
  }
  return result;
}

export { CURSOR_APP_SUPPORT, CURSOR_USER_DIR, CURSOR_WORKSPACE_STORAGE };
