# ccmv - Project Guidelines

## Overview

`ccmv` is a Bash script that migrates Claude Code project directories, updating all internal references when a project is moved to a new location. Also supports Cursor editor (auto-detected).

## Project Structure

```
ccmvproj/
├── ccmv          # Main executable script
├── README.md     # User documentation
└── CLAUDE.md     # This file
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
- **SQLite update**: Uses `REPLACE(value, old, new)` on ItemTable values

### Cursor Workspace Hash (Critical)

Cursor/VSCode uses MD5 hash of `path + birthtime_ms` for workspaceStorage directory names:

```javascript
// Node.js implementation (used by ccmv)
const hash = crypto.createHash('md5')
    .update(path)
    .update(String(stat.birthtime.getTime()))
    .digest('hex');
```

**Key Points:**
- Must use Node.js for hash calculation (Python's `os.stat().st_birthtime` rounds differently)
- `mv` command preserves birthtime on same volume, so new path hash is predictable
- When project moves, ccmv renames workspace directory to match new hash
- Chat history is stored in `workspaceStorage/{hash}/state.vscdb` (cursorDiskKV table)

**Duplicate Workspace Handling:**
- Multiple workspace directories can point to the same path (from failed migrations or Cursor quirks)
- `merge_duplicate_workspaces()` finds all workspaces pointing to new path
- Keeps the workspace with the **larger** `state.vscdb` (contains more chat history)

### Key Functions

| Function | Purpose |
|----------|---------|
| `encode_path` | Converts filesystem path to Claude's encoded format |
| `escape_sed` | Escapes special characters for sed regex |
| `path_to_file_uri` | Converts path to `file://` URI (URL encoded) |
| `validate` | Checks paths and Claude project directory exist |
| `detect_cursor` | Auto-detects Cursor installation |
| `check_cursor_not_running` | Ensures Cursor is closed before migration |
| `find_cursor_workspaces` | Finds workspace directories containing old path |
| `create_backup` | Backs up project dir and history.jsonl |
| `backup_cursor_data` | Backs up Cursor storage.json, state.vscdb, workspaces |
| `move_project` | Moves actual project directory |
| `rename_claude_dir` | Renames ~/.claude/projects/ subdirectory |
| `update_project_files` | Updates `cwd` field in all JSONL files |
| `update_history` | Updates global history.jsonl |
| `update_cursor_storage_json` | Updates Cursor storage.json |
| `update_cursor_state_vscdb` | Updates Cursor global SQLite DB |
| `update_cursor_workspace_storage` | Updates workspace.json and state.vscdb |
| `get_workspace_hash` | Calculates Cursor workspace hash using Node.js |
| `rename_cursor_workspace` | Renames workspace dir from old hash to new hash |
| `merge_duplicate_workspaces` | Merges workspaces pointing to same path (keeps larger DB) |
| `verify` | Validates migration success |
| `verify_cursor_migration` | Validates Cursor data migration |
| `rollback` | Restores from backup on error |

### Error Handling

- Uses `set -euo pipefail` for strict error handling
- `trap 'rollback' ERR` for automatic rollback on failure
- All destructive operations happen after backup creation

## Development Notes

### Testing

```bash
# Create test project
mkdir -p /tmp/test-proj-a
mkdir -p ~/.claude/projects/-tmp-test-proj-a
echo '{"cwd":"/tmp/test-proj-a"}' > ~/.claude/projects/-tmp-test-proj-a/test.jsonl

# Test dry-run (Cursor auto-detection)
./ccmv --dry-run /tmp/test-proj-a /tmp/test-proj-b

# Test --no-cursor option
./ccmv --dry-run --no-cursor /tmp/test-proj-a /tmp/test-proj-b

# Test with spaces (URL encoding)
mkdir -p "/tmp/my project"
./ccmv --dry-run "/tmp/my project" "/tmp/my new project"

# Test actual migration (requires Cursor closed)
./ccmv /tmp/test-proj-a /tmp/test-proj-b

# Cleanup
rm -rf /tmp/test-proj-* ~/.claude/projects/-tmp-test-proj-*
```

### Known Issues

- `grep -c` returns exit code 1 when no matches (handled with `|| count=0`)
- `set -o pipefail` requires careful handling of pipe chains
- Cursor must be closed during migration (enforced by `check_cursor_not_running`)
- **Python vs Node.js birthtime**: Python rounds milliseconds differently (e.g., 583 vs 584), causing hash mismatch. Must use Node.js for workspace hash calculation.
- **Cross-volume moves**: `mv` to different volume may not preserve birthtime, potentially breaking hash prediction (untested)

### Troubleshooting Cursor Chat History Loss

If chat history is lost after migration:

1. **Check workspace directories**: Look at `~/Library/Application Support/Cursor/User/workspaceStorage/*/workspace.json` for entries pointing to your path
2. **Compare state.vscdb sizes**: Larger file usually has more chat data
3. **Calculate expected hash**:
   ```bash
   node -e "
   const fs = require('fs');
   const crypto = require('crypto');
   const path = '/your/project/path';
   const stat = fs.statSync(path);
   console.log(crypto.createHash('md5')
       .update(path)
       .update(String(stat.birthtime.getTime()))
       .digest('hex'));
   "
   ```
4. **Check cursorDiskKV table**: Chat data is in `state.vscdb` under key `composer.composerData`
