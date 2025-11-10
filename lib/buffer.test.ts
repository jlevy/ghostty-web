/**
 * Comprehensive test suite for ScreenBuffer
 */

import { describe, test, expect } from 'bun:test';
import { ScreenBuffer } from './buffer';

// ============================================================================
// Basic Operations Tests
// ============================================================================

describe('ScreenBuffer - Basic Operations', () => {
  test('initializes with correct dimensions', () => {
    const buffer = new ScreenBuffer(80, 24);
    const dims = buffer.getDimensions();
    
    expect(dims.cols).toBe(80);
    expect(dims.rows).toBe(24);
  });

  test('initializes cursor at origin', () => {
    const buffer = new ScreenBuffer(80, 24);
    const cursor = buffer.getCursor();
    
    expect(cursor.x).toBe(0);
    expect(cursor.y).toBe(0);
    expect(cursor.visible).toBe(true);
  });

  test('writes single character at cursor position', () => {
    const buffer = new ScreenBuffer(80, 24);
    buffer.writeChar('H');
    
    const line = buffer.getLine(0);
    expect(line![0].char).toBe('H');
    expect(line![0].width).toBe(1);
  });

  test('writes multiple characters', () => {
    const buffer = new ScreenBuffer(80, 24);
    buffer.writeString('Hello');
    
    const line = buffer.getLine(0);
    expect(line![0].char).toBe('H');
    expect(line![1].char).toBe('e');
    expect(line![2].char).toBe('l');
    expect(line![3].char).toBe('l');
    expect(line![4].char).toBe('o');
  });

  test('advances cursor after writing', () => {
    const buffer = new ScreenBuffer(80, 24);
    buffer.writeChar('A');
    
    let cursor = buffer.getCursor();
    expect(cursor.x).toBe(1);
    expect(cursor.y).toBe(0);
    
    buffer.writeChar('B');
    cursor = buffer.getCursor();
    expect(cursor.x).toBe(2);
    expect(cursor.y).toBe(0);
  });

  test('applies current style to written characters', () => {
    const buffer = new ScreenBuffer(80, 24);
    buffer.setStyle({ bold: true, fg: { type: 'palette', index: 1 } });
    buffer.writeChar('X');
    
    const line = buffer.getLine(0);
    expect(line![0].bold).toBe(true);
    expect(line![0].fg).toEqual({ type: 'palette', index: 1 });
  });
});

// ============================================================================
// Wide Characters Tests
// ============================================================================

describe('ScreenBuffer - Wide Characters', () => {
  test('writes CJK character with width 2', () => {
    const buffer = new ScreenBuffer(80, 24);
    buffer.writeChar('中');
    
    const line = buffer.getLine(0);
    expect(line![0].char).toBe('中');
    expect(line![0].width).toBe(2);
    expect(line![1].width).toBe(0); // Padding cell
  });

  test('advances cursor by 2 for wide character', () => {
    const buffer = new ScreenBuffer(80, 24);
    buffer.writeChar('日');
    
    const cursor = buffer.getCursor();
    expect(cursor.x).toBe(2);
  });

  test('writes emoji with width 2', () => {
    const buffer = new ScreenBuffer(80, 24);
    buffer.writeChar('😀');
    
    const line = buffer.getLine(0);
    expect(line![0].char).toBe('😀');
    expect(line![0].width).toBe(2);
  });

  test('wide char at edge wraps to next line', () => {
    const buffer = new ScreenBuffer(5, 24);
    buffer.writeString('AAAA'); // Fill to position 4
    buffer.writeChar('中'); // Should wrap
    
    const cursor = buffer.getCursor();
    expect(cursor.x).toBe(2);
    expect(cursor.y).toBe(1);
    
    const line = buffer.getLine(1);
    expect(line![0].char).toBe('中');
  });

  test('combining character appends to previous char', () => {
    const buffer = new ScreenBuffer(80, 24);
    buffer.writeChar('e');
    buffer.writeChar('\u0301'); // Combining acute accent
    
    const line = buffer.getLine(0);
    // Should be normalized to é
    expect(line![0].char).toBe('e\u0301'.normalize('NFC'));
    expect(line![0].char.length).toBe(1); // Should be single composed char
  });
});

