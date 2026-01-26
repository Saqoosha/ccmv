# ccmv

Claude Code project directory migration tool.

## Problem

When you move a project directory, Claude Code loses track of your conversation history because it's stored in `~/.claude/projects/` using path-encoded directory names.

## Solution

`ccmv` moves your project and updates all Claude Code references automatically. If Cursor editor is installed, it also updates Cursor's workspace data.

## Installation

```bash
# Using npm (recommended)
npm install -g ccmv

# Or using npx (no installation required)
npx ccmv --help
```

## Usage

```
ccmv [OPTIONS] <old-path> <new-path>

Options:
  --refs-only    Only update references (don't move directory)
  --dry-run      Preview changes without executing
  --keep-backup  Keep backup after successful migration
  --no-cursor    Skip Cursor editor data updates
  --quiet        Suppress detailed output
  --help         Show help
```

## Examples

```bash
# Move project to new location
ccmv ~/projects/myapp ~/work/myapp

# Or using npx
npx ccmv ~/projects/myapp ~/work/myapp

# Preview what would happen
ccmv --dry-run ~/old-project ~/new-project

# Already moved? Just update refs
ccmv --refs-only /old/path /new/path
```

## What It Does

1. Creates backup of Claude data (and Cursor data if installed)
2. Moves project directory (unless `--refs-only`)
3. Renames `~/.claude/projects/{encoded-path}/`
4. Updates `cwd` field in all JSONL files
5. Updates `~/.claude/history.jsonl`
6. Updates Cursor workspace data (if installed)
   - `storage.json` (profile associations)
   - `state.vscdb` (global SQLite database)
   - `workspaceStorage/*/workspace.json`
   - `workspaceStorage/*/state.vscdb`
7. Verifies migration success
8. Auto-rollback on any failure

## How Claude Code Stores Data

```
~/.claude/
├── projects/
│   └── -Users-jane-myproject/    # Encoded from /Users/jane/myproject
│       ├── session-abc.jsonl     # Contains "cwd":"/Users/jane/myproject"
│       └── subagents/
│           └── agent-xyz.jsonl
└── history.jsonl                  # Global history with cwd fields
```

Path encoding: `/Users/jane/foo bar` → `-Users-jane-foo-bar`

## Cursor Data (Auto-detected)

If Cursor is installed, `ccmv` also updates:

```
~/Library/Application Support/Cursor/User/
├── globalStorage/
│   ├── storage.json          # Profile workspace associations
│   └── state.vscdb           # SQLite: history, repository paths
└── workspaceStorage/
    └── {hash}/
        ├── workspace.json    # Workspace folder URI
        └── state.vscdb       # Workspace-specific data
```

**Note:** Cursor must be closed during migration to prevent data corruption.

## Requirements

- Node.js 18.0.0 or later
- macOS or Linux

## License

MIT
