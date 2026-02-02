# Research: Hyper Fork xterm.js Customizations and Lessons Learned

**Date:** 2026-02-02 (last updated 2026-02-02)

**Author:** Claude (AI Research Assistant)

**Status:** Complete

## Overview

This document analyzes the xterm.js customizations implemented in the Hyper fork (jlevy/kerm repository, branch `claude/modernize-terminal-app-plan-OEkLV`). The fork implements the Kerm Codes protocol for rich terminal UI, requiring extensive modifications to xterm.js's link handling, underline rendering, and OSC processing systems.

The analysis focuses on:
1. What customizations were necessary and why
2. The technical challenges encountered with xterm.js
3. Workarounds, hacks, and patches applied
4. Lessons learned for implementing similar features in other terminal emulators

**Key Finding:** Implementing rich terminal features in xterm.js requires significant monkey-patching and private API access due to inflexible default behaviors. The architectural choices in xterm.js make certain customizations (particularly link styling and custom OSC handling) difficult without internal hacks.

## Questions to Answer

1. What specific xterm.js features needed customization for Kerm functionality?
2. What bugs and limitations in xterm.js required workarounds?
3. How were the Kerm Codes protocol features implemented within xterm.js constraints?
4. What lessons apply to implementing similar features in Ghostty/ghostty-web?

## Scope

**Included:**
- All xterm.js customizations in `lib/features/enrich-term/`
- Bug fixes and workarounds
- Private API usage patterns
- Kerm Codes protocol implementation
- UI component integration

**Excluded:**
- Electron/Hyper-specific code outside terminal
- Build system and configuration

## Findings

### Part 1: xterm.js Underline Style Hotfix

**Location:** `lib/features/enrich-term/xterm-tools/xterm-underline-hotfix.ts` (96 lines)

**The Problem:**
xterm.js hard-codes dashed underline style for ALL OSC 8 hyperlinks, regardless of any styling specified by the application. This is baked into the `ExtendedAttrs` class:

```typescript
// xterm.js internal behavior (problematic)
get underlineStyle(): UnderlineStyle {
  if (this._urlId) {
    return UnderlineStyle.DASHED;  // Always returns dashed for links!
  }
  return ((this._ext & 0x1c000000) >> 26) as UnderlineStyle;
}
```

**Why This Matters:**
- Rich terminal UIs need control over underline styling
- Some links should have no underline
- Some links should have solid/curly underlines for different semantics
- The forced dashed style breaks custom visual designs

**The Solution - Monkey Patching:**

```typescript
export function hotfixUnderlineStyle(xterm: Terminal): () => void {
  const core = xterm._core as CoreTerminalExt;
  const bufferService = core._bufferService;
  const extendedAttrsProto = Object.getPrototypeOf(
    bufferService.buffer.lines.get(0)?.getBg(0)
  );

  // Save original implementations
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    extendedAttrsProto, 'underlineStyle'
  );

  // Replace getter to ignore _urlId check
  Object.defineProperty(extendedAttrsProto, 'underlineStyle', {
    get: function(this: ExtendedAttrs) {
      // Extract from _ext bitmask, ignoring _urlId
      return ((this._ext & 0x1c000000) >> 26) as UnderlineStyle;
    },
    set: function(this: ExtendedAttrs, value: UnderlineStyle) {
      this._ext = (this._ext & ~0x1c000000) | ((value << 26) & 0x1c000000);
    }
  });

  // Return restore function
  return () => {
    if (originalDescriptor) {
      Object.defineProperty(extendedAttrsProto, 'underlineStyle', originalDescriptor);
    }
  };
}
```

**Key Technical Details:**
- Accesses private `_bufferService` to find `ExtendedAttrs` prototype
- Underline style stored in bits 26-31 of `_ext` field (mask `0x1c000000`)
- Must patch at prototype level to affect all instances
- Provides restore function for clean addon disposal

**Lesson Learned:** xterm.js's tight coupling between OSC 8 links and visual styling creates unnecessary constraints. A better design would separate link detection from link rendering.

---

