/**
 * AI Integration
 *
 * Interfaces and utilities for AI agent integration.
 * Supports multiple AI backends via configurable providers.
 */

export * from './schemas';
export * from './providers';
export * from './decision-context';
export * from './trace-utils';
export { NarrativeDM, type PersonalityType, type NarrationEntry } from './narrative-dm';
