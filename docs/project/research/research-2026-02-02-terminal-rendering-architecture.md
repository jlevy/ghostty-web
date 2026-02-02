# Research: Terminal Rendering Architecture for Rich Features

**Date:** 2026-02-02 (last updated 2026-02-02)

**Author:** Claude (AI Assistant)

**Status:** Complete

## Overview

This research investigates the ghostty-web terminal rendering architecture to understand what flexibility exists for implementing rich terminal features including overlays, highlights, collapsible regions, animations, and custom text styling.

## Questions to Answer

1. How does text get rendered from TTY/WASM through to the visual canvas?
2. What terminal data structures exist and how can they be manipulated?
3. What flexibility exists for customizing terminal presentation?
4. How feasible are specific features: iFrame overlays, regex highlights, collapsible blocks, animations, double-width/height characters?
5. How does this compare to xterm.js's architecture?

## Scope

**Included:**
- ghostty-web TypeScript codebase (`lib/`)
- WASM interface and data structures
- Canvas rendering pipeline
- Comparison with xterm.js decoration/overlay systems
- Feasibility analysis for requested features

**Excluded:**
- Native Ghostty (Zig) implementation details beyond API surface
- WebGL rendering implementation
- Performance benchmarking

## Findings

### Architecture Overview

ghostty-web is a TypeScript terminal emulator using:
- **WASM core**: Battle-tested Ghostty VT parser (compiled from Zig, ~160KB)
- **Canvas 2D rendering**: Native browser font rendering (NOT WebGL)
- **xterm.js-compatible API**: Drop-in replacement migration path

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Application                          │
├─────────────────────────────────────────────────────────────────┤
│                     Terminal Public API                          │
│  - Terminal class (xterm.js compatible)                          │
│  - write(), onData, resize(), open()                            │
├─────────────────────────────────────────────────────────────────┤
│                        JavaScript Layer                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ InputHandler │  │CanvasRenderer│  │SelectionMgr  │          │
│  │  (keyboard,  │  │  (2D canvas  │  │  (text       │          │
│  │   mouse)     │  │   drawing)   │  │   selection) │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ LinkDetector │  │  BufferAPI   │  │  FitAddon    │          │
│  │ (OSC8+regex) │  │  (read-only) │  │  (auto-size) │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
├─────────────────────────────────────────────────────────────────┤
│                    WASM Boundary (JS ↔ WASM)                     │
├─────────────────────────────────────────────────────────────────┤
│                      WASM Terminal Core                          │
│  - VT100/VT220 parser, Screen buffers, Scrollback               │
│  - Cursor, modes, attributes, Grapheme clustering               │
└─────────────────────────────────────────────────────────────────┘
```

### TTY-Level Architecture

The WASM module is compiled from Ghostty (Zig) via `zig build lib-vt`. Key interfaces:

**Terminal Lifecycle:**
```typescript
ghostty_terminal_new(cols, rows) → handle
ghostty_terminal_write(handle, dataPtr, dataLen) → void
ghostty_terminal_resize(handle, cols, rows) → void
ghostty_terminal_free(handle) → void
```

**RenderState API (Key Optimization):**
```typescript
ghostty_render_state_update(handle) → DirtyState (0=none, 1=partial, 2=full)
ghostty_render_state_get_viewport(handle, bufferPtr, cellCount) → actualCount
ghostty_render_state_is_row_dirty(handle, row) → bool
```

**Key Files:**
| Component | File Path |
|-----------|-----------|
| Terminal Class | `lib/terminal.ts` |
| WASM Wrapper | `lib/ghostty.ts` |
| Canvas Renderer | `lib/renderer.ts` |
| Input Handler | `lib/input-handler.ts` |
| Link Detection | `lib/link-detector.ts` |

### Terminal Data Structures

**GhosttyCell (16 bytes):**
```typescript
interface GhosttyCell {
  codepoint: number;      // u32 - Unicode codepoint
  fg_r/g/b: number;       // u8 - Foreground RGB
  bg_r/g/b: number;       // u8 - Background RGB
  flags: number;          // u8 - Style bitfield (bold, italic, underline, etc.)
  width: number;          // u8 - Character width (1=normal, 2=wide)
  hyperlink_id: number;   // u16 - OSC 8 hyperlink ID
  grapheme_len: number;   // u8 - Extra codepoints count
}
```

**Cell Flags:**
```typescript
enum CellFlags {
  BOLD=1<<0, ITALIC=1<<1, UNDERLINE=1<<2, STRIKETHROUGH=1<<3,
  INVERSE=1<<4, INVISIBLE=1<<5, BLINK=1<<6, FAINT=1<<7
}
```

### Visual Rendering Pipeline

ghostty-web uses **HTML5 Canvas 2D** with two-pass line rendering:
1. **Pass 1:** Draw all cell backgrounds
2. **Pass 2:** Draw all text and decorations

This is critical for complex scripts (Devanagari, Arabic) where glyphs extend beyond cell boundaries.

**Render Loop:**
```typescript
const loop = (currentTime: number) => {
  const dirtyState = wasmTerm.update();
  if (dirtyState !== DirtyState.NONE || forceRedraw) {
    renderer.render(wasmTerm, forceAll, viewportY);
  }
  animationFrameId = requestAnimationFrame(loop);
};
```

### Extension Points

**Current:**
1. **Link Providers** - Register custom regex patterns for detection/hover
2. **Theme System** - Full color customization
3. **Addons** - FitAddon pattern supports extensions

**Missing (compared to xterm.js):**
- Decoration API for overlays
- Render layers for custom drawing
- Pre/post render hooks

### xterm.js Comparison

| Aspect | ghostty-web | xterm.js |
|--------|-------------|----------|
| Rendering | Canvas 2D | Canvas 2D + WebGL addon |
| Terminal Core | WASM (Zig) | Pure TypeScript |
| Overlay System | None | Rich Decoration API |
| Extension Points | Limited | Render layers, markers, decorations |

xterm.js has a rich decoration API:
```typescript
const marker = terminal.registerMarker(lineNumber);
const decoration = terminal.registerDecoration({
  marker, anchor: 'left', width: 10, height: 1,
  backgroundColor: '#ff000040', layer: 'top'
});
decoration.onRender((element) => { /* Custom DOM */ });
```

## Options Considered

### Option A: DOM Overlay Layer

**Description:** Add a positioned DOM layer above the canvas for tooltips, popovers, and iFrames.

**Pros:**
- Simple implementation
- Full HTML/CSS capabilities
- iFrame support with standard browser APIs

**Cons:**
- Separate from canvas rendering
- Requires coordinate mapping
- Z-index management complexity

### Option B: Extend Link Provider System

**Description:** Enhance existing link detection to support background highlights and custom handlers.

**Pros:**
- Builds on existing architecture
- Already supports hover/click
- Low risk, incremental change

**Cons:**
- Limited to regex-based detection
- No arbitrary overlay positioning

### Option C: Port xterm.js Decoration API

**Description:** Implement marker-based decoration system similar to xterm.js.

**Pros:**
- Proven API design
- Enables many features
- Good foundation for extensibility

**Cons:**
- More significant implementation effort
- Needs integration with WASM state

### Option D: Virtual Viewport for Collapsible Regions

**Description:** Add display-to-actual line mapping layer for hiding/showing regions.

**Pros:**
- True text collapse (not just overlay)
- Clean scrollbar integration

**Cons:**
- Significant architecture change
- Complex state management
- Scroll handling complications

## Recommendations

### Feature Feasibility Summary

| Feature | Difficulty | Recommended Approach |
|---------|------------|---------------------|
| **iFrame overlays** | Medium | DOM layer above canvas |
| **Regex hover/highlight** | Easy | Extend existing link system |
| **Collapsible blocks** | Hard | Virtual viewport layer |
| **Smooth animations** | Medium | Already partially exists |
| **Double-width/height** | Medium-Hard | WASM patch + renderer changes |

### Priority Order

1. **Regex highlights** (Easy) - Extend link provider, add background option
2. **DOM overlays** (Medium) - Add OverlayManager class for tooltips/popovers
3. **Decoration API** (Medium) - Port xterm.js concepts for extensibility
4. **Collapsible blocks** (Hard) - Virtual viewport, phased approach

### Architecture Additions Needed

1. **Render Callback System:**
   ```typescript
   terminal.onBeforeRender((ctx, state) => { /* pre-render */ });
   terminal.onAfterRender((ctx, state) => { /* post-render */ });
   ```

2. **Overlay Container:**
   - Positioned DOM layer
   - Cell coordinate utilities
   - Z-index management

3. **Decoration Service:**
   - Marker-based position tracking
   - DOM element management
   - Scroll/resize integration

## Next Steps

- [ ] Implement regex highlight background option in link provider
- [ ] Add OverlayManager class for DOM overlays
- [ ] Design decoration API interface
- [ ] Prototype virtual viewport for collapsible regions
- [ ] Evaluate WASM changes needed for double-width/height lines

## References

- [ghostty-web source](lib/)
- [Original Ghostty (Zig)](https://github.com/ghostty-org/ghostty)
- [xterm.js](https://github.com/xtermjs/xterm.js)
- [xterm.js Decoration API](https://xtermjs.org/docs/api/terminal/interfaces/IDecoration/)

---

## Appendix: Detailed Technical Findings

### WASM Interface Details

**Terminal Lifecycle:**
```typescript
ghostty_terminal_new(cols, rows) → handle
ghostty_terminal_new_with_config(cols, rows, configPtr) → handle
ghostty_terminal_write(handle, dataPtr, dataLen) → void
ghostty_terminal_resize(handle, cols, rows) → void
ghostty_terminal_free(handle) → void
```

**RenderState API:**
```typescript
// Single call to sync all changes
ghostty_render_state_update(handle) → DirtyState