// ============================================================================
// Cursor Movement Tests
// ============================================================================

describe('ScreenBuffer - Cursor Movement', () => {
  test('moves cursor to absolute position', () => {
    const buffer = new ScreenBuffer(80, 24);
    buffer.moveCursorTo(10, 5);
    
    const cursor = buffer.getCursor();
    expect(cursor.x).toBe(10);
    expect(cursor.y).toBe(5);
  });

  test('clamps cursor to buffer bounds', () => {
    const buffer = new ScreenBuffer(80, 24);
    buffer.moveCursorTo(100, 50);
    
    const cursor = buffer.getCursor();
    expect(cursor.x).toBe(79); // cols - 1
    expect(cursor.y).toBe(23); // rows - 1
  });

  test('moves cursor up', () => {
    const buffer = new ScreenBuffer(80, 24);
    buffer.moveCursorTo(5, 10);
    buffer.moveCursorUp(3);
    
    const cursor = buffer.getCursor();
    expect(cursor.y).toBe(7);
  });

  test('moves cursor down', () => {
    const buffer = new ScreenBuffer(80, 24);
    buffer.moveCursorTo(5, 10);
    buffer.moveCursorDown(3);
    
    const cursor = buffer.getCursor();
    expect(cursor.y).toBe(13);
  });

  test('moves cursor forward', () => {
    const buffer = new ScreenBuffer(80, 24);
    buffer.moveCursorTo(5, 10);
    buffer.moveCursorForward(3);
    
    const cursor = buffer.getCursor();
    expect(cursor.x).toBe(8);
  });

  test('moves cursor backward', () => {
    const buffer = new ScreenBuffer(80, 24);
    buffer.moveCursorTo(5, 10);
    buffer.moveCursorBackward(3);
    
    const cursor = buffer.getCursor();
    expect(cursor.x).toBe(2);
  });

  test('saves and restores cursor position', () => {
    const buffer = new ScreenBuffer(80, 24);
    buffer.moveCursorTo(15, 8);
    buffer.saveCursor();
    
    buffer.moveCursorTo(0, 0);
    expect(buffer.getCursor().x).toBe(0);
    
    buffer.restoreCursor();
    const cursor = buffer.getCursor();
    expect(cursor.x).toBe(15);
    expect(cursor.y).toBe(8);
  });
});

// ============================================================================
// Wrapping Tests
// ============================================================================

describe('ScreenBuffer - Wrapping', () => {
  test('wraps to next line at right edge', () => {
    const buffer = new ScreenBuffer(5, 24);
    buffer.writeString('ABCDE');
    buffer.writeChar('F');
    
    const cursor = buffer.getCursor();
    expect(cursor.x).toBe(1);
    expect(cursor.y).toBe(1);
    
    const line = buffer.getLine(1);
    expect(line![0].char).toBe('F');
  });

  test('scrolls when wrapping past bottom', () => {
    const buffer = new ScreenBuffer(5, 3);
    
    // Fill all 3 lines
    for (let i = 0; i < 15; i++) {
      buffer.writeChar('A');
    }
    
    // Write one more to trigger scroll
    buffer.writeChar('X');
    
    const cursor = buffer.getCursor();
    expect(cursor.y).toBe(2); // Still on last line
    
    const scrollback = buffer.getScrollback();
    expect(scrollback.length).toBeGreaterThan(0);
  });

  test('disables wrapping when autoWrap is false', () => {
    const buffer = new ScreenBuffer(5, 24);
    buffer.setAutoWrap(false);
    buffer.writeString('ABCDEF');
    
    const cursor = buffer.getCursor();
    expect(cursor.x).toBe(4); // Stays at last column
    expect(cursor.y).toBe(0); // Doesn't wrap
    
    const line = buffer.getLine(0);
    expect(line![4].char).toBe('F'); // Overwrites last char
  });
});

