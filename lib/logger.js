// ANSI color codes
const colors = {
  red: '\x1b[0;31m',
  green: '\x1b[0;32m',
  yellow: '\x1b[0;33m',
  blue: '\x1b[0;34m',
  reset: '\x1b[0m',
};

let verbose = true;

export function setVerbose(value) {
  verbose = value;
}

export function logInfo(message) {
  console.log(`${colors.blue}[INFO]${colors.reset} ${message}`);
}

export function logOk(message) {
  console.log(`${colors.green}[OK]${colors.reset} ${message}`);
}

export function logCheck(message) {
  console.log(`${colors.yellow}[CHECK]${colors.reset} ${message}`);
}

export function logBackup(message) {
  console.log(`${colors.yellow}[BACKUP]${colors.reset} ${message}`);
}

export function logFile(message) {
  console.log(`${colors.blue}[FILE]${colors.reset} ${message}`);
}

export function logReplace(message) {
  if (verbose) {
    console.log(`  ${colors.green}[REPLACE]${colors.reset} ${message}`);
  }
}

export function logRename(message) {
  console.log(`${colors.blue}[RENAME]${colors.reset} ${message}`);
}

export function logDone(message) {
  console.log(`${colors.green}[DONE]${colors.reset} ${message}`);
}

export function logError(message) {
  console.error(`${colors.red}[ERROR]${colors.reset} ${message}`);
}

export function logRollback(message) {
  console.log(`${colors.yellow}[ROLLBACK]${colors.reset} ${message}`);
}

export function logDryrun(message) {
  console.log(`${colors.yellow}[DRY-RUN]${colors.reset} ${message}`);
}