// Bulk cell access - ALL cells in one WASM call
ghostty_render_state_get_viewport(handle, bufferPtr, cellCount) → actualCount

// Dirty tracking for incremental updates
ghostty_render_state_is_row_dirty(handle, row) → bool
ghostty_render_state_mark_clean(handle) → void

// Cursor state
ghostty_render_state_get_cursor_x/y() → position
ghostty_render_state_get_cursor_visible() → bool

// Grapheme support for complex scripts
ghostty_render_state_get_grapheme(handle, row, col, bufPtr, maxLen) → codepointCount
```

**Scrollback API:**
```typescript
ghostty_terminal_get_scrollback_length() → lineCount
ghostty_terminal_get_scrollback_line(offset, bufPtr, maxCells) → cellCount
ghostty_terminal_is_row_wrapped(row) → bool
```

**Terminal Mode Queries:**
```typescript
ghostty_terminal_get_mode(modeNum, isAnsi) → bool
ghostty_terminal_is_alternate_screen() → bool
ghostty_terminal_has_mouse_tracking() → bool
ghostty_terminal_has_bracketed_paste() → bool
```

### Buffer Architecture

```
BufferNamespace
├── active: IBuffer         # Currently visible (normal or alternate)
├── normal: IBuffer         # Primary buffer with scrollback
└── alternate: IBuffer      # Full-screen apps (vim, less)

