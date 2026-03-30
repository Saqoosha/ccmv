# Claude Code & Cursor Internal Architecture

This document provides detailed documentation of the internal data structures used by Claude Code and Cursor.

## Claude Code Data Structure

### Directory Layout

```
~/.claude/
├── projects/                    # Per-project session data
│   └── {encoded-path}/          # Encoded path (see below)
│       ├── {session-id}.jsonl   # Main session file
│       ├── agent-{agent-id}.jsonl  # Sub-agent sessions
│       ├── sessions-index.json  # Session index (fullPath, projectPath, originalPath)
│       └── tool-results/        # Tool execution result cache
│           └── *.txt
├── sessions/                    # Active session metadata
│   └── {pid}.json               # Per-process session info (cwd, sessionId, etc.)
├── history.jsonl                # Global history (all projects)
├── file-history/                # File change history
├── backups/                     # Backups from ccmv etc.
├── commands/                    # Custom commands
├── agents/                      # Custom agents
├── cache/                       # Various caches
├── debug/                       # Debug logs
└── downloads/                   # Downloaded files
```

### Path Encoding

Claude Code encodes project paths using the following rules:

| Original | Encoded |
|----------|---------|
| `/` (slash) | `-` |
| `:` (colon) | `-` |
| ` ` (space) | `-` |

**Example:**
```
/Users/jane/Documents/repos/myproject
→ -Users-jane-Documents-repos-myproject
```

### Session File Format (*.jsonl)

Each line is a single JSON object. Different `type` values per line.

#### Record Types

| type | Description |
|------|-------------|
| `queue-operation` | Queue operations (enqueue/dequeue) |
| `user` | User messages |
| `assistant` | Claude's responses |
| `tool_use` | Tool invocations |
| `tool_result` | Tool execution results |

#### Common Fields

Fields present in all records:

```json
{
  "type": "user|assistant|tool_use|...",
  "uuid": "fd49a8a2-68f3-4cdf-81f8-38508beda957",
  "parentUuid": "UUID of previous message (null for first)",
  "sessionId": "fe4c5fad-9703-4485-9e4f-b73a1f638c02",
  "timestamp": "2026-01-07T12:33:48.236Z",
  "cwd": "/Users/jane/project",
  "gitBranch": "main",
  "version": "2.0.72",
  "isSidechain": false,
  "userType": "external"
}
```

#### User Message

```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": "User input text"
  },
  ...common fields
}
```

#### Assistant Message

```json
{
  "type": "assistant",
  "message": {
    "model": "claude-sonnet-4-5-20250929",
    "id": "msg_014FrefSYxpSnNHJcpNJZugw",
    "type": "message",
    "role": "assistant",
    "content": [
      { "type": "text", "text": "Response text" },
      { "type": "tool_use", "id": "toolu_xxx", "name": "Read", "input": {...} }
    ],
    "stop_reason": "end_turn|tool_use|null",
    "usage": {
      "input_tokens": 3,
      "cache_creation_input_tokens": 22320,
      "cache_read_input_tokens": 0,
      "output_tokens": 1
    }
  },
  "requestId": "req_011CWt2PcwHgdwPS37vwqRzv",
  ...common fields
}
```

### Agent Session Files (agent-*.jsonl)

Sub-agent sessions (launched via Task tool) are stored in separate files.

**Characteristics:**
- `isSidechain: true` - Indicates branching from main session
- `agentId: "ae1f9f8"` - Short agent ID (used in filename)
- Same `sessionId` - Belongs to the same session as parent

```json
{
  "type": "user",
  "isSidechain": true,
  "agentId": "ae1f9f8",
  "message": { "role": "user", "content": "Warmup" },
  "sessionId": "fe4c5fad-9703-4485-9e4f-b73a1f638c02",
  ...
}
```

### Session Metadata (~/.claude/sessions/*.json)

Per-process session metadata files, named by PID:

```json
{
  "pid": 12345,
  "sessionId": "0c1c6b33-5703-4c42-afd8-739ba2332d78",
  "cwd": "/Users/jane/project",
  "startedAt": 1774855549101,
  "kind": "interactive",
  "entrypoint": "cli"
}
```

### Sessions Index (sessions-index.json)

Located inside each project directory. Indexes sessions with metadata:

```json
{
  "version": 1,
  "entries": [
    {
      "sessionId": "cc4e3386-4331-4a06-8309-e19f251139b5",
      "fullPath": "/Users/jane/.claude/projects/-Users-jane-project/cc4e3386.jsonl",
      "fileMtime": 1769500777863,
      "firstPrompt": "pull latest",
      "summary": "...",
      "messageCount": 3,
      "projectPath": "/Users/jane/project",
      "isSidechain": false
    }
  ],
  "originalPath": "/Users/jane/project"
}
```

