# Agent Guide - Ghostty WASM Terminal

**For AI coding agents working on this repository.**

## Quick Start

```bash
bun install                          # Install dependencies
bun test                            # Run test suite (95 tests)
bun run dev                         # Start Vite dev server (http://localhost:8000)
```

**Before committing, always run:**

```bash
bun run fmt && bun run lint && bun run typecheck && bun test && bun run build
```

**Run interactive terminal demo:**

```bash
cd demo/server && bun install && bun run start  # Terminal 1: PTY server
bun run dev                                     # Terminal 2: Web server
# Open: http://localhost:8000/demo/
```

## Project State

This is a **fully functional terminal emulator** (MVP complete) that uses Ghostty's battle-tested VT100 parser compiled to WebAssembly.

**What works:**

- ✅ Full VT100/ANSI terminal emulation (vim, htop, colors, etc.)
- ✅ Canvas-based renderer with 60 FPS
- ✅ Keyboard input handling (Kitty keyboard protocol)
- ✅ Text selection and clipboard
- ✅ WebSocket PTY integration (real shell sessions)
- ✅ xterm.js-compatible API
- ✅ FitAddon for responsive sizing
- ✅ Comprehensive test suite (terminal, renderer, input, selection)

**Tech stack:**

- TypeScript + Bun runtime for tests
- Vite for dev server and bundling
- Ghostty WASM (404 KB, committed) for VT100 parsing
- Canvas API for rendering

## Architecture

```
┌─────────────────────────────────────────┐
│  Terminal (lib/terminal.ts)             │  xterm.js-compatible API
│  - Public API, event handling           │
└───────────┬─────────────────────────────┘
            │
            ├─► GhosttyTerminal (WASM)
            │   └─ VT100 state machine, screen buffer
            │
            ├─► CanvasRenderer (lib/renderer.ts)
            │   └─ 60 FPS rendering, all colors/styles
            │
            ├─► InputHandler (lib/input-handler.ts)
            │   └─ Keyboard events → escape sequences
            │
            └─► SelectionManager (lib/selection-manager.ts)
                └─ Text selection + clipboard

Ghostty WASM Bridge (lib/ghostty.ts)
├─ Ghostty - WASM loader
├─ GhosttyTerminal - Terminal instance wrapper
└─ KeyEncoder - Keyboard event encoding
```

### Key Files

| File                        | Lines | Purpose                             |
| --------------------------- | ----- | ----------------------------------- |
| `lib/terminal.ts`           | 427   | Main Terminal class, xterm.js API   |
| `lib/ghostty.ts`            | 552   | WASM bridge, memory management      |
| `lib/renderer.ts`           | 610   | Canvas renderer with font metrics   |
| `lib/input-handler.ts`      | 438   | Keyboard → escape sequences         |
| `lib/selection-manager.ts`  | 442   | Text selection + clipboard          |
| `lib/types.ts`              | 454   | TypeScript definitions for WASM ABI |
| `lib/addons/fit.ts`         | 240   | Responsive terminal sizing          |
| `demo/server/pty-server.ts` | 284   | WebSocket PTY server (real shell)   |

### WASM Integration Pattern

**What's in Ghostty WASM:**

- VT100/ANSI state machine (the hard part)
- Screen buffer (2D cell grid)
- Cursor tracking
- Scrollback buffer
- SGR parsing (colors/styles)
- Key encoding

**What's in TypeScript:**

- Terminal API (xterm.js compatibility)
- Canvas rendering
- Input event handling
- Selection/clipboard
- Addons (FitAddon)
- WebSocket/PTY integration

**Memory Management:**

- WASM exports linear memory
- TypeScript reads cell data via typed arrays
- No manual malloc/free needed (Ghostty manages internally)
- Get cell pointer: `wasmTerm.getScreenCells()`
- Read cells: `new Uint8Array(memory.buffer, ptr, size)`

## Development Workflows

### Before Committing

**⚠️ Always run all CI checks before committing:**

```bash
bun run fmt                           # Check formatting (Prettier)
bun run lint                          # Run linter (Biome)
bun run typecheck                     # Type check (TypeScript)
bun test                              # Run tests (95 tests)
bun run build                         # Build library
```

All at once: `bun run fmt && bun run lint && bun run typecheck && bun test && bun run build`

Auto-fix formatting: `bun run fmt:fix`