IBuffer
├── type: 'normal' | 'alternate'
├── length: number          # Total lines (scrollback + viewport)
├── cursorX/Y: number
├── getLine(y): IBufferLine
└── getNullCell(): IBufferCell
```

### Cell Pool Optimization

Zero-allocation rendering via object reuse:
```typescript
private cellPool: GhosttyCell[] = [];

// Pre-allocate on terminal creation/resize
ensureCellPool(count: number): void {
  while (this.cellPool.length < count) {
    this.cellPool.push({ /* default cell */ });
  }
}

// Reuse on every frame (no allocation)
parseCellsIntoPool(ptr: number, count: number): void {
  for (let i = 0; i < count; i++) {
    const cell = this.cellPool[i];
    // Update existing object fields from WASM memory
  }
}
```

### VT100 Double-Width/Height (DECDWL/DECDHL)

VT100 terminals supported per-line modes not currently implemented:
- **DECDWL**: Double-Width Line (`ESC # 6`)
- **DECDHL Top**: Double-Height Line, top half (`ESC # 3`)
- **DECDHL Bottom**: Double-Height Line, bottom half (`ESC # 4`)

Would require WASM changes to add line-level attributes and renderer changes to scale appropriately.

### xterm.js Render Layer System

```
Base Layer (backgrounds)
  ↓
Glyph Layer (text)
  ↓
Selection Layer
  ↓
Cursor Layer
  ↓
Link Layer (underlines)
  ↓
DOM Overlays
```

ghostty-web renders everything in a single pass, which is simpler but less flexible for custom visual effects.