// ============================================================================
// Scrolling Tests
// ============================================================================

describe('ScreenBuffer - Scrolling', () => {
  test('scrolls up moves lines up', () => {
    const buffer = new ScreenBuffer(10, 3);
    buffer.writeString('Line1');
    buffer.moveCursorTo(0, 1);
    buffer.writeString('Line2');
    buffer.moveCursorTo(0, 2);
    buffer.writeString('Line3');
    
    buffer.scrollUp(1);
    
    const line0 = buffer.getLine(0);
    const line1 = buffer.getLine(1);
    const line2 = buffer.getLine(2);
    
    expect(line0![0].char).toBe('L'); // Was line1
    expect(line1![0].char).toBe('L'); // Was line2
    expect(line2![0].char).toBe(' '); // New blank line
  });

  test('scrolling adds to scrollback', () => {
    const buffer = new ScreenBuffer(10, 3);
    buffer.writeString('TOP');
    buffer.moveCursorTo(0, 1);
    buffer.writeString('MID');
    
    buffer.scrollUp(1);
    
    const scrollback = buffer.getScrollback();
    expect(scrollback.length).toBe(1);
    expect(scrollback[0][0].char).toBe('T');
  });

  test('scrollback respects max size', () => {
    const buffer = new ScreenBuffer(10, 3, 5); // Max 5 lines
    
    // Scroll 10 times
    for (let i = 0; i < 10; i++) {
      buffer.writeString('Line' + i);
      buffer.scrollUp(1);
    }
    
    const scrollback = buffer.getScrollback();
    expect(scrollback.length).toBeLessThanOrEqual(5);
  });

  test('scrolls down moves lines down', () => {
    const buffer = new ScreenBuffer(10, 3);
    buffer.writeString('Line1');
    buffer.moveCursorTo(0, 1);
    buffer.writeString('Line2');
    
    buffer.scrollDown(1);
    
    const line0 = buffer.getLine(0);
    const line1 = buffer.getLine(1);
    
    expect(line0![0].char).toBe(' '); // New blank line
    expect(line1![0].char).toBe('L'); // Was line0
  });

  test('index scrolls when at bottom', () => {
    const buffer = new ScreenBuffer(10, 3);
    buffer.moveCursorTo(0, 2); // Move to last line
    buffer.writeString('BOTTOM');
    
    buffer.index(); // Should scroll
    
    const cursor = buffer.getCursor();
    expect(cursor.y).toBe(2); // Still at bottom
    
    const scrollback = buffer.getScrollback();
    expect(scrollback.length).toBe(1);
  });

  test('reverseIndex scrolls when at top', () => {
    const buffer = new ScreenBuffer(10, 3);
    buffer.moveCursorTo(0, 0); // At top
    
    buffer.reverseIndex(); // Should scroll down
    
    const cursor = buffer.getCursor();
    expect(cursor.y).toBe(0); // Still at top
    
    const line0 = buffer.getLine(0);
    expect(line0![0].char).toBe(' '); // New blank line added
  });
});

// ============================================================================
// Scroll Regions Tests
// ============================================================================

