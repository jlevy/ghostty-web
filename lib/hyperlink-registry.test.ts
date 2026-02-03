/**
 * Tests for HyperlinkRegistry
 */

import { describe, expect, it } from 'bun:test';
import { HyperlinkRegistry, parseOsc8Sequences } from './hyperlink-registry';

describe('HyperlinkRegistry', () => {
  it('should register and retrieve hyperlinks by ID', () => {
    const registry = new HyperlinkRegistry();
    const id = registry.register('https://example.com');
    expect(registry.getUri(id)).toBe('https://example.com');
  });

  it('should return null for unknown IDs', () => {
    const registry = new HyperlinkRegistry();
    expect(registry.getUri(999)).toBe(null);
  });

  it('should reuse IDs for duplicate explicit IDs', () => {
    const registry = new HyperlinkRegistry();
    const id1 = registry.register('https://example.com', 'my-id');
    const id2 = registry.register('https://example.com', 'my-id');
    expect(id1).toBe(id2);
  });

  it('should reuse IDs for duplicate URIs without explicit ID', () => {
    const registry = new HyperlinkRegistry();
    const id1 = registry.register('https://example.com');
    const id2 = registry.register('https://example.com');
    expect(id1).toBe(id2);
  });

  it('should assign different IDs for different URIs', () => {
    const registry = new HyperlinkRegistry();
    const id1 = registry.register('https://example1.com');
    const id2 = registry.register('https://example2.com');
    expect(id1).not.toBe(id2);
  });

  it('should clear all entries', () => {
    const registry = new HyperlinkRegistry();
    const id = registry.register('https://example.com');
    registry.clear();
    expect(registry.getUri(id)).toBe(null);
    expect(registry.size).toBe(0);
  });

  it('should evict oldest entries when at capacity', () => {
    const registry = new HyperlinkRegistry(3); // Small capacity for testing
    const id1 = registry.register('https://one.com');
    const id2 = registry.register('https://two.com');
    const id3 = registry.register('https://three.com');

    // Access id2 and id3 to update lastSeen
    registry.getUri(id2);
    registry.getUri(id3);

    // Add a fourth entry, should evict id1 (oldest)
    registry.register('https://four.com');

    expect(registry.getUri(id1)).toBe(null);
    expect(registry.getUri(id2)).toBe('https://two.com');
    expect(registry.getUri(id3)).toBe('https://three.com');
  });
});

describe('parseOsc8Sequences', () => {
  it('should parse OSC 8 sequence with BEL terminator', () => {
    const registry = new HyperlinkRegistry();
    const data = '\x1b]8;;https://example.com\x07link text\x1b]8;;\x07';
    const results = parseOsc8Sequences(data, registry);

    expect(results.size).toBe(1);
    expect(registry.size).toBe(1);

    const entry = results.values().next().value;
    expect(entry?.uri).toBe('https://example.com');
  });

  it('should parse OSC 8 sequence with ESC \\ terminator', () => {
    const registry = new HyperlinkRegistry();
    const data = '\x1b]8;;https://example.com\x1b\\link text\x1b]8;;\x1b\\';
    const results = parseOsc8Sequences(data, registry);

    expect(results.size).toBe(1);
    expect(registry.size).toBe(1);
  });

  it('should parse explicit id parameter', () => {
    const registry = new HyperlinkRegistry();
    const data = '\x1b]8;id=my-link;https://example.com\x07link\x1b]8;;\x07';
    const results = parseOsc8Sequences(data, registry);

    const entry = results.values().next().value;
    expect(entry?.id).toBe('my-link');
    expect(entry?.uri).toBe('https://example.com');
  });

  it('should skip empty URIs (link end markers)', () => {
    const registry = new HyperlinkRegistry();
    const data = '\x1b]8;;\x07';  // Just an end marker
    const results = parseOsc8Sequences(data, registry);

    expect(results.size).toBe(0);
    expect(registry.size).toBe(0);
  });

  it('should parse multiple links', () => {
    const registry = new HyperlinkRegistry();
    const data = '\x1b]8;;https://one.com\x07one\x1b]8;;\x07 \x1b]8;;https://two.com\x07two\x1b]8;;\x07';
    const results = parseOsc8Sequences(data, registry);

    expect(results.size).toBe(2);
    expect(registry.size).toBe(2);
  });

  it('should handle kui:// protocol', () => {
    const registry = new HyperlinkRegistry();
    const data = '\x1b]8;;kui://?href=https://test.com&hover=tooltip\x07text\x1b]8;;\x07';
    const results = parseOsc8Sequences(data, registry);

    const entry = results.values().next().value;
    expect(entry?.uri).toBe('kui://?href=https://test.com&hover=tooltip');
  });
});