### Running Tests

```bash
bun test                              # Run all tests
bun test lib/terminal.test.ts         # Run specific file
bun test --watch                      # Watch mode (may hang - use Ctrl+C and restart)
bun test -t "test name pattern"       # Run matching tests
```

**Test files:** `*.test.ts` in `lib/` (terminal, renderer, input-handler, selection-manager, fit)

### Running Demos

**⚠️ CRITICAL: Use Vite dev server!** Plain HTTP server won't handle TypeScript imports.

```bash
# ✅ CORRECT
bun run dev                           # Vite with TS support
# Open: http://localhost:8000/demo/

# ❌ WRONG
python3 -m http.server                # Can't handle .ts imports
```

**Available demos:**

- `demo/index.html` - Interactive shell terminal (requires PTY server)
- `demo/colors-demo.html` - ANSI color showcase (no server needed)

### Type Checking

```bash
bun run typecheck                     # Check types without compiling
```

### Debugging

**Browser console (F12):**

```javascript
// Access terminal instance (if exposed in demo)
term.write('Hello!\r\n');
(term.cols, term.rows);
term.wasmTerm.getCursor(); // WASM cursor state

// Check WASM memory
const cells = term.wasmTerm.getLine(0);
console.log(cells);
```

**Common issues:**

- Rendering glitches → Check `renderer.ts` dirty tracking
- Input not working → Check `input-handler.ts` key mappings
- Selection broken → Check `selection-manager.ts` mouse handlers
- WASM crashes → Check memory buffer validity (may change when memory grows)

## Code Patterns

### Adding Terminal Features

**1. Extend Terminal class (`lib/terminal.ts`):**

```typescript
export class Terminal {
  // Add public method
  public myFeature(): void {
    if (!this.wasmTerm) throw new Error('Not open');
    // Use WASM terminal API
    this.wasmTerm.write('...');
  }

  // Add event
  private myEventEmitter = new EventEmitter<string>();
  public readonly onMyEvent = this.myEventEmitter.event;
}
```

**2. Create Addon (`lib/addons/`):**

```typescript
export class MyAddon implements ITerminalAddon {
  private terminal?: Terminal;

  activate(terminal: Terminal): void {
    this.terminal = terminal;
    // Initialize addon
  }

  dispose(): void {
    // Cleanup
  }
}
```

### Using Ghostty WASM API

```typescript
// Get terminal instance
const ghostty = await Ghostty.load('./ghostty-vt.wasm');
const wasmTerm = ghostty.createTerminal(80, 24);

// Write data (processes VT100 sequences)
wasmTerm.write('Hello\r\n\x1b[1;32mGreen\x1b[0m');

// Read screen state
const cursor = wasmTerm.getCursor(); // {x, y, visible, shape}
const cells = wasmTerm.getLine(0); // GhosttyCell[]
const cell = cells[0]; // {codepoint, fg, bg, flags}

// Check cell flags
const isBold = (cell.flags & CellFlags.BOLD) !== 0;
const isItalic = (cell.flags & CellFlags.ITALIC) !== 0;

// Color extraction
if (cell.fg.type === 'rgb') {
  const { r, g, b } = cell.fg.value;
} else if (cell.fg.type === 'palette') {
  const index = cell.fg.value; // 0-255
}

// Resize
wasmTerm.resize(100, 30);

// Clear screen
wasmTerm.write('\x1bc'); // RIS (Reset to Initial State)
```

### Event System

```typescript
// Terminal uses EventEmitter for xterm.js compatibility
private dataEmitter = new EventEmitter<string>();
public readonly onData = this.dataEmitter.event;

// Emit events
this.dataEmitter.fire('user input data');

// Subscribe (returns IDisposable)
const disposable = term.onData(data => {
  console.log(data);
});
disposable.dispose();  // Unsubscribe
```

### Testing Patterns

```typescript
import { describe, test, expect } from 'bun:test';

describe('MyFeature', () => {
  test('should do something', async () => {
    const term = new Terminal({ cols: 80, rows: 24 });
    const container = document.createElement('div');
    await term.open(container);

    term.write('test\r\n');

    // Check WASM state
    const cursor = term.wasmTerm!.getCursor();
    expect(cursor.y).toBe(1);

    term.dispose();
  });
});
```

**Test helpers:**