describe('ScreenBuffer - Scroll Regions', () => {
  test('sets scroll region', () => {
    const buffer = new ScreenBuffer(80, 24);
    buffer.setScrollRegion(5, 15);
    
    const region = buffer.getScrollRegion();
    expect(region).not.toBeNull();
    expect(region!.top).toBe(5);
    expect(region!.bottom).toBe(15);
  });

  test('scrolling respects scroll region', () => {
    const buffer = new ScreenBuffer(10, 10);
    buffer.setScrollRegion(2, 5);
    
    // Write in region
    buffer.moveCursorTo(0, 2);
    buffer.writeString('L2');
    buffer.moveCursorTo(0, 3);
    buffer.writeString('L3');
    buffer.moveCursorTo(0, 4);
    buffer.writeString('L4');
    buffer.moveCursorTo(0, 5);
    buffer.writeString('L5');
    
    buffer.scrollUp(1);
    
    // Line 2 should now have L3's content
    const line2 = buffer.getLine(2);
    expect(line2![0].char).toBe('L');
    expect(line2![1].char).toBe('3');
  });

  test('text outside scroll region unaffected', () => {
    const buffer = new ScreenBuffer(10, 10);
    
    // Write outside region
    buffer.moveCursorTo(0, 0);
    buffer.writeString('OUTSIDE');
    
    buffer.setScrollRegion(2, 5);
    buffer.scrollUp(2);
    
    // Line 0 should be unchanged
    const line0 = buffer.getLine(0);
    expect(line0![0].char).toBe('O');
  });

  test('clears scroll region', () => {
    const buffer = new ScreenBuffer(80, 24);
    buffer.setScrollRegion(5, 15);
    buffer.clearScrollRegion();
    
    const region = buffer.getScrollRegion();
    expect(region).toBeNull();
  });

  test('origin mode with scroll region', () => {
    const buffer = new ScreenBuffer(80, 24);
    buffer.setScrollRegion(5, 15);
    buffer.setOriginMode(true);
    
    // Cursor should be at top of region
    const cursor = buffer.getCursor();
    expect(cursor.y).toBe(5);
    
    // Moving to 0,0 should go to region origin
    buffer.moveCursorTo(0, 0);
    expect(buffer.getCursor().y).toBe(5);
  });
});

// ============================================================================
// Erasing Tests
// ============================================================================

describe('ScreenBuffer - Erasing', () => {
  test('eraseInLine mode 0 (cursor to end)', () => {
    const buffer = new ScreenBuffer(10, 24);
    buffer.writeString('HELLO');
    buffer.moveCursorTo(2, 0);
    buffer.eraseInLine(0);
    
    const line = buffer.getLine(0);
    expect(line![0].char).toBe('H');
    expect(line![1].char).toBe('E');
    expect(line![2].char).toBe(' ');
    expect(line![3].char).toBe(' ');
  });

  test('eraseInLine mode 1 (start to cursor)', () => {
    const buffer = new ScreenBuffer(10, 24);
    buffer.writeString('HELLO');
    buffer.moveCursorTo(2, 0);
    buffer.eraseInLine(1);
    
    const line = buffer.getLine(0);
    expect(line![0].char).toBe(' ');
    expect(line![1].char).toBe(' ');
    expect(line![2].char).toBe(' ');
    expect(line![3].char).toBe('L');
    expect(line![4].char).toBe('O');
  });

  test('eraseInLine mode 2 (entire line)', () => {
    const buffer = new ScreenBuffer(10, 24);
    buffer.writeString('HELLO');
    buffer.moveCursorTo(2, 0);
    buffer.eraseInLine(2);
    
    const line = buffer.getLine(0);
    for (let i = 0; i < 5; i++) {
      expect(line![i].char).toBe(' ');
    }
  });

  test('eraseInDisplay mode 0 (cursor to end)', () => {
    const buffer = new ScreenBuffer(5, 3);
    buffer.writeString('AAAAA');
    buffer.moveCursorTo(0, 1);
    buffer.writeString('BBBBB');
    buffer.moveCursorTo(0, 2);
    buffer.writeString('CCCCC');
    
    buffer.moveCursorTo(2, 1);
    buffer.eraseInDisplay(0);
    
    const line0 = buffer.getLine(0);
    const line1 = buffer.getLine(1);
    const line2 = buffer.getLine(2);
    
    expect(line0![0].char).toBe('A'); // Line 0 untouched
    expect(line1![0].char).toBe('B'); // Start of line 1 untouched
    expect(line1![2].char).toBe(' '); // From cursor onward erased
    expect(line2![0].char).toBe(' '); // Line 2 fully erased
  });

  test('eraseInDisplay mode 1 (start to cursor)', () => {
    const buffer = new ScreenBuffer(5, 3);
    buffer.writeString('AAAAA');
    buffer.moveCursorTo(0, 1);
    buffer.writeString('BBBBB');
    buffer.moveCursorTo(0, 2);
    buffer.writeString('CCCCC');
    
    buffer.moveCursorTo(2, 1);
    buffer.eraseInDisplay(1);
    
    const line0 = buffer.getLine(0);
    const line1 = buffer.getLine(1);
    const line2 = buffer.getLine(2);
    
    expect(line0![0].char).toBe(' '); // Line 0 erased
    expect(line1![0].char).toBe(' '); // Start erased
    expect(line1![2].char).toBe(' '); // Up to cursor erased
    expect(line1![3].char).toBe('B'); // After cursor intact
    expect(line2![0].char).toBe('C'); // Line 2 untouched
  });

  test('eraseInDisplay mode 2 (entire display)', () => {
    const buffer = new ScreenBuffer(5, 3);
    buffer.writeString('AAAAA');
    buffer.moveCursorTo(0, 1);
    buffer.writeString('BBBBB');
    
    buffer.eraseInDisplay(2);
    
    const lines = buffer.getAllLines();
    for (const line of lines) {
      for (const cell of line) {
        expect(cell.char).toBe(' ');
      }
    }
  });

  test('eraseChars erases n characters', () => {
    const buffer = new ScreenBuffer(10, 24);
    buffer.writeString('HELLO');
    buffer.moveCursorTo(1, 0);
    buffer.eraseChars(3);
    
    const line = buffer.getLine(0);
    expect(line![0].char).toBe('H');
    expect(line![1].char).toBe(' ');
    expect(line![2].char).toBe(' ');
    expect(line![3].char).toBe(' ');
    expect(line![4].char).toBe('O');
  });
});

