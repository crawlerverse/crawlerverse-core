/**
 * AI Handler Factory
 *
 * Creates a Next.js API route handler for AI game actions.
 * Includes security measures and proper error handling.
 */

import { generateObject } from "ai";
import { getAIModel, getProviderConfig } from "../ai/providers";
import { z } from "zod";
import { ActionSchema } from "../engine/state";
import { AGENT_SYSTEM_PROMPT, AIResponseSchema } from "../ai/schemas";
import { logger } from "../logging";

// Maximum allowed length for game state prompt (prevents abuse)
const MAX_PROMPT_LENGTH = 10000;

/** Error types for structured error handling */
export type AIHandlerErrorType =
  | "VALIDATION_ERROR"
  | "AUTH_ERROR"
  | "CONFIG_ERROR"
  | "AI_ERROR"
  | "INTERNAL_ERROR";

export interface AIHandlerError {
  type: AIHandlerErrorType;
  message: string;
  details?: unknown;
}

/** Metadata about the AI response for debugging and display */
export interface AIResponseMetadata {
  /** Time taken for AI response in milliseconds */
  durationMs: number;
  /** Number of output tokens (if available from provider) */
  outputTokens?: number;
  /** Model identifier used for the request */
  modelId: string;
}

/** Successful response from the AI handler */
export interface AIHandlerResponse {
  action: z.infer<typeof ActionSchema>;
  reasoning: string;
  shortThought: string;
  /** @deprecated Use aiMetadata.modelId instead */
  modelId: string;
  aiMetadata: AIResponseMetadata;
}

/**
 * Constant-time string comparison to prevent timing attacks.
 * Returns true if strings are equal, false otherwise.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") {
    return false;
  }

  // Use length comparison that doesn't short-circuit
  const lenA = a.length;
  const lenB = b.length;
  const maxLen = Math.max(lenA, lenB);

  // Pad shorter string to prevent length-based timing attacks
  const paddedA = a.padEnd(maxLen, "\0");
  const paddedB = b.padEnd(maxLen, "\0");

  let result = 0;
  for (let i = 0; i < maxLen; i++) {
    result |= paddedA.charCodeAt(i) ^ paddedB.charCodeAt(i);
  }

  // Also check lengths match (constant time)
  result |= lenA ^ lenB;

  return result === 0;
}

export interface CreateAIHandlerOptions {
  /**
   * Model ID to use. Interpretation depends on AI_PROVIDER:
   * - gateway: 'anthropic/claude-3-haiku', 'anthropic/claude-3-sonnet', etc.
   * - openai-compatible: model name served by local server
   * If not specified, uses AI_MODEL env var or provider default.
   */
  model?: string;
  /**
   * Skip access code validation. Use when auth is handled upstream
   * (e.g., session token validation in web app). Default: false.
   */
  skipAccessCodeValidation?: boolean;
}

/**
 * Creates a Next.js API route handler for AI game actions.
 *
 * @example
 * // In app/api/ai/route.ts
 * import { createAIHandler } from '@crawler/core';
 * export const POST = createAIHandler();
 */
