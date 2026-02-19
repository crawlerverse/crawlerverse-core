/**
 * API Error Utilities
 *
 * Shared error handling helpers for API route handlers.
 */

/**
 * Check if an error is likely retryable (network issues, rate limits, etc.)
 *
 * Used by API handlers to determine whether to return 503 (retryable)
 * or 500 (permanent error).
 *
 * @example
 * if (isRetryableError(error)) {
 *   return NextResponse.json({ error: '...', retryable: true }, { status: 503 });
 * }
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('rate limit') ||
      message.includes('503') ||
      message.includes('429') ||
      message.includes('econnrefused') ||
      message.includes('enotfound')
    );
  }
  return false;
}
