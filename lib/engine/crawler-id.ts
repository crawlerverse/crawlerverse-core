/**
 * Crawler ID Type
 *
 * Branded type for crawler entity IDs to provide compile-time type safety.
 * Crawler IDs must match the pattern "crawler-N" where N is a positive integer.
 */

// Brand symbol for nominal typing
declare const CrawlerIdBrand: unique symbol;

/**
 * Branded type for crawler IDs.
 * Provides compile-time safety for crawler ID strings.
 */
export type CrawlerId = string & { readonly [CrawlerIdBrand]: typeof CrawlerIdBrand };

/** Regex pattern for valid crawler IDs (1-based, e.g., crawler-1, crawler-2) */
const CRAWLER_ID_PATTERN = /^crawler-([1-9]\d*)$/;

/**
 * Type guard to check if a string is a valid CrawlerId.
 * Returns a type predicate for TypeScript type narrowing.
 *
 * @param id - String to check
 * @returns True if id matches crawler-N pattern
 *
 * @example
 * ```ts
 * const id = 'crawler-1';
 * if (isCrawlerId(id)) {
 *   // id is now CrawlerId type
 *   const color = getCrawlerColor(id);
 * }
 * ```
 */
export function isCrawlerId(id: string): id is CrawlerId {
  return CRAWLER_ID_PATTERN.test(id);
}

/**
 * Convert a string to CrawlerId, throwing if invalid.
 *
 * @param id - String to convert
 * @returns The id as CrawlerId type
 * @throws Error if id doesn't match crawler-N pattern
 *
 * @example
 * ```ts
 * const id = toCrawlerId('crawler-1'); // CrawlerId
 * const invalid = toCrawlerId('foo'); // throws Error
 * ```
 */
export function toCrawlerId(id: string): CrawlerId {
  if (!isCrawlerId(id)) {
    throw new Error(`Invalid crawler ID: "${id}". Expected format: crawler-N (e.g., crawler-1)`);
  }
  return id;
}

/**
 * Create a CrawlerId from a 1-based index.
 *
 * @param index - 1-based crawler index
 * @returns CrawlerId for that index
 * @throws Error if index is less than 1 or not an integer
 *
 * @example
 * ```ts
 * const id = crawlerIdFromIndex(1); // 'crawler-1' as CrawlerId
 * const id2 = crawlerIdFromIndex(2); // 'crawler-2' as CrawlerId
 * ```
 */
export function crawlerIdFromIndex(index: number): CrawlerId {
  if (!Number.isInteger(index) || index < 1) {
    throw new Error(`Invalid crawler index: ${index}. Must be a positive integer.`);
  }
  return `crawler-${index}` as CrawlerId;
}

/**
 * Extract the numeric index from a CrawlerId.
 *
 * @param crawlerId - Valid crawler ID
 * @returns 1-based index extracted from the ID
 *
 * @example
 * ```ts
 * const index = getCrawlerIndex(toCrawlerId('crawler-3')); // 3
 * ```
 */
export function getCrawlerIndex(crawlerId: CrawlerId): number {
  const match = crawlerId.match(CRAWLER_ID_PATTERN);
  if (!match) {
    // This should never happen with a valid CrawlerId, but handle gracefully
    throw new Error(`Invalid crawler ID: "${crawlerId}"`);
  }
  return parseInt(match[1], 10);
}

/**
 * Safely try to convert a string to CrawlerId.
 * Returns undefined instead of throwing if invalid.
 *
 * @param id - String to convert
 * @returns CrawlerId if valid, undefined otherwise
 */
export function maybeCrawlerId(id: string): CrawlerId | undefined {
  return isCrawlerId(id) ? id : undefined;
}
