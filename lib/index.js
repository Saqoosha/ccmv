import { existsSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import {
  logInfo,
  logOk,
  logCheck,
  logError,
  logDone,
  logDryrun,
  logRollback,
  setVerbose,
} from './logger.js';
import {
  encodePath,
  pathToFileUri,
  resolvePath,
  resolveNewPath,
} from './utils.js';
import {
  checkClaudeExists,
  createBackup,
  renameClaudeDir,
  updateProjectFiles,
  updateHistory,
  updateSessions,
  updateSessionsIndex,
  verifyClaude,
  rollbackClaude,
  removeBackup,
} from './claude.js';
import {
  detectCursor,
  checkCursorNotRunning,
  findCursorWorkspaces,
  backupCursorData,
  renameCursorWorkspace,
  updateCursorStorageJson,
  updateCursorStateVscdb,
  updateCursorWorkspaceStorage,
  verifyCursorMigration,
  rollbackCursor,
} from './cursor.js';

const USAGE = `Usage: ccmv [OPTIONS] <old-path> <new-path>

Moves a project directory and updates all Claude Code references.
If Cursor is installed, also updates Cursor's workspace data automatically.

Options:
  --refs-only    Only update Claude's references (don't move the actual directory)
  --dry-run      Show what would be done without making changes
  --keep-backup  Don't remove backups after successful migration
  --no-cursor    Skip Cursor data updates even if Cursor is installed
  --verbose      Show detailed logs (default: on)
  --quiet        Suppress detailed logs
  --help         Show this help message

Examples:
  ccmv /Users/jane/old-project /Users/jane/new-project
  ccmv --dry-run ~/projects/myapp ~/work/myapp
  ccmv --refs-only /old/path /new/path
  ccmv --no-cursor ~/proj-a ~/proj-b
`;

/**
 * Parse command line arguments
 */
function parseArgs(args) {
  const options = {
    dryRun: false,
    refsOnly: false,
    keepBackup: false,
    verbose: true,
    noCursor: false,
    help: false,
    paths: [],
  };

  for (const arg of args) {
    switch (arg) {
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--refs-only':
        options.refsOnly = true;
        break;
      case '--keep-backup':
        options.keepBackup = true;
        break;
      case '--verbose':
        options.verbose = true;
        break;
      case '--quiet':
        options.verbose = false;
        break;
      case '--no-cursor':
        options.noCursor = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        if (arg.startsWith('-')) {
          logError(`Unknown option: ${arg}`);
          console.log('Use --help for usage information');
          process.exit(1);
        }
        options.paths.push(arg);
    }
  }

  return options;
}

/**
 * Validate paths and environment
 */
function validate(oldPath, newPath, refsOnly) {
  logCheck('Validating paths...');

  // Check old path exists
  if (!existsSync(oldPath)) {
    if (refsOnly) {
      logInfo("Old path doesn't exist (OK for --refs-only mode)");
    } else {
      logError(`Old path does not exist: ${oldPath}`);
      return false;
    }
  } else {
    logOk('Old path exists');
  }

  // Check new path doesn't exist (unless refs-only)
  if (!refsOnly) {
    if (existsSync(newPath)) {
      logError(`New path already exists: ${newPath}`);
      return false;
    }
    logOk('New path does not exist');
  }

  console.log('');
  return true;
}

/**
 * Move the actual project directory
 */
function moveProject(oldPath, newPath, refsOnly, dryRun) {
  if (refsOnly) {
    return;
  }

  if (dryRun) {
    logDryrun(`Would move: ${oldPath} -> ${newPath}`);
    console.log('');
    return;
  }

  logInfo('Moving project directory...');
  renameSync(oldPath, newPath);
  logOk(`Moved: ${oldPath} -> ${newPath}`);
  console.log('');
}

/**
 * Rollback on error
 */
function rollback(backupDir, oldPath, newPath, encodedOld, encodedNew, refsOnly, cursorDetected) {
  if (!backupDir || !existsSync(backupDir)) {
    logError('No backup available for rollback');
    return;
  }

  logError('Migration failed! Rolling back...');

  // Rollback Claude data
  rollbackClaude(backupDir, encodedOld, encodedNew);

  // Restore original project location if moved
  if (!refsOnly) {
    if (existsSync(newPath) && !existsSync(oldPath)) {
      renameSync(newPath, oldPath);
      logRollback('Moved project back to original location');
    }
  }

  // Rollback Cursor data
  if (cursorDetected) {
    rollbackCursor(backupDir);
  }

  logRollback('Complete. Your project is unchanged.');
  console.log('');
  console.log(`Backup kept at: ${backupDir}`);
}

/**
 * Main entry point
 */
export async function main(args) {
  const options = parseArgs(args);

  if (options.help) {
    console.log(USAGE);
    process.exit(0);
  }

  if (options.paths.length !== 2) {
    logError('Expected 2 arguments: old-path and new-path');
    console.log('Use --help for usage information');
    process.exit(1);
  }

  setVerbose(options.verbose);

  // Resolve paths
  const oldPath = resolvePath(options.paths[0]);
  const newPath = resolveNewPath(options.paths[1]);

  // Encode paths for Claude
  const encodedOld = encodePath(oldPath);
  const encodedNew = encodePath(newPath);

  // Generate file:// URIs for Cursor
  const oldFileUri = pathToFileUri(oldPath);
  const newFileUri = pathToFileUri(newPath);

  // Display info
  console.log('');
  logInfo(`Old path: ${oldPath}`);
  logInfo(`New path: ${newPath}`);
  logInfo(`Encoded old: ${encodedOld}`);
  logInfo(`Encoded new: ${encodedNew}`);

  if (options.dryRun) {
    console.log('');
    logDryrun('Running in dry-run mode - no changes will be made');
  }

  if (options.refsOnly) {
    console.log('');
    logInfo('Running in refs-only mode - project directory will not be moved');
  }

  console.log('');

  // State for rollback
  let backupDir = null;
  let cursorDetected = false;
  let claudeExists = false;
  let cursorWorkspaceInfo = { oldWorkspaceHash: null, workspaceDirs: [] };

  try {
    // Validate paths
    if (!validate(oldPath, newPath, options.refsOnly)) {
      process.exit(1);
    }

    // Check Claude data exists
    claudeExists = checkClaudeExists(encodedOld);

    // Detect and check Cursor
    cursorDetected = detectCursor(options.noCursor);
    if (!checkCursorNotRunning(cursorDetected, options.dryRun)) {
      process.exit(1);
    }

    // Find Cursor workspaces
    cursorWorkspaceInfo = findCursorWorkspaces(cursorDetected, oldPath);

    // Fail if neither Claude nor Cursor data exists
    if (!claudeExists && !cursorDetected) {
      logError('No Claude Code or Cursor data found for this project.');
      logError('Use regular mv command to move the directory.');
      process.exit(1);
    }

    // Create backups
    backupDir = createBackup(encodedOld, options.dryRun, claudeExists);
    backupCursorData(cursorDetected, cursorWorkspaceInfo.workspaceDirs, backupDir, options.dryRun);

    // Move project
    moveProject(oldPath, newPath, options.refsOnly, options.dryRun);

    // Rename Cursor workspace (after move, uses new birthtime)
    const renamedWorkspace = renameCursorWorkspace(
      cursorDetected,
      cursorWorkspaceInfo.oldWorkspaceHash,
      newPath,
      oldFileUri,
      newFileUri,
      options.dryRun
    );
    if (renamedWorkspace.workspaceDirs.length > 0) {
      cursorWorkspaceInfo.workspaceDirs = renamedWorkspace.workspaceDirs;
    }

    // Rename Claude dir
    renameClaudeDir(encodedOld, encodedNew, options.dryRun, claudeExists);

    // Update files
    updateProjectFiles(oldPath, newPath, encodedOld, encodedNew, options.dryRun, claudeExists);
    updateHistory(oldPath, newPath, options.dryRun);
    updateSessions(oldPath, newPath, options.dryRun);
    updateSessionsIndex(oldPath, newPath, encodedOld, encodedNew, options.dryRun, claudeExists);

    // Update Cursor data
    updateCursorStorageJson(cursorDetected, oldPath, newPath, oldFileUri, newFileUri, options.dryRun);
    await updateCursorStateVscdb(cursorDetected, oldPath, newPath, oldFileUri, newFileUri, options.dryRun);
    await updateCursorWorkspaceStorage(
      cursorDetected,
      cursorWorkspaceInfo.workspaceDirs,
      oldPath,
      newPath,
      oldFileUri,
      newFileUri,
      options.dryRun
    );

    // Verify
    if (!verifyClaude(oldPath, encodedNew, options.dryRun, claudeExists)) {
      throw new Error('Claude verification failed');
    }
    if (!verifyCursorMigration(cursorDetected, cursorWorkspaceInfo.workspaceDirs, oldPath, newPath, options.dryRun)) {
      throw new Error('Cursor verification failed');
    }

    // Cleanup
    if (!options.dryRun) {
      if (options.keepBackup) {
        logInfo(`Backup kept at: ${backupDir.replace(homedir(), '~')}/`);
      } else {
        removeBackup(backupDir);
      }
    }

    // Success
    if (options.dryRun) {
      logDone('Dry-run complete! No changes were made.');
    } else {
      logDone('Migration complete!');
      if (!options.refsOnly) {
        logInfo(`Your project is now at: ${newPath}`);
      }
    }
  } catch (err) {
    if (!options.dryRun && backupDir) {
      rollback(backupDir, oldPath, newPath, encodedOld, encodedNew, options.refsOnly, cursorDetected);
    }
    logError(err.message);
    process.exit(1);
  }
}
