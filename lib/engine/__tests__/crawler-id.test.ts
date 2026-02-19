import { describe, it, expect } from 'vitest';
import {
  isCrawlerId,
  toCrawlerId,
  crawlerIdFromIndex,
  getCrawlerIndex,
  maybeCrawlerId,
  type CrawlerId,
} from '../crawler-id';

describe('CrawlerId', () => {
  describe('isCrawlerId', () => {
    it('returns true for valid crawler IDs', () => {
      expect(isCrawlerId('crawler-1')).toBe(true);
      expect(isCrawlerId('crawler-2')).toBe(true);
      expect(isCrawlerId('crawler-10')).toBe(true);
      expect(isCrawlerId('crawler-999')).toBe(true);
    });

    it('returns false for invalid patterns', () => {
      expect(isCrawlerId('')).toBe(false);
      expect(isCrawlerId('crawler')).toBe(false);
      expect(isCrawlerId('crawler-')).toBe(false);
      expect(isCrawlerId('crawler-abc')).toBe(false);
      expect(isCrawlerId('player-1')).toBe(false);
      expect(isCrawlerId('monster-1')).toBe(false);
      expect(isCrawlerId('rat-1')).toBe(false);
    });

    it('returns false for crawler-0 (IDs are 1-based)', () => {
      // crawler-0 is invalid because crawler IDs must be 1-based
      expect(isCrawlerId('crawler-0')).toBe(false);
    });

    it('returns false for IDs with leading zeros', () => {
      // crawler-01 is invalid because it starts with 0
      expect(isCrawlerId('crawler-01')).toBe(false);
      expect(isCrawlerId('crawler-001')).toBe(false);
    });

    it('narrows the type correctly', () => {
      const id = 'crawler-1';
      if (isCrawlerId(id)) {
        // TypeScript should now treat id as CrawlerId
        const _typed: CrawlerId = id;
        expect(_typed).toBe('crawler-1');
      }
    });
  });

  describe('toCrawlerId', () => {
    it('returns valid CrawlerId for valid input', () => {
      const id = toCrawlerId('crawler-1');
      expect(id).toBe('crawler-1');
    });

    it('throws for invalid input', () => {
      expect(() => toCrawlerId('invalid')).toThrow('Invalid crawler ID');
      expect(() => toCrawlerId('')).toThrow('Invalid crawler ID');
      expect(() => toCrawlerId('crawler-')).toThrow('Invalid crawler ID');
    });
  });

  describe('crawlerIdFromIndex', () => {
    it('creates valid CrawlerId from 1-based index', () => {
      expect(crawlerIdFromIndex(1)).toBe('crawler-1');
      expect(crawlerIdFromIndex(2)).toBe('crawler-2');
      expect(crawlerIdFromIndex(10)).toBe('crawler-10');
    });

    it('throws for index less than 1', () => {
      expect(() => crawlerIdFromIndex(0)).toThrow('Invalid crawler index');
      expect(() => crawlerIdFromIndex(-1)).toThrow('Invalid crawler index');
    });

    it('throws for non-integer index', () => {
      expect(() => crawlerIdFromIndex(1.5)).toThrow('Invalid crawler index');
      expect(() => crawlerIdFromIndex(NaN)).toThrow('Invalid crawler index');
    });
  });

  describe('getCrawlerIndex', () => {
    it('extracts index from valid CrawlerId', () => {
      expect(getCrawlerIndex(toCrawlerId('crawler-1'))).toBe(1);
      expect(getCrawlerIndex(toCrawlerId('crawler-5'))).toBe(5);
      expect(getCrawlerIndex(toCrawlerId('crawler-100'))).toBe(100);
    });

    it('throws for crawler-0 (invalid ID)', () => {
      expect(() => toCrawlerId('crawler-0')).toThrow('Invalid crawler ID');
    });
  });

  describe('maybeCrawlerId', () => {
    it('returns CrawlerId for valid input', () => {
      expect(maybeCrawlerId('crawler-1')).toBe('crawler-1');
      expect(maybeCrawlerId('crawler-2')).toBe('crawler-2');
    });

    it('returns undefined for invalid input', () => {
      expect(maybeCrawlerId('invalid')).toBeUndefined();
      expect(maybeCrawlerId('')).toBeUndefined();
      expect(maybeCrawlerId('player-1')).toBeUndefined();
    });
  });
});
