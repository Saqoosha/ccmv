# ccmv

Claude Code project directory migration tool.

## Problem

When you move a project directory, Claude Code loses track of your conversation history because it's stored in `~/.claude/projects/` using path-encoded directory names.

## Solution

`ccmv` moves your project and updates all Claude Code and/or Cursor references automatically. Works with:
- Projects with both Claude Code and Cursor data
- Claude Code-only projects (no Cursor)
- Cursor-only projects (no Claude Code history)

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

1. Detects Claude Code and/or Cursor data for the project
2. Creates backup of existing data
3. Moves project directory (unless `--refs-only`)
4. Updates Claude Code data (if exists):
   - Renames `~/.claude/projects/{encoded-path}/`
   - Updates `cwd` field in all JSONL files
   - Updates `~/.claude/history.jsonl`
5. Updates Cursor workspace data (if exists):
   - Renames `workspaceStorage/{hash}/` directory
   - Updates `storage.json` (profile associations)
   - Updates `state.vscdb` (global SQLite database)
   - Updates `workspaceStorage/*/workspace.json`
   - Updates `workspaceStorage/*/state.vscdb`
6. Verifies migration success
7. Auto-rollback on any failure

**Note:** Migration requires at least one of Claude Code or Cursor data to exist. If neither exists, use regular `mv` command.

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