### Part 2: Custom OSC Link Service

**Location:** `lib/features/enrich-term/xterm-tools/CustomOscLinkService.ts` (137 lines)

**The Problem:**
xterm.js's default `OscLinkService` provides no hooks for:
- Custom link data storage
- Access to link metadata (for KRI parsing)
- Multi-line link tracking

**The Solution - Service Replacement:**

```typescript
export class CustomOscLinkService implements IOscLinkService {
  private _nextId = 1;
  private _entriesWithId = new Map<string, Entry>();  // "id;;uri" → Entry
  private _dataByLinkId = new Map<number, OscLinkData>(); // numeric ID → data

  registerLink(data: OscLinkData): number {
    const entryKey = this._getEntryKey(data);
    const existingEntry = this._entriesWithId.get(entryKey);

    if (existingEntry) {
      return existingEntry.id;  // Reuse existing link ID
    }

    // Create new link entry
    const id = this._nextId++;
    const entry: Entry = {
      id,
      lines: new Set([data.line])
    };

    // Track with markers for position updates
    const marker = data.terminal.registerMarker(data.line);
    marker.onDispose(() => this._removeEntry(entryKey, id));

    this._entriesWithId.set(entryKey, entry);
    this._dataByLinkId.set(id, data);

    return id;
  }

  getLinkData(linkId: number): OscLinkData | undefined {
    return this._dataByLinkId.get(linkId);
  }
}
```

**Integration Hack:**
The service must be replaced in TWO locations within xterm.js internals:

```typescript
// In CustomLinksAddon.activate()
const core = xterm._core as CoreTerminalExt;
core._oscLinkService = customOscLinkService;
core._inputHandler._oscLinkService = customOscLinkService;  // Also here!
```

**Why Both?** The `_inputHandler` caches a reference to the OSC link service. If only `_core` is updated, the input handler continues using the old service.

**Lesson Learned:** xterm.js internal services have multiple reference points. Service replacement requires understanding the full dependency graph.

---

### Part 3: Custom OSC Link Provider

**Location:** `lib/features/enrich-term/xterm-tools/CustomOscLinkProvider.ts` (150 lines)

**The Problem:**
The default `OscLinkProvider` in xterm.js:
- Always applies underline decoration
- Opens links directly on click
- No hover customization
- Limited URL protocol support

**The Solution:**

```typescript
export class CustomOscLinkProvider implements ILinkProvider {
  constructor(
    private _terminal: Terminal,
    private _oscLinkService: IOscLinkService,
    private _clickHandler: (e: MouseEvent, uri: string, range: IBufferRange) => void,
    private _hoverHandler: (e: MouseEvent, uri: string, range: IBufferRange) => void,
    private _leaveHandler: () => void
  ) {}

  provideLinks(lineNumber: number, callback: (links: ILink[] | undefined) => void): void {
    const line = this._terminal.buffer.active.getLine(lineNumber - 1);
    if (!line) { callback(undefined); return; }

    const links: ILink[] = [];
    let currentLink: {startCol: number; linkId: number} | null = null;

    for (let x = 0; x < line.length; x++) {
      const cell = line.getCell(x);
      const urlId = cell?.extended?.urlId;

      if (urlId && this._isAllowedUrl(urlId)) {
        if (!currentLink || currentLink.linkId !== urlId) {
          // Start new link range
          if (currentLink) this._finishLink(currentLink, links, x, lineNumber);
          currentLink = { startCol: x, linkId: urlId };
        }
      } else if (currentLink) {
        this._finishLink(currentLink, links, x, lineNumber);
        currentLink = null;
      }
    }

    callback(links);
  }

  private _isAllowedUrl(urlId: number): boolean {
    const data = this._oscLinkService.getLinkData(urlId);
    if (!data?.uri) return false;

    // Only allow http, https, and custom kui protocol
    return /^(https?|kui):/.test(data.uri);
  }

  private _createLink(range: IBufferRange, uri: string): ILink {
    return {
      range,
      text: uri,
      decorations: {
        underline: false,      // No automatic underline
        pointerCursor: true    // Show pointer cursor
      },
      activate: (e, text) => this._clickHandler(e, text, range),
      hover: (e, text) => this._hoverHandler(e, text, range),
      leave: () => this._leaveHandler()
    };
  }
}
```

