/**
 * HyperlinkRegistry - Tracks OSC 8 hyperlink URIs
 *
 * ghostty-web's WASM layer parses OSC 8 sequences and assigns hyperlink_id to cells,
 * but doesn't expose the actual URI strings. This registry intercepts OSC 8 sequences
 * from the write stream to track the URI for each hyperlink ID.
 *
 * OSC 8 format: ESC ] 8 ; params ; uri ST
 * - params: semicolon-separated key=value pairs (e.g., id=foo)
 * - uri: the hyperlink URL
 * - ST: string terminator (ESC \ or BEL)
 *
 * The 'id' parameter, if present, is used as the key. If no id is provided,
 * ghostty generates an implicit ID based on the URI hash.
 */

export interface HyperlinkEntry {
  uri: string;
  /** Explicit id from OSC 8 params, or undefined for implicit IDs */
  explicitId?: string;
  /** When this entry was last seen (for LRU eviction) */
  lastSeen: number;
}

export class HyperlinkRegistry {
  /** Map from ghostty's numeric hyperlink_id to entry */
  private byNumericId = new Map<number, HyperlinkEntry>();

  /** Map from explicit OSC 8 id param to entry (for deduplication) */
  private byExplicitId = new Map<string, HyperlinkEntry>();

  /** Map from URI to entry (for implicit IDs) */
  private byUri = new Map<string, HyperlinkEntry>();

  /** Maximum entries before LRU eviction */
  private maxEntries: number;

  /** Counter for generating internal IDs when parsing */
  private nextInternalId = 1;

  constructor(maxEntries = 10000) {
    this.maxEntries = maxEntries;
  }

  /**
   * Register a hyperlink from OSC 8 parameters
   * @param uri The hyperlink URI
   * @param explicitId Optional explicit id from OSC 8 params
   * @returns A numeric ID that can be used to look up this hyperlink
   */
  register(uri: string, explicitId?: string): number {
    const now = Date.now();

    // Check if we already have this hyperlink
    if (explicitId) {
      const existing = this.byExplicitId.get(explicitId);
      if (existing) {
        existing.lastSeen = now;
        return this.getNumericIdForEntry(existing);
      }
    } else {
      const existing = this.byUri.get(uri);
      if (existing) {
        existing.lastSeen = now;
        return this.getNumericIdForEntry(existing);
      }
    }

    // Create new entry
    const entry: HyperlinkEntry = {
      uri,
      explicitId,
      lastSeen: now,
    };

    // Evict old entries if needed
    if (this.byNumericId.size >= this.maxEntries) {
      this.evictOldest();
    }

    // Assign numeric ID
    const numericId = this.nextInternalId++;
    this.byNumericId.set(numericId, entry);

    // Index by explicit ID or URI
    if (explicitId) {
      this.byExplicitId.set(explicitId, entry);
    } else {
      this.byUri.set(uri, entry);
    }

    return numericId;
  }

  /**
   * Get URI for a numeric hyperlink ID
   * @param id The numeric hyperlink_id from a cell
   * @returns The URI string or null if not found
   */
  getUri(id: number): string | null {
    const entry = this.byNumericId.get(id);
    if (entry) {
      entry.lastSeen = Date.now();
      return entry.uri;
    }
    return null;
  }

  /**
   * Clear all entries (call on terminal reset)
   */
  clear(): void {
    this.byNumericId.clear();
    this.byExplicitId.clear();
    this.byUri.clear();
    this.nextInternalId = 1;
  }

  /**
   * Get the number of registered hyperlinks
   */
  get size(): number {
    return this.byNumericId.size;
  }

  private getNumericIdForEntry(entry: HyperlinkEntry): number {
    for (const [id, e] of this.byNumericId) {
      if (e === entry) return id;
    }
    // Entry exists but not in numeric map - shouldn't happen but handle gracefully
    return this.register(entry.uri, entry.explicitId);
  }

  private evictOldest(): void {
    // Find the oldest entry
    let oldestId: number | null = null;
    let oldestTime = Infinity;

    for (const [id, entry] of this.byNumericId) {
      if (entry.lastSeen < oldestTime) {
        oldestTime = entry.lastSeen;
        oldestId = id;
      }
    }

    if (oldestId !== null) {
      const entry = this.byNumericId.get(oldestId)!;
      this.byNumericId.delete(oldestId);
      if (entry.explicitId) {
        this.byExplicitId.delete(entry.explicitId);
      } else {
        this.byUri.delete(entry.uri);
      }
    }
  }
}

/**
 * Parse OSC 8 sequences from terminal data
 *
 * @param data The terminal data to parse
 * @param registry The registry to store hyperlinks in
 * @returns Map from byte offset to hyperlink numeric ID (for matching with WASM IDs)
 */
export function parseOsc8Sequences(
  data: string | Uint8Array,
  registry: HyperlinkRegistry
): Map<number, { uri: string; id?: string }> {
  const results = new Map<number, { uri: string; id?: string }>();
  const str = typeof data === 'string' ? data : new TextDecoder().decode(data);

  // OSC 8 regex: ESC ] 8 ; params ; uri (ESC \ | BEL)
  // params can be empty or contain id=value pairs
  // \x1b]8;   - OSC 8 start
  // ([^;]*);  - params (capture group 1)
  // ([^\x07\x1b]*) - uri (capture group 2)
  // (?:\x07|\x1b\\) - string terminator (BEL or ESC \)
  const osc8Regex = /\x1b]8;([^;]*);([^\x07\x1b]*)(?:\x07|\x1b\\)/g;

  let match: RegExpExecArray | null;
  while ((match = osc8Regex.exec(str)) !== null) {
    const params = match[1];
    const uri = match[2];

    if (!uri) {
      // Empty URI ends the hyperlink - skip
      continue;
    }

    // Parse params for id=value
    let explicitId: string | undefined;
    if (params) {
      const idMatch = params.match(/(?:^|:)id=([^:]*)/);
      if (idMatch) {
        explicitId = idMatch[1];
      }
    }

    // Store in results with byte offset
    results.set(match.index, { uri, id: explicitId });

    // Register in registry
    registry.register(uri, explicitId);
  }

  return results;
}
