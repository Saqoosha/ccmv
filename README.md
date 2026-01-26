# ccmv

Claude Code project directory migration tool.

## Problem

When you move a project directory, Claude Code loses track of your conversation history because it's stored in `~/.claude/projects/` using path-encoded directory names.

## Solution

`ccmv` moves your project and updates all Claude Code references automatically.

## Installation

```bash
# Download
curl -O https://raw.githubusercontent.com/saqoosha/ccmv/main/ccmv
chmod +x ccmv

# Add to PATH
mv ccmv /usr/local/bin/
```

## Usage

```
ccmv [OPTIONS] <old-path> <new-path>

Options:
  --refs-only    Only update references (don't move directory)
  --dry-run      Preview changes without executing
  --keep-backup  Keep backup after successful migration
  --quiet        Suppress detailed output
  --help         Show help
```

## Examples

```bash
# Move project to new location
ccmv ~/projects/myapp ~/work/myapp

# Preview what would happen
ccmv --dry-run ~/old-project ~/new-project

# Already moved? Just update refs
ccmv --refs-only /old/path /new/path
```

## What It Does

1. Creates backup of Claude data
2. Moves project directory (unless `--refs-only`)
3. Renames `~/.claude/projects/{encoded-path}/`
4. Updates `cwd` field in all JSONL files
5. Updates `~/.claude/history.jsonl`
6. Verifies migration success
7. Auto-rollback on any failure

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

## Requirements

- macOS or Linux
- Bash 4.0+
- Python 3 (for JSON validation)

## License

MIT