**Protocol Filtering:**
The provider explicitly filters URLs to only allow:
- `http://` and `https://` - Standard web URLs
- `kui://` - Kerm's custom protocol for rich attributes

This prevents accidental activation of `file://`, `javascript:`, or other potentially dangerous protocols.

**Lesson Learned:** Link providers need fine-grained control over decorations and URL validation. The xterm.js API is adequate here, but default implementations are too opinionated.

---

### Part 4: Custom Web Link Provider (Pattern-Based)

**Location:** `lib/features/enrich-term/xterm-tools/CustomWebLinkProvider.ts` (233 lines)

**The Problem:**
Pattern-based link detection across wrapped lines requires:
- Handling multi-byte UTF-8 characters
- Wide character (CJK, emoji) position mapping
- Line wrap boundary detection
- Buffer position ↔ string index conversion

**Complex Algorithm - Wrapped Line Expansion:**

```typescript
private _getWindowedLineStrings(
  lineNumber: number,
  term: Terminal
): {str: string; columns: number[]} {
  let str = '';
  let columns: number[] = [];

  // Expand upward through wrapped lines
  let y = lineNumber - 1;
  while (y >= 0) {
    const line = term.buffer.active.getLine(y);
    if (!line?.isWrapped) break;  // Stop at non-wrapped line

    const lineStr = line.translateToString(true);
    if (/^\s*$/.test(lineStr)) break;  // Stop at whitespace-only line

    str = lineStr + str;
    y--;
  }

  // Add current line
  const currentLine = term.buffer.active.getLine(lineNumber);
  str += currentLine?.translateToString(true) || '';

  // Expand downward through wrapped lines
  y = lineNumber + 1;
  while (y < term.buffer.active.length) {
    const line = term.buffer.active.getLine(y);
    if (!line?.isWrapped) break;

    const lineStr = line.translateToString(true);
    if (/^\s*$/.test(lineStr)) break;

    str += lineStr;
    y++;
  }

  return {str, columns: this._buildColumnMap(str)};
}
```

**Critical Bug Fix - Wide Character Mapping:**

```typescript
private _mapStrIdx(
  terminal: Terminal,
  lineNumber: number,
  stringIndex: number
): {x: number; y: number} {
  const buffer = terminal.buffer.active;
  let strIdx = 0;

  for (let x = 0; x < terminal.cols; x++) {
    const cell = buffer.getLine(lineNumber)?.getCell(x);
    const cellWidth = cell?.getWidth() || 1;
    const charLength = cell?.getChars().length || 1;

    // Wide char at end of line with wrap - special case!
    if (cellWidth === 2 && x === terminal.cols - 1) {
      const nextLine = buffer.getLine(lineNumber + 1);
      if (nextLine?.isWrapped) {
        // Wide char pushed to next line, position is actually (0, y+1)
        return {x: 0, y: lineNumber + 1};
      }
    }

    strIdx += charLength;
    if (strIdx > stringIndex) {
      return {x, y: lineNumber};
    }
  }

  return {x: terminal.cols - 1, y: lineNumber};
}
```

**Why This Is Tricky:**
1. `translateToString()` returns UTF-16 string, but buffer stores UTF-32 codepoints
2. Wide characters occupy 2 cells but 1-2 string positions
3. When a wide char would extend past line end, terminal wraps entire char to next line
4. The "spacer" cell left at line end has `getChars() === ''` but `getWidth() === 1`

**Lesson Learned:** Character width handling in terminals is deeply complex. Any pattern-based link detection must account for:
- Unicode normalization
- Grapheme clusters (emoji with modifiers)
- Wide vs. narrow characters
- Soft-wrapped line boundaries

---

### Part 5: Kerm Codes Protocol Handler