**Fields requiring update during migration:**
- `fullPath` — contains encoded project directory path
- `projectPath` — raw project path
- `originalPath` — raw project path

### Global History (history.jsonl)

User input history across all projects. Each line records a user input:

```json
{
  "display": "want to check PR, what PR do we have?",
  "pastedContents": {},
  "timestamp": 1759203123612,
  "project": "/Users/jane/Documents/myproject"
}
```

**Fields:**
- `display`: Display text (includes commands like "/context ")
- `pastedContents`: Pasted content (ID → content map)
- `timestamp`: Unix timestamp (milliseconds)
- `project`: Absolute path to project

---

## Cursor Data Structure

### Directory Layout

```
~/Library/Application Support/Cursor/
└── User/
    ├── globalStorage/
    │   ├── storage.json         # Global settings and profile associations
    │   └── state.vscdb          # Global state (SQLite)
    └── workspaceStorage/
        └── {md5-hash}/          # Per-workspace directory
            ├── workspace.json   # Workspace configuration
            └── state.vscdb      # Workspace state (SQLite, includes chat history)
```

### Path Format

Cursor stores paths in file:// URI format:

```
/Users/jane/my project
→ file:///Users/jane/my%20project
```

**URL Encoding Rules:**
- Space → `%20`
- Multibyte characters (Japanese, etc.) are also URL-encoded

### Workspace Hash Calculation

Workspace directory names are calculated as **MD5(path + birthtime_ms)**:

```javascript
const fs = require('fs');
const crypto = require('crypto');

const path = '/Users/jane/myproject';
const stat = fs.statSync(path);
const hash = crypto.createHash('md5')
    .update(path)
    .update(String(stat.birthtime.getTime()))  // birthtime in milliseconds
    .digest('hex');
// → "a1b2c3d4e5f6..."
```

**Important Notes:**

1. **Node.js Required**: Python's `os.stat().st_birthtime` rounds milliseconds differently (e.g., 583 vs 584), causing hash mismatch
2. **birthtime Preservation**: `mv` within the same volume preserves birthtime, so the new path's hash is predictable
3. **Cross-volume Moves**: Moving to a different volume may change birthtime (untested)

### storage.json

Profile-related settings. Multiple path formats coexist:

```json
{
  "profileAssociations": {
    "workspaces": {
      "file:///Users/jane/project-a": "profile-id-1",
      "/Users/jane/project-b": "profile-id-2",
      "~/Documents/project-c": "profile-id-3"
    }
  },
  ...
}
```

**Path Formats:**
- `file://` URI
- Absolute path
- Tilde-expanded path (`~/...`)

### state.vscdb (SQLite)

SQLite database. Main tables:

#### ItemTable

Key-Value store. `value` column contains JSON strings:

```sql
CREATE TABLE ItemTable (
    key TEXT PRIMARY KEY,
    value TEXT
);
```

**Key Keys:**
- `history.recentlyOpenedPathsList` - Recently opened projects list
- `repositoryTracker.paths` - Git repository tracking info

#### Global state.vscdb vs Workspace state.vscdb

| Location | Contents |
|----------|----------|
| `globalStorage/state.vscdb` | App-wide state (recently opened projects, etc.) |
| `workspaceStorage/{hash}/state.vscdb` | Per-workspace state (includes chat history) |

### workspace.json

Configuration file for each workspace:

```json
{
  "folder": "file:///Users/jane/project"
}
```

Or (when using workspace file):

```json
{
  "workspace": "file:///Users/jane/project.code-workspace"
}
```

### Chat History Storage (cursorDiskKV)

Cursor's chat history is stored in `workspaceStorage/{hash}/state.vscdb` in the `cursorDiskKV` table:

```sql
CREATE TABLE cursorDiskKV (
    key TEXT PRIMARY KEY,
    value TEXT
);
```

**Key Keys:**
- `composer.composerData` - Composer (chat) data

---

## Migration Considerations

### ccmv Processing Flow

```
1. validate           - Validate paths
2. detect_cursor      - Detect Cursor installation
3. check_cursor_not_running - Ensure Cursor is closed
4. find_cursor_workspaces - Identify workspace by hash calculation
5. create_backup      - Create backups
6. backup_cursor_data - Backup Cursor data
7. move_project       - Move project directory
8. rename_cursor_workspace - Rename workspace directory
9. rename_claude_dir  - Rename Claude project directory
10. update_project_files - Update cwd in session files
11. update_history    - Update "project" field in history.jsonl
12. update_sessions   - Update cwd in ~/.claude/sessions/*.json
13. update_sessions_index - Update sessions-index.json paths
14. update_cursor_*   - Update various Cursor files
15. verify            - Verify migration
```