// ============================================================================
// Line/Char Operations Tests
// ============================================================================

describe('ScreenBuffer - Line Operations', () => {
  test('insertLines adds blank lines', () => {
    const buffer = new ScreenBuffer(10, 5);
    buffer.writeString('Line0');
    buffer.moveCursorTo(0, 1);
    buffer.writeString('Line1');
    buffer.moveCursorTo(0, 2);
    buffer.writeString('Line2');
    
    buffer.moveCursorTo(0, 1);
    buffer.insertLines(1);
    
    const line1 = buffer.getLine(1);
    const line2 = buffer.getLine(2);
    
    expect(line1![0].char).toBe(' '); // New blank line
    expect(line2![0].char).toBe('L'); // Was Line1
  });

  test('deleteLines removes lines', () => {
    const buffer = new ScreenBuffer(10, 5);
    buffer.writeString('Line0');
    buffer.moveCursorTo(0, 1);
    buffer.writeString('Line1');
    buffer.moveCursorTo(0, 2);
    buffer.writeString('Line2');
    
    buffer.moveCursorTo(0, 1);
    buffer.deleteLines(1);
    
    const line1 = buffer.getLine(1);
    const line4 = buffer.getLine(4);
    
    expect(line1![0].char).toBe('L'); // Was Line2
    expect(line4![0].char).toBe(' '); // New blank line at bottom
  });

  test('insertChars shifts chars right', () => {
    const buffer = new ScreenBuffer(10, 24);
    buffer.writeString('HELLO');
    buffer.moveCursorTo(2, 0);
    buffer.insertChars(2);
    
    const line = buffer.getLine(0);
    expect(line![0].char).toBe('H');
    expect(line![1].char).toBe('E');
    expect(line![2].char).toBe(' ');
    expect(line![3].char).toBe(' ');
    expect(line![4].char).toBe('L');
  });

  test('deleteChars shifts chars left', () => {
    const buffer = new ScreenBuffer(10, 24);
    buffer.writeString('HELLO');
    buffer.moveCursorTo(1, 0);
    buffer.deleteChars(2);
    
    const line = buffer.getLine(0);
    expect(line![0].char).toBe('H');
    expect(line![1].char).toBe('L');
    expect(line![2].char).toBe('O');
    expect(line![3].char).toBe(' ');
  });
});

