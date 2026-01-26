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
- **Workspace hash**: Internal Cursor/VSCode hash, directory name unchanged
- **SQLite update**: Uses `REPLACE(value, old, new)` on ItemTable values

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
