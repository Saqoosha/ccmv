# ccmv - Project Guidelines

## Overview

`ccmv` is a Node.js CLI tool that migrates project directories, updating all Claude Code and/or Cursor references when a project is moved to a new location.

**Supported configurations:**
- Claude Code + Cursor (both)
- Claude Code only
- Cursor only

## Project Structure

```
ccmv/
├── package.json      # npm package config with bin entry
├── bin/
│   └── ccmv.js       # CLI entry point
├── lib/
│   ├── index.js      # Main orchestration logic
│   ├── logger.js     # Colored console output
│   ├── utils.js      # Path encoding, file URIs, hashing
│   ├── claude.js     # Claude Code operations
│   └── cursor.js     # Cursor editor operations
├── README.md         # User documentation
└── CLAUDE.md         # This file
```

## Technical Details

### Claude Code Data Locations

- `~/.claude/projects/{encoded-path}/` - Project-specific session data
- `~/.claude/history.jsonl` - Global history file
- Path encoding: `/`, `:`, spaces → `-`

### Cursor Data Locations

```
~/Library/Application Support/Cursor/User/
├── globalStorage/
│   ├── storage.json          # profileAssociations.workspaces (path list)
│   └── state.vscdb           # SQLite ItemTable: history.recentlyOpenedPathsList, repositoryTracker.paths
└── workspaceStorage/
    └── {hash}/
        ├── workspace.json    # {"folder": "file://..."} or {"workspace": "file://..."}
        └── state.vscdb       # Workspace-specific SQLite (ItemTable + cursorDiskKV)
```

- **Path format**: `file:///Users/foo/my%20project` (URL encoded)
- **SQLite update**: Uses `better-sqlite3` for database operations

### Cursor Workspace Hash (Critical)

Cursor/VSCode uses MD5 hash of `path + birthtime_ms` for workspaceStorage directory names:

```javascript
import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';

const stat = statSync(path);
const hash = createHash('md5')
    .update(path)
    .update(String(stat.birthtime.getTime()))
    .digest('hex');
```

**Key Points:**
- Uses Node.js native `fs.statSync().birthtime.getTime()` for consistent millisecond precision
- `mv` command preserves birthtime on same volume, so new path hash is predictable
- When project moves, ccmv renames workspace directory to match new hash
- Chat history is stored in `workspaceStorage/{hash}/state.vscdb` (cursorDiskKV table)

**Duplicate Workspace Handling:**
- Multiple workspace directories can point to the same path (from failed migrations or Cursor quirks)
- `mergeDuplicateWorkspaces()` finds all workspaces pointing to new path
- Keeps the workspace with the **larger** `state.vscdb` (contains more chat history)

### Key Modules

| Module | Purpose |
|--------|---------|
| `lib/index.js` | CLI parsing, orchestration, rollback handling |
| `lib/logger.js` | Colored log output functions |
| `lib/utils.js` | `encodePath`, `pathToFileUri`, `getWorkspaceHash`, `resolvePath` |
| `lib/claude.js` | Backup, rename, update, verify Claude data |
| `lib/cursor.js` | Detect, backup, update Cursor storage.json and SQLite DBs |

### Error Handling

- Validates all paths before making changes
- Requires at least one of Claude Code or Cursor data (fails if neither exists)
- Creates backups before any modifications
- Auto-rollback on any error during migration
- Cursor must not be running (checked before migration)

## Development

### Setup

```bash
npm install
```

### Testing

```bash
# Create test project
mkdir -p /tmp/test-proj-a
mkdir -p ~/.claude/projects/-tmp-test-proj-a
echo '{"cwd":"/tmp/test-proj-a"}' > ~/.claude/projects/-tmp-test-proj-a/test.jsonl

# Test dry-run
node bin/ccmv.js --dry-run /tmp/test-proj-a /tmp/test-proj-b

# Test with npx (from package directory)
npx . --dry-run /tmp/test-proj-a /tmp/test-proj-b

# Cleanup
rm -rf /tmp/test-proj-* ~/.claude/projects/-tmp-test-proj-*
```

### Local Development

```bash
# Run directly
node bin/ccmv.js --help

# Or link globally for testing
npm link
ccmv --help
```

### Known Issues

- Cursor must be closed during migration (enforced by `checkCursorNotRunning`)
- **Cross-volume moves**: `mv` to different volume may not preserve birthtime, potentially breaking hash prediction (untested)
- On Linux, Cursor data is at `~/.config/Cursor/User/` instead of `~/Library/Application Support/`

### Troubleshooting Cursor Chat History Loss

If chat history is lost after migration:

1. **Check workspace directories**: Look at `~/Library/Application Support/Cursor/User/workspaceStorage/*/workspace.json` for entries pointing to your path
2. **Compare state.vscdb sizes**: Larger file usually has more chat data
3. **Calculate expected hash**:
   ```javascript
   import { createHash } from 'node:crypto';
   import { statSync } from 'node:fs';

   const path = '/your/project/path';
   const stat = statSync(path);
   const hash = createHash('md5')
       .update(path)
       .update(String(stat.birthtime.getTime()))
       .digest('hex');
   console.log(hash);
   ```
4. **Check cursorDiskKV table**: Chat data is in `state.vscdb` under key `composer.composerData`