// ============================================================================
// Modes Tests
// ============================================================================

describe('ScreenBuffer - Modes', () => {
  test('insert mode shifts existing chars', () => {
    const buffer = new ScreenBuffer(10, 24);
    buffer.writeString('HI');
    buffer.moveCursorTo(1, 0);
    buffer.setInsertMode(true);
    buffer.writeChar('X');
    
    const line = buffer.getLine(0);
    expect(line![0].char).toBe('H');
    expect(line![1].char).toBe('X');
    expect(line![2].char).toBe('I');
  });

  test('replace mode overwrites chars', () => {
    const buffer = new ScreenBuffer(10, 24);
    buffer.writeString('HI');
    buffer.moveCursorTo(1, 0);
    buffer.setInsertMode(false);
    buffer.writeChar('X');
    
    const line = buffer.getLine(0);
    expect(line![0].char).toBe('H');
    expect(line![1].char).toBe('X');
    expect(line![2].char).toBe(' '); // I was overwritten
  });

  test('origin mode affects cursor positioning', () => {
    const buffer = new ScreenBuffer(80, 24);
    buffer.setScrollRegion(5, 15);
    buffer.setOriginMode(true);
    
    buffer.moveCursorTo(10, 0);
    const cursor = buffer.getCursor();
    
    // Y should be relative to scroll region top
    expect(cursor.y).toBe(5);
  });

  test('cursor movement respects scroll region in origin mode', () => {
    const buffer = new ScreenBuffer(80, 24);
    buffer.setScrollRegion(5, 15);
    buffer.setOriginMode(true);
    
    buffer.moveCursorDown(100); // Try to go way down
    const cursor = buffer.getCursor();
    
    // Should be clamped to scroll region bottom
    expect(cursor.y).toBe(15);
  });
});

// ============================================================================
// Resizing Tests
// ============================================================================

describe('ScreenBuffer - Resizing', () => {
  test('resize increases width', () => {
    const buffer = new ScreenBuffer(10, 5);
    buffer.resize(15, 5);
    
    const dims = buffer.getDimensions();
    expect(dims.cols).toBe(15);
    
    const line = buffer.getLine(0);
    expect(line!.length).toBe(15);
  });

  test('resize decreases width', () => {
    const buffer = new ScreenBuffer(10, 5);
    buffer.writeString('1234567890');
    buffer.resize(5, 5);
    
    const dims = buffer.getDimensions();
    expect(dims.cols).toBe(5);
    
    const line = buffer.getLine(0);
    expect(line!.length).toBe(5);
  });

  test('resize increases height', () => {
    const buffer = new ScreenBuffer(10, 5);
    buffer.resize(10, 10);
    
    const dims = buffer.getDimensions();
    expect(dims.rows).toBe(10);
  });

  test('resize decreases height moves lines to scrollback', () => {
    const buffer = new ScreenBuffer(10, 5);
    buffer.writeString('Line0');
    buffer.moveCursorTo(0, 1);
    buffer.writeString('Line1');
    
    buffer.resize(10, 1);
    
    const dims = buffer.getDimensions();
    expect(dims.rows).toBe(1);
    
    const scrollback = buffer.getScrollback();
    expect(scrollback.length).toBeGreaterThan(0);
  });

  test('resize clamps cursor to new bounds', () => {
    const buffer = new ScreenBuffer(80, 24);
    buffer.moveCursorTo(50, 20);
    buffer.resize(40, 10);
    
    const cursor = buffer.getCursor();
    expect(cursor.x).toBeLessThanOrEqual(39);
    expect(cursor.y).toBeLessThanOrEqual(9);
  });
});

// ============================================================================
// Edge Cases Tests
// ============================================================================