**Location:** `lib/features/enrich-term/custom-term/KermCodeHandler.ts` + `lib/features/enrich-term/utils/kerm-codes.ts` (446 lines)

**OSC 77 Registration:**

```typescript
export function setupKermCodeHandler(
  terminal: Terminal,
  onKermElement: (element: UIElement) => void
): IDisposable {
  const core = terminal._core as CoreTerminalExt;

  // Register custom OSC handler via private API
  const dispose = core._inputHandler.registerOscHandler(
    KERM_OSC,  // 77
    (data: string) => {
      try {
        const element = parseUIElement(data);
        onKermElement(element);
        return true;  // Handled
      } catch (e) {
        console.warn('Invalid Kerm code:', e);
        return false;  // Not handled
      }
    }
  );

  return { dispose };
}
```

**Private API Access:**
The `registerOscHandler` method is not part of xterm.js's public API. It requires:

```typescript
interface CoreTerminalExt {
  _inputHandler: {
    _oscLinkService: IOscLinkService;
    registerOscHandler(id: number, callback: (data: string) => boolean): IDisposable;
  };
}
```

**KRI Parsing Implementation:**

```typescript
export function parseKri(uriStr: string): Kri {
  if (uriStr.startsWith('kui://')) {
    const url = new URL(uriStr);
    const attrs: TextAttrs = {};

    // Parse query parameters as JSON
    for (const [key, value] of url.searchParams) {
      switch (key) {
        case 'href':
          attrs.href = value;
          break;
        case 'hover':
          attrs.hover = JSON.parse(value) as TooltipElement;
          break;
        case 'click':
          attrs.click = JSON.parse(value) as UIAction;
          break;
        case 'double_click':
          attrs.double_click = JSON.parse(value) as UIAction;
          break;
        case 'display_style':
          attrs.display_style = value as DisplayStyle;
          break;
      }
    }

    return { attrs };
  }

  // Plain URL - wrap as simple KRI
  return { attrs: { href: uriStr } };
}
```

**Lesson Learned:** xterm.js's OSC handler system is actually well-designed for extension, but the API is private. A public `registerOscHandler` method would enable clean protocol extensions without monkey-patching.

---

### Part 6: Click and Hover Handling

**Location:** `lib/features/enrich-term/custom-term/CustomLinkHandler.ts` (346 lines)

**The Problem:**
xterm.js fires both `activate` (click) and standard DOM events. Distinguishing single-click from double-click requires timing logic.

**Solution - ClickTimer:**

```typescript
// lib/features/enrich-term/utils/ClickTimer.ts
export class ClickTimer {
  private _lastClick = 0;
  private _timeout: number | null = null;
  private _DOUBLE_CLICK_MS = 300;

  onClick(singleClickFn: () => void, doubleClickFn: () => void): void {
    const now = Date.now();

    if (now - this._lastClick < this._DOUBLE_CLICK_MS) {
      // Double click detected
      if (this._timeout) clearTimeout(this._timeout);
      doubleClickFn();
    } else {
      // Potential single click - wait to see if double
      this._timeout = setTimeout(() => {
        singleClickFn();
      }, this._DOUBLE_CLICK_MS);
    }

    this._lastClick = now;
  }
}
```

**Link Action Routing:**

```typescript
// In CustomLinkHandler
handleLinkClick(e: MouseEvent, uri: string, range: IBufferRange): void {
  const kri = parseKri(uri);

  this._clickTimer.onClick(
    // Single click
    () => {
      if (kri.attrs.click) {
        this._executeAction(kri.attrs.click, uri, range);
      } else if (kri.attrs.href) {
        this._openUrl(kri.attrs.href);
      }
    },
    // Double click
    () => {
      if (kri.attrs.double_click) {
        this._executeAction(kri.attrs.double_click, uri, range);
      } else {
        // Default: paste the link text
        this._pasteText(this._getLinkText(range));
      }
    }
  );
}
```

**Hover Decoration:**