- Use `document.createElement()` for DOM elements
- Always `await term.open()` before testing
- Always `term.dispose()` in cleanup
- Use `term.wasmTerm` to access WASM API directly

## Critical Gotchas

### 1. **Must Use Vite Dev Server**

```bash
# ✅ Works - Vite transpiles TypeScript
bun run dev

# ❌ Fails - Browser can't load .ts files directly
python3 -m http.server
```

**Why:** Demos import TypeScript modules directly (`from './lib/terminal.ts'`). Need Vite to transpile.

### 2. **WASM Binary is Committed**

- `ghostty-vt.wasm` (404 KB) is in the repo
- Don't need to rebuild unless updating Ghostty version
- Rebuild instructions in README.md if needed

### 3. **Test Timeouts**

- `bun test` may hang on completion (known issue)
- Use `Ctrl+C` to exit
- Tests actually pass before hang
- Use `bun test lib/specific.test.ts` to limit scope

### 4. **WASM Memory Buffer Invalidation**

```typescript
// ❌ WRONG - buffer may become invalid
const buffer = this.memory.buffer;
// ... time passes, memory grows ...
const view = new Uint8Array(buffer);  // May be detached!

// ✅ CORRECT - get fresh buffer each time
private getBuffer(): ArrayBuffer {
  return this.memory.buffer;
}
const view = new Uint8Array(this.getBuffer(), ptr, size);
```

### 5. **PTY Server Required for Interactive Demos**

```bash
# Terminal needs PTY server running
cd demo/server
bun run start

# Then access from browser
# http://localhost:8000/demo/
```

**WebSocket connects to:** `ws://localhost:3001/ws` (or current hostname)

### 6. **Canvas Rendering Requires Container Resize**

```typescript
// After opening terminal, must call fit
const fitAddon = new FitAddon();
term.loadAddon(fitAddon);
await term.open(container);
fitAddon.fit(); // ⚠️ Required! Otherwise terminal may not render

// On window resize
window.addEventListener('resize', () => fitAddon.fit());
```

## Common Tasks

### Add New Escape Sequence Support

**Option 1: If Ghostty WASM already supports it**

- Just write data, WASM handles it
- Update renderer if new visual features needed

**Option 2: If not in WASM**

- Feature needs to be added to Ghostty upstream
- Then rebuild WASM binary

### Fix Rendering Issue

1. Check if cells are correct: `wasmTerm.getLine(y)`
2. Check if dirty tracking works: `renderer.render()`
3. Check font metrics: `renderer['fontMetrics']`
4. Check color conversion: `renderer['applyStyle']()`

### Add Keyboard Shortcut

```typescript
// In input-handler.ts
if (e.ctrlKey && e.key === 'c') {
  // Handle Ctrl+C
  return '\x03'; // ETX character
}
```

### Debug Selection

```typescript
// In selection-manager.ts
console.log('Selection:', this.start, this.end);
console.log('Selected text:', this.getSelectedText());
```

## Resources

- **Ghostty Source:** https://github.com/ghostty-org/ghostty
- **VT100 Reference:** https://vt100.net/docs/vt100-ug/
- **ANSI Escape Codes:** https://en.wikipedia.org/wiki/ANSI_escape_code
- **xterm.js API:** https://xtermjs.org/docs/api/terminal/

## Questions?

When stuck:

1. Read the test files - they show all API usage patterns
2. Look at demo code in `demo/*.html`
3. Read Ghostty source for WASM implementation details
4. Check xterm.js docs for API compatibility questions


<!-- BEGIN TBD INTEGRATION -->
---
title: tbd Workflow
description: Full tbd workflow guide for agents
---
**`tbd` helps humans and agents ship code with greater speed, quality, and discipline.**

1. **Beads**: Git-native issue tracking (tasks, bugs, features).
   Never lose work across sessions.
2. **Spec-Driven Workflows**: Plan features → break into beads → implement
   systematically.
3. **Shortcuts**: Reusable instruction templates for common workflows.
4. **Guidelines**: Coding rules and best practices.

## Installation

```bash
npm install -g get-tbd@latest
tbd setup --auto --prefix=<name>   # Fresh project (--prefix is REQUIRED and should be short. For new project setup, ALWAYS ASK THE USER FOR THE PREFIX; do not guess it)
tbd setup --auto                   # Existing tbd project (prefix already set)
tbd setup --from-beads             # Migration from .beads/ if `bd` has been used
```

