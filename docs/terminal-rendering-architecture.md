# Ghostty-Web Terminal Rendering Architecture

## Research Document: Terminal Rendering Deep Dive

This document provides a comprehensive analysis of the ghostty-web terminal rendering architecture, including the TTY/WASM layer, visual rendering pipeline, terminal data structures, and an assessment of what changes are possible for implementing rich terminal features.

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Architecture Overview](#architecture-overview)
3. [TTY-Level Architecture](#tty-level-architecture)
4. [Visual Rendering Pipeline](#visual-rendering-pipeline)
5. [Terminal Data Structures](#terminal-data-structures)
6. [Flexibility and Manipulation Points](#flexibility-and-manipulation-points)
7. [Feature Implementation Analysis](#feature-implementation-analysis)
8. [Comparison with xterm.js](#comparison-with-xtermjs)
9. [Implementation Recommendations](#implementation-recommendations)

---

## Executive Summary

**ghostty-web** is a TypeScript terminal emulator that uses:
- **WASM core**: Battle-tested Ghostty VT parser (compiled from Zig)
- **Canvas 2D rendering**: Direct native font rendering (NOT WebGL)
- **xterm.js-compatible API**: Drop-in replacement migration path

### Key Architectural Decisions

| Aspect | ghostty-web | xterm.js |
|--------|-------------|----------|
| **Rendering** | Canvas 2D | Canvas 2D + WebGL addon |
| **Terminal Core** | WASM (Zig) | Pure TypeScript |
| **Glyph System** | Native browser fonts | Texture atlas (WebGL) |
| **Overlay System** | None (DOM possible) | Decoration API + Render Layers |
| **Extension Points** | Limited | Rich addon system |

### Feasibility Summary

| Feature | Difficulty | Approach |
|---------|------------|----------|
| **iFrame overlays** | Medium | DOM layer above canvas |
| **Regex hover/highlight** | Easy | Extend existing link system |
| **Collapsible blocks** | Hard | Requires virtual viewport |
| **Smooth animations** | Medium | Already partially exists |
| **Double-width/height** | Medium-Hard | WASM + renderer changes |

---

## Architecture Overview

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
│  - ghostty_terminal_new/write/resize/free                       │
│  - ghostty_render_state_* (bulk cell access)                    │
│  - ghostty_key_encoder_* (key → escape sequences)               │
├─────────────────────────────────────────────────────────────────┤
│                      WASM Terminal Core                          │
│  - VT100/VT220 parser (battle-tested from native Ghostty)       │
│  - Screen buffers (normal + alternate)                          │
│  - Scrollback history                                            │
│  - Cursor, modes, attributes                                     │
│  - Grapheme clustering (Unicode)                                 │
│  - OSC 8 hyperlink tracking                                      │
└─────────────────────────────────────────────────────────────────┘
```

### Key Files

| Component | File Path |
|-----------|-----------|
| Public API | `lib/index.ts` |
| Terminal Class | `lib/terminal.ts` |
| WASM Wrapper | `lib/ghostty.ts` |
| Canvas Renderer | `lib/renderer.ts` |
| Input Handler | `lib/input-handler.ts` |
| Selection Manager | `lib/selection-manager.ts` |
| Link Detection | `lib/link-detector.ts` |
| Buffer API | `lib/buffer.ts` |
| Type Definitions | `lib/types.ts`, `lib/interfaces.ts` |

---

## TTY-Level Architecture

### WASM Module Origin

The WASM module is compiled from the **Ghostty** native terminal emulator (written in Zig):

```bash
# Build process (scripts/build-wasm.sh)
cd ghostty
zig build lib-vt -Dtarget=wasm32-freestanding -Doptimize=ReleaseSmall
# Output: ghostty-vt.wasm (~160KB)
```

A patch (`patches/ghostty-wasm-api.patch`) exposes the terminal API for JavaScript consumption.

### WASM Interface

**Terminal Lifecycle:**
```typescript
ghostty_terminal_new(cols, rows) → handle
ghostty_terminal_new_with_config(cols, rows, configPtr) → handle
ghostty_terminal_write(handle, dataPtr, dataLen) → void
ghostty_terminal_resize(handle, cols, rows) → void
ghostty_terminal_free(handle) → void
```

**RenderState API (Key Optimization):**
```typescript
// Single call to sync all changes
ghostty_render_state_update(handle) → DirtyState (0=none, 1=partial, 2=full)

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

### Data Flow

```
Application writes data
    ↓
Terminal.write(data: string | Uint8Array)
    ↓
Convert to Uint8Array, allocate WASM buffer
    ↓
ghostty_terminal_write(handle, ptr, len)
    ↓
WASM parses VT sequences, updates internal state:
  - Cell grid (codepoints, colors, attributes)
  - Cursor position
  - Terminal modes
  - Hyperlink tracking
  - Dirty row flags
    ↓
ghostty_render_state_update() → DirtyState
    ↓
ghostty_render_state_get_viewport() → GhosttyCell[]
    ↓
JavaScript receives cell array for rendering
```

### Terminal Responses

Some escape sequences require the terminal to send responses back (DSR, cursor position reports):

```typescript
ghostty_terminal_has_response() → bool
ghostty_terminal_read_response(bufPtr, maxLen) → byteCount
```

The Terminal class polls for responses and emits them via the `onData` event.

---

## Visual Rendering Pipeline

### Rendering Technology: Canvas 2D

ghostty-web uses **HTML5 Canvas 2D** (NOT WebGL). This provides:
- ✅ Simpler implementation
- ✅ Native browser font rendering (unlimited fonts)
- ✅ Excellent complex script support (Devanagari, Arabic, etc.)
- ✅ No shader compilation or texture atlas management
- ❌ Less flexibility for custom visual effects
- ❌ No GPU-accelerated glyph rendering

### Render Loop

```typescript
// lib/terminal.ts - Animation loop
const loop = (currentTime: number) => {
  // 1. Sync with WASM state
  const dirtyState = wasmTerm.update();

  // 2. Render to canvas
  if (renderer && (dirtyState !== DirtyState.NONE || forceRedraw)) {
    renderer.render(wasmTerm, forceAll, viewportY, scrollbackProvider);
  }

  // 3. Schedule next frame
  animationFrameId = requestAnimationFrame(loop);
};
```

### Two-Pass Line Rendering

**Critical for complex scripts** where glyphs can extend beyond cell boundaries:

```typescript
// lib/renderer.ts - renderLine()
private renderLine(line: GhosttyCell[], y: number, cols: number): void {
  // PASS 1: Draw all backgrounds first
  for (let x = 0; x < line.length; x++) {
    const cell = line[x];
    if (cell.width === 0) continue; // Skip spacer cells
    this.renderCellBackground(cell, x, y);
  }

  // PASS 2: Draw all text (can now extend across cell boundaries)
  for (let x = 0; x < line.length; x++) {
    const cell = line[x];
    if (cell.width === 0) continue;
    this.renderCellText(cell, x, y);
  }
}
```

**Why two-pass?** Complex scripts like Devanagari have vowel signs (like ि) that extend LEFT into the previous cell. Single-pass rendering would cover these extensions with subsequent cell backgrounds.

### Font Measurement

```typescript
// lib/renderer.ts - measureFont()
private measureFont(): FontMetrics {
  const ctx = offscreenCanvas.getContext('2d');
  ctx.font = `${this.fontSize}px ${this.fontFamily}`;

  // Measure 'M' for width (typically widest)
  const widthMetrics = ctx.measureText('M');
  const width = Math.ceil(widthMetrics.width);

  // Use actual ascent/descent for height
  const ascent = widthMetrics.actualBoundingBoxAscent || fontSize * 0.8;
  const descent = widthMetrics.actualBoundingBoxDescent || fontSize * 0.2;
  const height = Math.ceil(ascent + descent) + 2; // +2 for overflow

  return { width, height, baseline: Math.ceil(ascent) + 1 };
}
```

### DPI Scaling

```typescript
// lib/renderer.ts - resize()
public resize(cols: number, rows: number): void {
  const cssWidth = cols * metrics.width;
  const cssHeight = rows * metrics.height;

  // CSS size (what user sees)
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;

  // Actual canvas size (scaled for DPI)
  canvas.width = cssWidth * devicePixelRatio;
  canvas.height = cssHeight * devicePixelRatio;

  // Scale context to match
  ctx.scale(devicePixelRatio, devicePixelRatio);
}
```

### Style Rendering

Text styles are applied via the `flags` bitfield:

```typescript
// Apply font styles
let fontStyle = '';
if (cell.flags & CellFlags.ITALIC) fontStyle += 'italic ';
if (cell.flags & CellFlags.BOLD) fontStyle += 'bold ';
ctx.font = `${fontStyle}${fontSize}px ${fontFamily}`;

// Draw text
ctx.fillStyle = rgbToCSS(fg_r, fg_g, fg_b);
ctx.fillText(char, textX, textY);

// Draw underline
if (cell.flags & CellFlags.UNDERLINE) {
  ctx.strokeStyle = ctx.fillStyle;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cellX, underlineY);
  ctx.lineTo(cellX + cellWidth, underlineY);
  ctx.stroke();
}

// Draw strikethrough
if (cell.flags & CellFlags.STRIKETHROUGH) {
  // Similar to underline, at vertical center
}

// Apply faint effect
if (cell.flags & CellFlags.FAINT) {
  ctx.globalAlpha = 0.5;
}
```

### Cursor Rendering

Three styles supported:

```typescript
switch (cursorStyle) {
  case 'block':
    ctx.fillRect(x, y, width, height);
    break;
  case 'underline':
    ctx.fillRect(x, y + height - 2, width, 2);
    break;
  case 'bar':
    ctx.fillRect(x, y, 2, height);
    break;
}
```

Cursor blinks at 530ms intervals (matching xterm.js).

### Scrollbar

Overlay scrollbar with fade animation:
- 8px width, right-aligned
- Thumb height proportional to visible/total lines
- 1.5s hide delay, 200ms fade

---

## Terminal Data Structures

### GhosttyCell (16 bytes)

```typescript
interface GhosttyCell {
  codepoint: number;      // u32 - Unicode codepoint (first of grapheme)
  fg_r: number;           // u8 - Foreground red
  fg_g: number;           // u8 - Foreground green
  fg_b: number;           // u8 - Foreground blue
  bg_r: number;           // u8 - Background red
  bg_g: number;           // u8 - Background green
  bg_b: number;           // u8 - Background blue
  flags: number;          // u8 - Style bitfield
  width: number;          // u8 - Character width (1=normal, 2=wide)
  hyperlink_id: number;   // u16 - OSC 8 hyperlink ID (0=none)
  grapheme_len: number;   // u8 - Extra codepoints count
}
```

### Cell Flags

```typescript
enum CellFlags {
  BOLD          = 1 << 0,  // 0x01
  ITALIC        = 1 << 1,  // 0x02
  UNDERLINE     = 1 << 2,  // 0x04
  STRIKETHROUGH = 1 << 3,  // 0x08
  INVERSE       = 1 << 4,  // 0x10
  INVISIBLE     = 1 << 5,  // 0x20
  BLINK         = 1 << 6,  // 0x40
  FAINT         = 1 << 7,  // 0x80
}
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

IBufferLine
├── length: number
├── isWrapped: boolean      # Soft-wrapped from previous line
├── getCell(x): IBufferCell
└── translateToString(): string
```

### Cell Pool Optimization

Zero-allocation rendering via object reuse:

```typescript
// lib/ghostty.ts
private cellPool: GhosttyCell[] = [];

// Pre-allocate on terminal creation/resize
ensureCellPool(count: number): void {
  while (this.cellPool.length < count) {
    this.cellPool.push({
      codepoint: 0, fg_r: 0, fg_g: 0, fg_b: 0,
      bg_r: 0, bg_g: 0, bg_b: 0,
      flags: 0, width: 1, hyperlink_id: 0, grapheme_len: 0
    });
  }
}

// Reuse on every frame (no allocation)
parseCellsIntoPool(ptr: number, count: number): void {
  for (let i = 0; i < count; i++) {
    const cell = this.cellPool[i];
    // Update existing object fields
    cell.codepoint = view.getUint32(offset, true);
    cell.fg_r = u8[offset + 4];
    // ... etc
  }
}
```

### Viewport Management

```typescript
// lib/terminal.ts
viewportY: number = 0;           // Current scroll position (0 = bottom)
targetViewportY: number = 0;     // Target for smooth scroll
scrollAnimationStartTime?: number;
scrollAnimationStartY?: number;
```

Smooth scrolling uses asymptotic approach (moves fraction of remaining distance per frame).

---

## Flexibility and Manipulation Points

### What Can Be Changed

| Aspect | Location | Difficulty |
|--------|----------|------------|
| **Cell colors** | Renderer reads from WASM | Easy (override in render) |
| **Cell styles** | Flags in GhosttyCell | Easy (override in render) |
| **Cursor appearance** | renderer.ts | Easy |
| **Selection colors** | Theme system | Easy |
| **Link underlining** | renderer.ts | Easy |
| **Scrollbar appearance** | renderer.ts | Easy |
| **Font size/family** | Terminal options | Easy |

### Extension Points

1. **Link Providers** (`lib/link-detector.ts`)
   - Register custom link detection patterns
   - Control hover effects and click behavior

2. **Theme System** (`ITheme` interface)
   - Full color customization
   - Selection colors
   - Cursor colors

3. **Render Hooks** (would need to add)
   - Pre/post render callbacks
   - Custom overlay rendering

4. **Addons** (`loadAddon()`)
   - FitAddon exists
   - Pattern supports additional addons

### What's Hard to Change

| Aspect | Reason | Workaround |
|--------|--------|------------|
| **Cell content** | WASM owns state | Can't modify; can only overlay |
| **Grid structure** | WASM owns layout | Can't add/remove rows dynamically |
| **Escape sequence parsing** | WASM handles | Would need WASM patch |
| **Per-cell custom rendering** | No hook exists | Add render callback system |

---

## Feature Implementation Analysis

### 1. iFrame Overlays (Tooltips/Popovers)

**Difficulty: Medium**

**Approach:**
Create a DOM layer positioned above the canvas:

```typescript
// Proposed implementation
class OverlayManager {
  private container: HTMLDivElement;

  constructor(terminalElement: HTMLElement) {
    this.container = document.createElement('div');
    this.container.style.cssText = `
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      pointer-events: none;
      z-index: 10;
    `;
    terminalElement.appendChild(this.container);
  }

  showOverlay(cellX: number, cellY: number, content: HTMLElement): void {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: absolute;
      left: ${cellX * metrics.width}px;
      top: ${cellY * metrics.height}px;
      pointer-events: auto;
    `;
    overlay.appendChild(content);
    this.container.appendChild(overlay);
  }
}
```

**Considerations:**
- Overlays can contain iframes, but iframes have cross-origin restrictions
- Position updates needed on scroll/resize
- Z-index management for multiple overlays
- Click-through behavior (pointer-events: none on container)

**Implementation Steps:**
1. Add `OverlayManager` class
2. Track cell-to-pixel coordinate mapping
3. Add API: `terminal.showOverlay(row, col, element, options)`
4. Handle scroll/resize repositioning
5. Add dismiss/lifecycle management

### 2. Text Hovers/Highlights on Regex Patterns

**Difficulty: Easy**

The existing link detection system already supports this pattern!

**Current Architecture:**
```typescript
// lib/link-detector.ts
interface ILinkProvider {
  provideLinks(row: number): ILink[];
}

interface ILink {
  range: { startCol, endCol, startRow, endRow };
  text: string;
  activate(event: MouseEvent): void;
  hover?(event: MouseEvent): void;
  leave?(event: MouseEvent): void;
}
```

**To Add Custom Regex Patterns:**

```typescript
// Custom provider example
class CustomPatternProvider implements ILinkProvider {
  private patterns: Array<{ regex: RegExp, handler: Function }> = [];

  addPattern(regex: RegExp, handler: (match: string, event: MouseEvent) => void) {
    this.patterns.push({ regex, handler });
  }

  provideLinks(row: number): ILink[] {
    const lineText = terminal.buffer.active.getLine(row).translateToString();
    const links: ILink[] = [];

    for (const { regex, handler } of this.patterns) {
      let match;
      while ((match = regex.exec(lineText)) !== null) {
        links.push({
          range: { startCol: match.index, endCol: match.index + match[0].length, startRow: row, endRow: row },
          text: match[0],
          activate: (e) => handler(match[0], e),
          hover: (e) => this.showHighlight(match),
          leave: (e) => this.hideHighlight()
        });
      }
    }
    return links;
  }
}
```

**Enhancements Needed:**
1. Add background highlight option (currently only underline)
2. Add tooltip support in hover handler
3. Add keyboard navigation for matches
4. Consider caching for performance

**Implementation in Renderer:**
```typescript
// Add to renderCellBackground()
if (this.highlightedRanges.has(cellKey(x, y))) {
  ctx.fillStyle = this.theme.highlightBackground || 'rgba(255, 255, 0, 0.3)';
  ctx.fillRect(cellX, cellY, cellWidth, cellHeight);
}
```

### 3. Collapsible/Toggle-able Text Blocks

**Difficulty: Hard**

This requires fundamental changes to how the terminal displays content.

**Challenge:**
The terminal is a linear stream of characters. There's no concept of "blocks" that can expand/collapse. The WASM core controls the cell grid entirely.

**Possible Approaches:**

#### Approach A: Virtual Viewport (Most Flexible)
```
┌─────────────────────────────────────────┐
│ Terminal WASM Core (actual content)     │
│   Line 1: [output text...]              │
│   Line 2: [collapsed marker: ▶ ...]     │
│   Line 3: [hidden content line 1]       │  ← Not rendered
│   Line 4: [hidden content line 2]       │  ← Not rendered
│   Line 5: [hidden content line 3]       │  ← Not rendered
│   Line 6: [end marker]                  │
│   Line 7: [more output...]              │
└─────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────┐
│ Virtual Viewport (what user sees)       │
│   Line 1: [output text...]              │
│   Line 2: [▶ 3 lines collapsed]         │  ← Click to expand
│   Line 3: [more output...]              │
└─────────────────────────────────────────┘
```

**Implementation:**
1. **Collapse Markers:** Define escape sequence or pattern to mark collapsible regions
2. **Virtual Line Mapping:** `displayLine → actualLine` translation
3. **Modified Render Loop:** Skip hidden lines, render collapse indicators
4. **Click Handling:** Detect clicks on collapse markers, toggle state
5. **Scroll Adjustment:** Account for hidden lines in scrollbar

```typescript
interface CollapsibleRegion {
  startLine: number;
  endLine: number;
  collapsed: boolean;
  label: string;
}

class VirtualViewport {
  private regions: CollapsibleRegion[] = [];

  getDisplayLineCount(): number {
    let count = this.totalLines;
    for (const region of this.regions) {
      if (region.collapsed) {
        count -= (region.endLine - region.startLine - 1); // Keep header line
      }
    }
    return count;
  }

  mapDisplayToActual(displayLine: number): number {
    let actual = displayLine;
    for (const region of this.regions) {
      if (region.collapsed && displayLine >= region.startLine) {
        actual += (region.endLine - region.startLine - 1);
      }
    }
    return actual;
  }
}
```

#### Approach B: DOM Overlay Collapse (Simpler but Limited)
- Render collapsible content in DOM overlays
- Overlay covers terminal text when expanded
- More like a "popup" than true collapse

**This is significantly more complex** and would require:
- Modifying the render loop in `renderer.ts`
- Adding virtual viewport layer
- Custom scroll handling
- State persistence across terminal writes

### 4. Animation Support (Smooth Scroll, Collapse/Expand)

**Difficulty: Medium**

**Already Implemented: Smooth Scrolling**

```typescript
// lib/terminal.ts
private animateScroll = (): void => {
  const duration = this.options.smoothScrollDuration ?? 100;
  const distance = this.targetViewportY - this.viewportY;

  if (Math.abs(distance) < 0.01) {
    this.viewportY = this.targetViewportY;
    return; // Done
  }

  // Asymptotic approach
  const progress = Math.min(1, (Date.now() - startTime) / duration);
  const eased = 1 - Math.pow(1 - progress, 3); // Ease-out cubic
  this.viewportY = startY + (targetY - startY) * eased;

  requestAnimationFrame(this.animateScroll);
};
```

**To Add Collapse/Expand Animation:**

```typescript
interface AnimatedRegion extends CollapsibleRegion {
  animationProgress: number; // 0 = collapsed, 1 = expanded
  animating: boolean;
}

private animateRegion(region: AnimatedRegion, expanding: boolean): void {
  const duration = 200; // ms
  const startTime = Date.now();
  const startProgress = region.animationProgress;
  const endProgress = expanding ? 1 : 0;

  const animate = () => {
    const elapsed = Date.now() - startTime;
    const t = Math.min(1, elapsed / duration);
    const eased = expanding
      ? 1 - Math.pow(1 - t, 3)  // Ease-out for expand
      : Math.pow(t, 3);         // Ease-in for collapse

    region.animationProgress = startProgress + (endProgress - startProgress) * eased;

    // Render partial expansion (show N lines based on progress)
    const visibleLines = Math.round(region.animationProgress * region.totalLines);
    this.renderPartialRegion(region, visibleLines);

    if (t < 1) {
      requestAnimationFrame(animate);
    } else {
      region.animating = false;
      region.collapsed = !expanding;
    }
  };

  region.animating = true;
  requestAnimationFrame(animate);
}
```

**Scrollbar Animation:**
Already has opacity fade (1.5s delay, 200ms transition).

### 5. Font Size and Style Control (Double Width/Height)

**Difficulty: Medium-Hard**

#### Current Font Control

```typescript
// Easy - already supported
terminal.options.fontSize = 16;
terminal.options.fontFamily = 'JetBrains Mono, monospace';
terminal.options.fontWeight = 'normal';
terminal.options.fontWeightBold = 'bold';
```

#### VT100 Double-Width/Double-Height (DECDWL/DECDHL)

VT100 terminals supported per-line modes:
- **DECDWL**: Double-Width Line (each character twice as wide)
- **DECDHL Top**: Double-Height Line, top half
- **DECDHL Bottom**: Double-Height Line, bottom half

**Escape Sequences:**
```
ESC # 6  → DECDWL (double-width)
ESC # 3  → DECDHL top half
ESC # 4  → DECDHL bottom half
ESC # 5  → DECSWL (single-width, normal)
```

**Current Status in Ghostty:**
The Zig codebase has a `Wide` enum for double-width *characters* (CJK), but NOT double-width/height *lines* (DECDWL/DECDHL).

**Implementation Would Require:**

1. **WASM Changes:**
```zig
// In page.zig - Add line-level attribute
pub const LineFlags = packed struct {
  double_width: bool = false,
  double_height_top: bool = false,
  double_height_bottom: bool = false,
};
```

2. **API Extension:**
```typescript
// New WASM exports
ghostty_render_state_get_line_flags(handle, row) → LineFlags
```

3. **Renderer Changes:**
```typescript
// lib/renderer.ts - renderLine()
private renderLine(line: GhosttyCell[], y: number, flags: LineFlags): void {
  let scaleX = 1, scaleY = 1;

  if (flags.double_width) {
    scaleX = 2;
  }
  if (flags.double_height_top || flags.double_height_bottom) {
    scaleY = 2;
  }

  ctx.save();
  ctx.scale(scaleX, scaleY);

  // Adjust positioning for scaling
  const adjustedY = flags.double_height_bottom ? y - 0.5 : y;

  // Render at half resolution (will be scaled up)
  // ... existing render code with adjusted coordinates

  ctx.restore();
}
```

4. **Clipping for Double-Height:**
```typescript
// Only show top or bottom half
if (flags.double_height_top) {
  ctx.beginPath();
  ctx.rect(0, y * cellHeight, width, cellHeight);
  ctx.clip();
  // Render full double-height, but clipped to top half
}
```

**Simpler Alternative: CSS Transform**

Without WASM changes, could use CSS transforms on specific lines:

```typescript
// DOM overlay approach
const doubleWidthLine = document.createElement('div');
doubleWidthLine.style.transform = 'scaleX(2)';
doubleWidthLine.style.transformOrigin = 'left';
// Render line content to this element
```

This would require extracting specific lines to DOM elements rather than canvas.

---

## Comparison with xterm.js

### Decoration API (xterm.js)

xterm.js has a rich decoration system that ghostty-web lacks:

```typescript
// xterm.js decoration API
const marker = terminal.registerMarker(lineNumber);
const decoration = terminal.registerDecoration({
  marker,
  anchor: 'left',
  width: 10,
  height: 1,
  backgroundColor: '#ff000040',
  foregroundColor: '#ffffff',
  layer: 'top'  // or 'bottom'
});

decoration.onRender((element: HTMLElement) => {
  // Custom DOM element rendering
  element.innerHTML = '<span>Custom content</span>';
});
```

**To Add Similar Functionality to ghostty-web:**

```typescript
// Proposed API
class DecorationService {
  private decorations: Map<number, Decoration[]> = new Map();

  registerMarker(line: number): IMarker {
    return new Marker(line, this);
  }

  registerDecoration(options: IDecorationOptions): IDecoration {
    const decoration = new Decoration(options);
    const line = options.marker.line;

    if (!this.decorations.has(line)) {
      this.decorations.set(line, []);
    }
    this.decorations.get(line)!.push(decoration);

    return decoration;
  }

  getDecorationsForLine(line: number): Decoration[] {
    return this.decorations.get(line) || [];
  }
}
```

### Render Layers (xterm.js WebGL)

xterm.js WebGL addon uses a layer system:

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

**ghostty-web** renders everything in a single pass, which is simpler but less flexible.

**To Add Layer System:**

```typescript
interface IRenderLayer {
  render(ctx: CanvasRenderingContext2D, state: RenderState): void;
  handleResize(cols: number, rows: number): void;
  dispose(): void;
}

class LayeredRenderer {
  private layers: IRenderLayer[] = [];

  addLayer(layer: IRenderLayer, zIndex?: number): void {
    this.layers.splice(zIndex ?? this.layers.length, 0, layer);
  }

  render(state: RenderState): void {
    for (const layer of this.layers) {
      layer.render(this.ctx, state);
    }
  }
}

// Example custom layer
class HighlightLayer implements IRenderLayer {
  private highlights: Array<{ row: number, startCol: number, endCol: number, color: string }> = [];

  render(ctx: CanvasRenderingContext2D, state: RenderState): void {
    for (const h of this.highlights) {
      ctx.fillStyle = h.color;
      ctx.fillRect(
        h.startCol * state.metrics.width,
        h.row * state.metrics.height,
        (h.endCol - h.startCol) * state.metrics.width,
        state.metrics.height
      );
    }
  }
}
```

---

## Implementation Recommendations

### Priority Order

1. **Regex Hover/Highlight** (Easy, High Value)
   - Extend existing link provider system
   - Add background highlight option
   - Low risk, high impact

2. **iFrame/DOM Overlays** (Medium, High Value)
   - Add OverlayManager class
   - Coordinate mapping utilities
   - Enable tooltips, popovers, rich content

3. **Decoration API** (Medium, Foundation)
   - Port xterm.js decoration concepts
   - Enables many other features
   - Good investment for extensibility

4. **Smooth Animations** (Easy, Polish)
   - Scrollbar fade already exists
   - Add easing utilities
   - Prepare for collapse animations

5. **Collapsible Blocks** (Hard, High Value)
   - Requires virtual viewport
   - Significant architecture change
   - Consider phased approach

6. **Double Width/Height** (Medium-Hard, Niche)
   - Requires WASM patch
   - Limited real-world use cases
   - Consider DOM overlay alternative

### Architecture Recommendations

1. **Add Render Callback System**
   ```typescript
   terminal.onBeforeRender((ctx, state) => { /* custom pre-render */ });
   terminal.onAfterRender((ctx, state) => { /* custom post-render */ });
   ```

2. **Add Decoration Service**
   - Marker-based position tracking
   - DOM element management
   - Integration with scroll/resize

3. **Add Overlay Container**
   - Positioned DOM layer
   - Cell coordinate utilities
   - Z-index management

4. **Consider WebGL Option**
   - For advanced visual effects
   - Could be optional addon
   - Follow xterm.js pattern

### Code Organization

```
lib/
├── core/
│   ├── terminal.ts        # Main class
│   ├── ghostty.ts         # WASM wrapper
│   └── buffer.ts          # Buffer API
├── rendering/
│   ├── renderer.ts        # Canvas renderer
│   ├── layers/            # Render layers
│   │   ├── base-layer.ts
│   │   ├── text-layer.ts
│   │   └── overlay-layer.ts
│   └── decorations/
│       ├── decoration-service.ts
│       └── marker.ts
├── features/
│   ├── links/
│   │   ├── link-detector.ts
│   │   └── providers/
│   ├── selection/
│   │   └── selection-manager.ts
│   └── overlays/
│       └── overlay-manager.ts
├── input/
│   └── input-handler.ts
└── addons/
    ├── fit/
    └── search/  # Future
```

---

## Appendix: Original Ghostty Architecture Reference

The native Ghostty application (Zig) provides additional context:

### Cell Structure (Zig)
```zig
pub const Cell = packed struct(u64) {
  content_tag: ContentTag,
  content: packed union {
    codepoint: u21,
    color_palette: u8,
    color_rgb: RGB,
  },
  style_id: StyleId,
  wide: Wide,
  protected: bool,
  hyperlink: bool,
  semantic_content: SemanticContent,
};
```

### Wide Character Types
```zig
pub const Wide = enum(u2) {
  narrow = 0,      // Normal width
  wide = 1,        // Double-width (CJK)
  spacer_tail = 2, // After wide char
  spacer_head = 3, // Continuation marker
};
```

### Rendering Backends
- **Metal** (macOS): MSL shaders, triple buffering
- **OpenGL** (Linux): GLSL shaders, single buffering
- **WebGL** (Browser): GLSL shaders

### Overlay System
Native Ghostty has CPU-rendered overlays:
- `highlight_hyperlinks`: Blue overlay
- `semantic_prompts`: Gold/orange overlay
- `semantic_input`: Cyan overlay

### Kitty Graphics Protocol
Supports image placement at multiple layers:
- `kitty_below_bg`
- `kitty_below_text`
- `kitty_above_text`
- `overlay`

---

## References

- **ghostty-web source**: `/home/user/ghostty-web/lib/`
- **Original Ghostty**: `/home/user/ghostty-web/attic/ghostty/`
- **xterm.js**: `/home/user/ghostty-web/attic/xterm.js/`
- **WASM patch**: `/home/user/ghostty-web/patches/ghostty-wasm-api.patch`