```typescript
handleLinkHover(e: MouseEvent, uri: string, range: IBufferRange): void {
  const kri = parseKri(uri);

  // Show visual highlight
  this._hoverDecoration.show(range, {
    backgroundColor: 'rgba(100, 100, 100, 0.3)'
  });

  // Show tooltip if defined
  if (kri.attrs.hover) {
    this._showTooltip(kri.attrs.hover, e.clientX, e.clientY);
  } else if (kri.attrs.href) {
    // Default: show URL preview tooltip
    this._showUrlTooltip(kri.attrs.href, e.clientX, e.clientY);
  }
}
```

**Lesson Learned:** Terminal link handling requires careful event coordination. The single/double click distinction is critical for power users who want to both activate links AND paste link text.

---

### Part 7: HoverDecoration System

**Location:** `lib/features/enrich-term/xterm-tools/HoverDecoration.ts` (61 lines)

**The Problem:**
xterm.js decorations are marker-based and require specific lifecycle management.

**Implementation:**

```typescript
export class HoverDecoration {
  private _decoration: IDecoration | null = null;
  private _terminal: Terminal;

  show(range: IBufferRange, options: {backgroundColor?: string}): void {
    // Dispose previous decoration
    this.hide();

    // Create marker at start of range
    const marker = this._terminal.registerMarker(
      range.start.y - this._terminal.buffer.active.baseY - 1
    );

    if (!marker) return;

    // Create decoration
    this._decoration = this._terminal.registerDecoration({
      marker,
      x: range.start.x,
      width: range.end.x - range.start.x + 1,
      backgroundColor: options.backgroundColor
    });

    // Force re-render
    this._terminal.refresh(range.start.y - 1, range.end.y - 1);
  }

  hide(): void {
    if (this._decoration) {
      this._decoration.dispose();
      this._decoration = null;
    }
  }
}
```

**Coordinate Conversion Gotcha:**
- `IBufferRange` uses 1-based line numbers
- `registerMarker` wants 0-based offset from viewport top
- Must subtract `buffer.active.baseY` to convert absolute → relative position

**Lesson Learned:** xterm.js coordinate systems are inconsistent between APIs. Always verify whether an API expects:
- 0-based or 1-based indices
- Absolute buffer position or viewport-relative
- Cell column or pixel position

---

### Part 8: Private API Surface Summary

**Critical Private APIs Used:**

| API Path | Purpose | Risk Level |
|----------|---------|------------|
| `_core._oscLinkService` | Replace link service | High - core internal |
| `_core._inputHandler._oscLinkService` | Sync link service | High - double internal |
| `_core._inputHandler.registerOscHandler` | Custom OSC handlers | Medium - useful API |
| `_core._bufferService` | Access buffer internals | High - core internal |
| `_core._renderService.dimensions` | Get cell metrics | Low - read only |
| `_core._linkProviderService.linkProviders` | Remove default provider | High - array mutation |
| `ExtendedAttrs` prototype | Patch underline logic | Very High - core type |

**Fragility Assessment:**
- xterm.js updates frequently change internal structure
- v4 → v5 broke several of these access patterns
- `ExtendedAttrs._ext` bit layout could change without notice

---

### Part 9: UI Components Integration

**Location:** `lib/features/enrich-term/components/`

**Component Hierarchy:**

```
OverlayUI.tsx (positioned container)
├── Tooltip.tsx (dispatches to specific type)
│   ├── PlainTooltip.tsx (text)
│   ├── LinkInfoTooltip.tsx (URL preview)
│   ├── ImageTooltip.tsx (image preview)
│   └── IframeTooltip.tsx (embedded iframe)
└── IframeViewer.tsx (popover container)
    └── IframePopover.tsx (full iframe display)
```

**Positioning Strategy:**

```tsx
// OverlayUI.tsx
function OverlayUI({ terminal, tooltip, popover }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Position tooltip near cursor
  const tooltipStyle = useMemo(() => {
    if (!tooltip) return {};

    return {
      position: 'absolute',
      left: tooltip.x,
      top: tooltip.y,
      zIndex: 1000,
      maxWidth: '400px'
    };
  }, [tooltip]);

  return (
    <div ref={containerRef} style={{position: 'relative'}}>
      {tooltip && (
        <div style={tooltipStyle}>
          <Tooltip {...tooltip} />
        </div>
      )}
      {popover && (
        <IframeViewer {...popover} onClose={handleClose} />
      )}
    </div>
  );
}
```