### Key Update Points

#### Claude Code

| File/Directory | Update |
|----------------|--------|
| `~/.claude/projects/{encoded-old}/` | Rename directory |
| `cwd` field in `*.jsonl` | String replacement |
| `project` field in `history.jsonl` | String replacement |
| `cwd` field in `~/.claude/sessions/*.json` | String replacement |
| `sessions-index.json` | Update fullPath, projectPath, originalPath |

#### Cursor

| File | Update |
|------|--------|
| `workspaceStorage/{old-hash}/` | Rename directory to new hash |
| `workspace.json` | Update `folder`/`workspace` URI |
| `storage.json` | Update keys in `profileAssociations.workspaces` |
| `state.vscdb` (global) | Update paths in ItemTable values |
| `state.vscdb` (workspace) | Update paths in ItemTable + cursorDiskKV |

### Duplicate Workspace Handling

Cursor can create multiple workspace directories for the same path (from failed migrations, Cursor quirks, etc.).

**Merge Strategy:**
1. Detect all workspaces pointing to the new path
2. Compare `state.vscdb` sizes
3. Keep the larger one (more data)
4. Remove duplicates

---

## Appendix

### JSON Examples

#### Complete User Message Record

```json
{
  "parentUuid": null,
  "isSidechain": false,
  "userType": "external",
  "cwd": "/Users/jane/projects/myapp",
  "sessionId": "fe4c5fad-9703-4485-9e4f-b73a1f638c02",
  "version": "2.0.72",
  "gitBranch": "feature-branch",
  "type": "user",
  "message": {
    "role": "user",
    "content": "want to check PR, what PR do we have?"
  },
  "uuid": "fd49a8a2-68f3-4cdf-81f8-38508beda957",
  "timestamp": "2026-01-07T12:33:48.236Z"
}
```

#### Complete Assistant Message Record

```json
{
  "parentUuid": "fd49a8a2-68f3-4cdf-81f8-38508beda957",
  "isSidechain": false,
  "userType": "external",
  "cwd": "/Users/jane/projects/myapp",
  "sessionId": "fe4c5fad-9703-4485-9e4f-b73a1f638c02",
  "version": "2.0.72",
  "gitBranch": "feature-branch",
  "message": {
    "model": "claude-sonnet-4-5-20250929",
    "id": "msg_014FrefSYxpSnNHJcpNJZugw",
    "type": "message",
    "role": "assistant",
    "content": [
      {
        "type": "text",
        "text": "I'll check the PR list for you."
      }
    ],
    "stop_reason": null,
    "stop_sequence": null,
    "usage": {
      "input_tokens": 3,
      "cache_creation_input_tokens": 22320,
      "cache_read_input_tokens": 0,
      "cache_creation": {
        "ephemeral_5m_input_tokens": 22320,
        "ephemeral_1h_input_tokens": 0
      },
      "output_tokens": 1,
      "service_tier": "standard"
    }
  },
  "requestId": "req_011CWt2PcwHgdwPS37vwqRzv",
  "type": "assistant",
  "uuid": "0b0ede00-8fff-4d9e-b79e-fb4395ea2d34",
  "timestamp": "2026-01-07T12:33:54.356Z"
}
```

### Useful Commands

```bash
# Claude Code: Check cwd values in session files
grep -h "\"cwd\"" ~/.claude/projects/*/fe*.jsonl | jq -r '.cwd' | sort -u

# Claude Code: Count sessions for a specific project
ls -la ~/.claude/projects/-Users-jane-Desktop-myproject/*.jsonl | wc -l

# Cursor: Calculate workspace hash
node -e "
const fs = require('fs');
const crypto = require('crypto');
const path = '/Users/jane/myproject';
const stat = fs.statSync(path);
console.log(crypto.createHash('md5')
    .update(path)
    .update(String(stat.birthtime.getTime()))
    .digest('hex'));
"

# Cursor: Get recently opened projects from state.vscdb
sqlite3 ~/Library/Application\ Support/Cursor/User/globalStorage/state.vscdb \
  "SELECT value FROM ItemTable WHERE key = 'history.recentlyOpenedPathsList';" | jq .

# Cursor: Check workspace folders
cat ~/Library/Application\ Support/Cursor/User/workspaceStorage/*/workspace.json | jq -r '.folder // .workspace'
```