## Routine Commands

```bash
tbd --help    # Command reference
tbd status    # Status
tbd doctor    # If there are problems

tbd setup --auto   # Run any time to refresh setup
tbd prime      # Restore full context on tbd after compaction
```

## CRITICAL: You Operate tbd — The User Doesn’t

**You are the tbd operator:** Users talk naturally; you translate their requests to tbd
actions. DO NOT tell users to run tbd commands.
That’s your job.

- **WRONG**: "Run `tbd create` to track this bug"

- **RIGHT**: *(you run `tbd create` yourself and tell the user it’s tracked)*

**Welcoming a user:** When users ask “what is tbd?”
or want help → run `tbd shortcut welcome-user`

## User Request → Agent Action

| User Says | You (the Agent) Run |
| --- | --- |
| "There's a bug where ..." | `tbd create "..." --type=bug` |
| "Let's work on issues" | `tbd ready` |
| "Build a TypeScript CLI" | `tbd guidelines typescript-cli-tool-rules` |
| "Improve eslint/monorepo" | `tbd guidelines typescript-monorepo-patterns` |
| "Add e2e/golden testing" | `tbd guidelines golden-testing-guidelines` |
| "Review changes" (TS) | `tbd guidelines typescript-rules` |
| "Review changes" (Python) | `tbd guidelines python-rules` |
| "Plan a new feature" | `tbd shortcut new-plan-spec` |
| "Break spec into beads" | `tbd shortcut plan-implementation-with-beads` |
| "Implement these beads" | `tbd shortcut implement-beads` |
| "Commit this" | `tbd shortcut commit-code` |
| "Create a PR" | `tbd shortcut create-or-update-pr-simple` |
| "Research this topic" | `tbd shortcut new-research-brief` |
| "Document architecture" | `tbd shortcut new-architecture-doc` |
| *(your choice whenever appropriate)* | `tbd list`, `tbd dep add`, `tbd close`, `tbd sync`, etc. |

## CRITICAL: Session Closing Protocol

**Before saying “done”, you MUST complete this checklist:**

```
[ ] 1. git add + git commit
[ ] 2. git push
[ ] 3. gh pr checks <PR> --watch 2>&1 (IMPORTANT: WAIT for final summary, do NOT tell user it is done until you confirm it passes CI!)
[ ] 4. tbd close/update <id> for all beads worked on
[ ] 5. tbd sync
[ ] 6. CONFIRM CI passed (if failed: fix, run tests, re-push, restart from step 3)
```

**Work is not done until pushed, CI passes, and tbd is synced.**

## Bead Tracking Rules

- Track all task work not done immediately as beads (discovered work, TODOs,
  multi-session work)
- When in doubt, create a bead
- Check `tbd ready` when not given specific directions
- Always close/update beads and run `tbd sync` at session end

## Commands

### Finding Work

| Command | Purpose |
| --- | --- |
| `tbd ready` | Beads ready to work (no blockers) |
| `tbd list --status open` | All open beads |
| `tbd list --status in_progress` | Your active work |
| `tbd show <id>` | Bead details with dependencies |

### Creating & Updating

| Command | Purpose |
| --- | --- |
| `tbd create "title" --type task\|bug\|feature --priority=P2` | New bead (P0-P4, not "high/medium/low") |
| `tbd update <id> --status in_progress` | Claim work |
| `tbd close <id> [--reason "..."]` | Mark complete |

### Dependencies & Sync

| Command | Purpose |
| --- | --- |
| `tbd dep add <bead> <depends-on>` | Add dependency |
| `tbd blocked` | Show blocked beads |
| `tbd sync` | Sync with git remote (run at session end) |
| `tbd stats` | Project statistics |
| `tbd doctor` | Check for problems |

### Documentation

| Command | Purpose |
| --- | --- |
| `tbd shortcut <name>` | Run a shortcut |
| `tbd shortcut --list` | List shortcuts |
| `tbd guidelines <name>` | Load coding guidelines |
| `tbd guidelines --list` | List guidelines |
| `tbd template <name>` | Output a template |

## Quick Reference

- **Priority**: P0=critical, P1=high, P2=medium (default), P3=low, P4=backlog
- **Types**: task, bug, feature, epic
- **Status**: open, in_progress, closed
- **JSON output**: Add `--json` to any command