**Lesson Learned:** Terminal overlay UIs must handle:
- Z-index stacking with terminal layers
- Viewport clipping and scroll sync
- Keyboard focus management (ESC to close)
- Click-outside dismissal

---

## Options Considered

### Option A: Minimal Patches (Current Approach)

**Description:** Targeted monkey-patches and service replacement for specific features.

**Pros:**
- Smallest code footprint
- Works with stock xterm.js npm package
- Clear separation of customizations

**Cons:**
- Fragile to xterm.js updates
- Requires private API knowledge
- Multiple patch points to maintain

### Option B: Fork xterm.js

**Description:** Maintain a full fork with modifications baked in.

**Pros:**
- Direct control over internals
- No monkey-patching needed
- Can expose new public APIs

**Cons:**
- High maintenance burden
- Must merge upstream changes
- npm package management complexity

### Option C: Contribute Upstream

**Description:** Propose API additions to xterm.js project.

**Pros:**
- No local patches needed
- Benefits entire community
- Maintained by xterm.js team

**Cons:**
- Slow process (PR review, release cycles)
- May be rejected as too specialized
- Feature freeze periods

## Recommendations

### For ghostty-web:

1. **Learn from xterm.js limitations** - Design public APIs for:
   - Custom OSC handler registration
   - Underline style control independent of link status
   - Link service replacement/extension
   - Hover decoration management

2. **Use Kerm Codes protocol** - The protocol design is solid and proven. Implement OSC 8 KRI parsing and OSC 77 handling as first-class features.

3. **Separate concerns** - Keep link detection, link rendering, and link action handling in distinct layers.

### For native Ghostty:

1. **Expose extension points** - Add configuration/API for:
   - Custom link hover handlers
   - Custom OSC handlers
   - Underline style overrides

2. **Consider protocol compatibility** - Supporting the same `kui://` protocol would enable cross-platform shell tools.

### General Lessons:

| Challenge | xterm.js Issue | Recommended Ghostty Approach |
|-----------|---------------|------------------------------|
| Forced link styling | Hard-coded dashed underline | Make link decoration configurable |
| OSC extension | No public handler API | Provide `registerOscHandler()` |
| Service replacement | Private internals | Use dependency injection |
| Wide char handling | Complex edge cases | Document coordinate APIs clearly |
| Click/double-click | No timing logic | Provide both events |

## Next Steps

- [ ] Cross-reference xterm.js issues with ghostty-web implementation
- [ ] Evaluate which customizations should be built into ghostty-web vs. addon
- [ ] Design public API for OSC handler registration in ghostty-web
- [ ] Consider `kui://` protocol support in ghostty-web renderer

## References

### Hyper Fork Source Files

| File | Purpose | Lines |
|------|---------|-------|
| `xterm-underline-hotfix.ts` | Monkey-patch underline | 96 |
| `CustomOscLinkService.ts` | Link tracking | 137 |
| `CustomOscLinkProvider.ts` | OSC 8 detection | 150 |
| `CustomWebLinkProvider.ts` | Pattern matching | 233 |
| `HoverDecoration.ts` | Visual feedback | 61 |
| `CustomLinksAddon.ts` | Main addon | 94 |
| `CustomLinkHandler.ts` | Click/hover logic | 346 |
| `KermCodeHandler.ts` | OSC 77 handler | ~100 |
| `kerm-codes.ts` | Protocol schema | 446 |

### External References

- [Hyper Fork Repository](https://github.com/jlevy/kerm) (private)
- [xterm.js](https://github.com/xtermjs/xterm.js)
- [xterm.js Addon API](https://xtermjs.org/docs/api/addons/)
- [Kerm Codes Protocol](https://github.com/jlevy/kash/blob/main/src/kash/shell/output/kerm_codes.py)
