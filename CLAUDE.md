# ccmv - Project Guidelines

## Overview

`ccmv` is a Bash script that migrates Claude Code project directories, updating all internal references when a project is moved to a new location.

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

### Key Functions

| Function | Purpose |
|----------|---------|
| `encode_path` | Converts filesystem path to Claude's encoded format |
| `escape_sed` | Escapes special characters for sed regex |
| `validate` | Checks paths and Claude project directory exist |
| `create_backup` | Backs up project dir and history.jsonl |
| `move_project` | Moves actual project directory |
| `rename_claude_dir` | Renames ~/.claude/projects/ subdirectory |
| `update_jsonl_files` | Updates `cwd` field in all JSONL files |
| `update_history` | Updates global history.jsonl |
| `verify` | Validates migration success |
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

# Test dry-run
./ccmv --dry-run /tmp/test-proj-a /tmp/test-proj-b

# Test actual migration
./ccmv /tmp/test-proj-a /tmp/test-proj-b

# Cleanup
rm -rf /tmp/test-proj-* ~/.claude/projects/-tmp-test-proj-*
```

### Known Issues

- `grep -c` returns exit code 1 when no matches (handled with `|| count=0`)
- `set -o pipefail` requires careful handling of pipe chains