<!-- BEGIN SHORTCUT DIRECTORY -->
## Available Shortcuts

Run `tbd shortcut <name>` to use any of these shortcuts:

| Name | Description |
| --- | --- |
| agent-handoff | Generate a concise handoff prompt for another coding agent to continue work |
| cleanup-all | Full cleanup cycle including duplicate removal, dead code, and code quality improvements |
| cleanup-remove-trivial-tests | Review and remove tests that do not add meaningful coverage |
| cleanup-update-docstrings | Review and add concise docstrings to major functions and types |
| commit-code | Run pre-commit checks, review changes, and commit code |
| create-or-update-pr-simple | Create or update a pull request with a concise summary |
| create-or-update-pr-with-validation-plan | Create or update a pull request with a detailed test/validation plan |
| implement-beads | Implement beads from a spec, following TDD and project rules |
| merge-upstream | Merge origin/main into current branch with conflict resolution |
| new-architecture-doc | Create an architecture document for a system or component design |
| new-guideline | Create a new coding guideline document for tbd |
| new-plan-spec | Create a new feature planning specification document |
| new-research-brief | Create a research document for investigating a topic or technology |
| new-shortcut | Create a new shortcut (reusable instruction template) for tbd |
| new-validation-plan | Create a validation/test plan showing what's tested and what remains |
| plan-implementation-with-beads | Create implementation beads from a feature planning spec |
| precommit-process | Full pre-commit checklist including spec sync, code review, and testing |
| review-code | Comprehensive code review for uncommitted changes, branch work, or GitHub PRs |
| review-code-python | Python-focused code review (language-specific rules only) |
| review-code-typescript | TypeScript-focused code review (language-specific rules only) |
| review-github-pr | Review a GitHub pull request with follow-up actions (comment, fix, CI check) |
| revise-all-architecture-docs | Comprehensive revision of all current architecture documents |
| revise-architecture-doc | Update an architecture document to reflect current codebase state |
| setup-github-cli | Ensure GitHub CLI (gh) is installed and working |
| sync-failure-recovery | Handle tbd sync failures by saving to workspace and recovering later |
| update-specs-status | Review active specs and sync their status with tbd issues |
| welcome-user | Welcome message for users after tbd installation or setup |

## Available Guidelines

Run `tbd guidelines <name>` to apply any of these guidelines:

| Name | Description |
| --- | --- |
| backward-compatibility-rules | Guidelines for maintaining backward compatibility across code, APIs, file formats, and database schemas |
| cli-agent-skill-patterns | Best practices for building TypeScript CLIs that function as agent skills in Claude Code and other AI coding agents |
| commit-conventions | Conventional Commits format with extensions for agentic workflows |
| convex-limits-best-practices | Comprehensive reference for Convex platform limits, workarounds, and performance best practices |
| convex-rules | Guidelines and best practices for building Convex projects, including database schema design, queries, mutations, and real-world examples |
| error-handling-rules | Rules for handling errors, failures, and exceptional conditions |
| general-coding-rules | Rules for constants, magic numbers, and general coding practices |
| general-comment-rules | Language-agnostic rules for writing clean, maintainable comments |
| general-eng-assistant-rules | Rules for AI assistants acting as senior engineers, including objectivity and communication guidelines |
| general-style-rules | Style guidelines for auto-formatting, emoji usage, and output formatting |
| general-tdd-guidelines | Test-Driven Development methodology and best practices |
| general-testing-rules | Rules for writing minimal, effective tests with maximum coverage |
| golden-testing-guidelines | Guidelines for implementing golden/snapshot testing for complex systems |
| python-cli-patterns | Modern patterns for Python CLI application architecture |
| python-modern-guidelines | Guidelines for modern Python projects using uv, with a few more opinionated practices |
| python-rules | General Python coding rules and best practices |
| sync-troubleshooting | Common issues and solutions for tbd sync and workspace operations |
| typescript-cli-tool-rules | Rules for building CLI tools with Commander.js, picocolors, and TypeScript |
| typescript-code-coverage | Best practices for code coverage in TypeScript with Vitest and v8 provider |
| typescript-monorepo-patterns | Modern patterns for TypeScript monorepo architecture |
| typescript-rules | TypeScript coding rules and best practices |

<!-- END SHORTCUT DIRECTORY -->
<!-- END TBD INTEGRATION -->