describe('ScreenBuffer - Edge Cases', () => {
  test('handles operations with n=0', () => {
    const buffer = new ScreenBuffer(10, 5);
    buffer.writeString('TEST');
    
    buffer.scrollUp(0);
    buffer.scrollDown(0);
    buffer.moveCursorUp(0);
    buffer.insertLines(0);
    
    // Should not crash or change state
    const line = buffer.getLine(0);
    expect(line![0].char).toBe('T');
  });

  test('handles cursor at last column without wrap', () => {
    const buffer = new ScreenBuffer(5, 5);
    buffer.setAutoWrap(false);
    buffer.writeString('12345');
    buffer.writeChar('X');
    
    const cursor = buffer.getCursor();
    expect(cursor.x).toBe(4);
    expect(cursor.y).toBe(0);
    
    const line = buffer.getLine(0);
    expect(line![4].char).toBe('X');
  });

  test('handles writing on last row with scroll', () => {
    const buffer = new ScreenBuffer(5, 3);
    
    // Fill first 2 rows completely
    for (let i = 0; i < 10; i++) {
      buffer.writeChar('A');
    }
    
    // Now on row 2 (last row). Fill it and write one more to trigger scroll
    for (let i = 0; i < 6; i++) {
      buffer.writeChar('B');
    }
    
    const cursor = buffer.getCursor();
    expect(cursor.y).toBe(2); // Should stay on last row
    
    const scrollback = buffer.getScrollback();
    expect(scrollback.length).toBeGreaterThan(0);
  });

  test('handles empty string write', () => {
    const buffer = new ScreenBuffer(10, 5);
    buffer.writeChar('');
    
    const line = buffer.getLine(0);
    expect(line![0].char).toBe(' '); // Should write space
  });

  test('dirty tracking marks changed lines', () => {
    const buffer = new ScreenBuffer(10, 5);
    buffer.writeChar('X');
    
    expect(buffer.isDirty(0)).toBe(true);
    expect(buffer.isDirty(1)).toBe(false);
    
    buffer.clearDirty();
    expect(buffer.isDirty(0)).toBe(false);
  });

  test('getLine returns undefined for invalid row', () => {
    const buffer = new ScreenBuffer(10, 5);
    
    expect(buffer.getLine(-1)).toBeUndefined();
    expect(buffer.getLine(100)).toBeUndefined();
  });
});

// ============================================================================
// xterm.js Compatibility Tests
// ============================================================================

describe('ScreenBuffer - xterm.js Compatibility', () => {
  test('provides baseY property', () => {
    const buffer = new ScreenBuffer(10, 3);
    
    // Initially no scrollback
    expect(buffer.baseY).toBe(0);
    
    // Scroll some lines
    buffer.writeString('A'.repeat(50)); // Force scrolling
    expect(buffer.baseY).toBeGreaterThan(0);
  });

  test('provides cursorX and cursorY properties', () => {
    const buffer = new ScreenBuffer(80, 24);
    buffer.moveCursorTo(10, 5);
    
    expect(buffer.cursorX).toBe(10);
    expect(buffer.cursorY).toBe(5);
  });

  test('provides length property', () => {
    const buffer = new ScreenBuffer(10, 3);
    
    // Initially just the rows
    expect(buffer.length).toBe(3);
    
    // After scrolling
    buffer.writeString('A'.repeat(50));
    expect(buffer.length).toBeGreaterThan(3);
  });

  test('provides viewportY property', () => {
    const buffer = new ScreenBuffer(10, 3);
    expect(buffer.viewportY).toBe(0); // Always 0 for Phase 1
  });

  test('getLine returns copy not reference', () => {
    const buffer = new ScreenBuffer(10, 5);
    buffer.writeString('TEST');
    
    const line1 = buffer.getLine(0);
    const line2 = buffer.getLine(0);
    
    // Should be different objects
    expect(line1).not.toBe(line2);
    
    // But same content
    expect(line1![0].char).toBe(line2![0].char);
  });
});