export function createAIHandler(options: CreateAIHandlerOptions = {}) {
  const { model, skipAccessCodeValidation = false } = options;

  return async function POST(request: Request): Promise<Response> {
    const isProduction = process.env.NODE_ENV === "production";

    // Parse request body with explicit error handling
    let requestBody: unknown;
    try {
      requestBody = await request.json();
    } catch {
      return createErrorResponse(
        { type: "VALIDATION_ERROR", message: "Invalid JSON in request body" },
        400
      );
    }

    // Validate request body shape
    if (typeof requestBody !== "object" || requestBody === null) {
      return createErrorResponse(
        { type: "VALIDATION_ERROR", message: "Request body must be an object" },
        400
      );
    }

    const { gameStatePrompt, accessCode, crawlerId } = requestBody as Record<
      string,
      unknown
    >;

    // Validate access code (skip if auth handled upstream, e.g., session tokens)
    if (!skipAccessCodeValidation) {
      const validCode = process.env.AI_ACCESS_CODE;
      if (!validCode) {
        return createErrorResponse(
          { type: "CONFIG_ERROR", message: "AI access not configured" },
          503
        );
      }

      if (
        typeof accessCode !== "string" ||
        !timingSafeEqual(accessCode, validCode)
      ) {
        return createErrorResponse(
          { type: "AUTH_ERROR", message: "Invalid access code" },
          401
        );
      }
    }

    // Validate game state prompt
    if (typeof gameStatePrompt !== "string") {
      return createErrorResponse(
        {
          type: "VALIDATION_ERROR",
          message: "Missing or invalid gameStatePrompt",
        },
        400
      );
    }

    if (gameStatePrompt.length > MAX_PROMPT_LENGTH) {
      return createErrorResponse(
        {
          type: "VALIDATION_ERROR",
          message: `gameStatePrompt exceeds maximum length of ${MAX_PROMPT_LENGTH} characters`,
        },
        400
      );
    }

    if (gameStatePrompt.length === 0) {
      return createErrorResponse(
        {
          type: "VALIDATION_ERROR",
          message: "gameStatePrompt cannot be empty",
        },
        400
      );
    }

    // Call AI service
    try {
      const config = getProviderConfig();
      const modelId = model || config.model;

      const startTime = performance.now();
      const { object: aiResponse, usage } = await generateObject({
        model: getAIModel(model, config),
        schema: AIResponseSchema,
        system: AGENT_SYSTEM_PROMPT,
        prompt: gameStatePrompt,
      });
      const durationMs = Math.round(performance.now() - startTime);

      // Validate required fields before ActionSchema.parse for clearer errors
      if ((aiResponse.action === "move" || aiResponse.action === "attack") && !aiResponse.direction) {
        throw new Error(`AI returned ${aiResponse.action} action without required direction field`);
      }
      if (aiResponse.action === "equip" && !aiResponse.itemType) {
        throw new Error("AI returned equip action without required itemType field");
      }

      // Validate action against the proper ActionSchema
      const action = ActionSchema.parse(aiResponse);
      const reasoning = aiResponse.reasoning;
      const shortThought = aiResponse.shortThought;

      // Log AI decision for debugging
      logger.info(
        {
          crawlerId: crawlerId ?? "unknown",
          action: action.action,
          direction: "direction" in action ? action.direction : undefined,
          itemType: "itemType" in action ? action.itemType : undefined,
          reasoning,
          shortThought,
        },
        "AI action generated"
      );

      // Log full prompt at debug level (truncated to avoid log bloat)
      logger.debug(
        {
          crawlerId: crawlerId ?? "unknown",
          promptLength: gameStatePrompt.length,
          promptPreview: gameStatePrompt.slice(0, 500),
        },
        "AI prompt sent"
      );

      // Build aiMetadata with timing and usage info
      const aiMetadata: AIResponseMetadata = {
        durationMs,
        ...(usage?.outputTokens && { outputTokens: usage.outputTokens }),
        modelId,
      };

      // Return action, reasoning, and short thought for UI display
      const response: AIHandlerResponse = { action, reasoning, shortThought, modelId, aiMetadata };
      return Response.json(response);
    } catch (error) {
      // Handle Zod validation errors (schema mismatch between AI response and ActionSchema)
      if (error instanceof z.ZodError) {
        logger.error(
          {
            issues: error.issues,
            // Don't log full response in production
            ...(isProduction ? {} : { response: error }),
          },
          "AI response validation failed"
        );

        return createErrorResponse(
          {
            type: "AI_ERROR",
            message: "AI returned an invalid response format",
            details: isProduction ? undefined : error.issues,
          },
          500
        );
      }

      // Handle other errors
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      if (error instanceof Error) {
        logger.error(
          { err: error, component: "aiHandler" },
          "AI handler error"
        );
      } else {
        logger.error({ message: errorMessage }, "AI handler error");
      }

      // Check for common error types
      if (
        errorMessage.includes("API key") ||
        errorMessage.includes("gateway")
      ) {
        return createErrorResponse(
          {
            type: "CONFIG_ERROR",
            message: isProduction
              ? "AI service configuration error"
              : "AI_GATEWAY_API_KEY not configured. Add it to .env.local",
          },
          500
        );
      }

      if (errorMessage.includes("rate limit") || errorMessage.includes("429")) {
        return createErrorResponse(
          {
            type: "AI_ERROR",
            message: "AI service is temporarily overloaded. Please try again.",
          },
          503
        );
      }

      // Generic error - sanitize in production
      return createErrorResponse(
        {
          type: "INTERNAL_ERROR",
          message: isProduction
            ? "AI request failed"
            : `AI request failed: ${errorMessage}`,
        },
        500
      );
    }
  };
}

function createErrorResponse(error: AIHandlerError, status: number): Response {
  return Response.json(
    { error: error.message, type: error.type, details: error.details },
    { status }
  );
}
