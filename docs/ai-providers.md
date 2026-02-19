# AI Provider Configuration

## Quick Start

Run the setup wizard:

```bash
pnpm setup:ai
```

This will guide you through configuring AI inference. Options:
- **Local LLM** — Free, private (requires LMStudio/Ollama)
- **Cloud free tier** — Free, no GPU needed (requires OpenRouter account)
- **Bring your own key** — Use existing OpenAI/Anthropic credentials

The wizard writes your config to `.env.local` and tests the connection.

---

Crawler supports multiple AI backends through the provider abstraction layer. This allows you to:

- Use local LLMs during development (faster, free, offline)
- Use Vercel AI Gateway in production (Claude, cost tracking)
- Switch providers without code changes

## Quick Start: Local Development with LMStudio

1. **Install LMStudio** from [lmstudio.ai](https://lmstudio.ai)

2. **Download a model** (recommended: Devstral Mini or similar reasoning model)

3. **Start the local server** in LMStudio (default: `http://localhost:1234`)

4. **Configure environment** in `.env.local`:

```bash
AI_PROVIDER=openai-compatible
OPENAI_COMPATIBLE_BASE_URL=http://localhost:1234/v1
OPENAI_COMPATIBLE_MODEL=devstral-mini
```

5. **Run the game**: `pnpm --filter @crawler/core dev`

## Provider Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AI_PROVIDER` | No | `gateway` (default), `openrouter`, or `openai-compatible` |
| `AI_MODEL` | No | Override model for any provider |
| `AI_GATEWAY_API_KEY` | For gateway | Vercel AI Gateway API key |
| `OPENROUTER_API_KEY` | For openrouter | OpenRouter API key |
| `OPENROUTER_MODEL` | No | Model name (default: `mistralai/devstral-2512:free`) |
| `OPENAI_COMPATIBLE_BASE_URL` | For openai-compatible | Local server URL |
| `OPENAI_COMPATIBLE_API_KEY` | No | API key (most local servers don't need one) |
| `OPENAI_COMPATIBLE_MODEL` | No | Model name (default: `local-model`) |

### Provider: Vercel AI Gateway (Production)

```bash
AI_PROVIDER=gateway
AI_GATEWAY_API_KEY=v-xxx
AI_MODEL=anthropic/claude-3-haiku  # optional, this is the default
```

Supported models via gateway:
- `anthropic/claude-3-haiku` (default - fast, cheap)
- `anthropic/claude-3-sonnet` (better reasoning)
- `anthropic/claude-3-opus` (best quality)

### Provider: OpenAI-Compatible (Local)

```bash
AI_PROVIDER=openai-compatible
OPENAI_COMPATIBLE_BASE_URL=http://localhost:1234/v1
OPENAI_COMPATIBLE_MODEL=your-model-name
```

Compatible servers:
- **LMStudio** - GUI app, easiest setup
- **Ollama** - CLI-based, `ollama serve`
- **vLLM** - High-performance, production-ready
- **LocalAI** - Drop-in OpenAI replacement

### Provider: OpenRouter (Cloud)

[OpenRouter](https://openrouter.ai) provides access to many models through a unified API, including free tiers.

**Option 1: Dedicated provider** (uses official `@openrouter/ai-sdk-provider`):
```bash
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-v1-xxx
OPENROUTER_MODEL=mistralai/devstral-2512:free
```

**Option 2: OpenAI-compatible** (works the same for most models):
```bash
AI_PROVIDER=openai-compatible
OPENAI_COMPATIBLE_BASE_URL=https://openrouter.ai/api/v1
OPENAI_COMPATIBLE_API_KEY=sk-or-v1-xxx
OPENAI_COMPATIBLE_MODEL=mistralai/devstral-2512:free
```

**Free tier rate limits:**
- Without credits: 50 requests/day
- With $10+ credits: 1,000 requests/day, 20 requests/minute

Free models are identified by the `:free` suffix. **Important:** Not all models work well with structured JSON output.

| Model | Status | Notes |
|-------|--------|-------|
| `mistralai/devstral-2512:free` | ✅ Works | 262k context, clean JSON (recommended) |
| `mistralai/mistral-small-3.1-24b-instruct:free` | ✅ Works | 128k context, good structured output |
| `meta-llama/llama-3.3-70b-instruct:free` | ✅ Works | 131k context, reliable |
| `google/gemini-2.0-flash-exp:free` | ❌ Broken | Wraps JSON in markdown code blocks |

Browse all free models: [openrouter.ai/models?q=free](https://openrouter.ai/models?q=free)

### Network Access (LMStudio on another machine)

If running LMStudio on a different machine (e.g., Mac Mini):

```bash
OPENAI_COMPATIBLE_BASE_URL=http://mac-mini.local:1234/v1
```

Ensure the LMStudio server is configured to accept external connections.

## Recommended Models for Local Development

| Model | Size | Notes |
|-------|------|-------|
| Devstral Mini | ~4GB | Good reasoning, fast |
| Qwen 2.5 Coder 7B | ~4GB | Good for code tasks |
| Llama 3.2 3B | ~2GB | Very fast, less capable |
| Mistral 7B Instruct | ~4GB | General purpose |

## Troubleshooting

### "Connection refused" error

- Check the local server is running
- Verify the URL includes `/v1` suffix
- Ensure firewall allows the connection

### AI returns invalid actions

Local models may not follow structured output as reliably as Claude. If you see validation errors:

1. Try a larger/better model
2. Check if the model supports JSON mode
3. Review the system prompt in `lib/ai/schemas.ts`

### Slow responses

Local model performance depends on your hardware:
- GPU recommended for 7B+ models
- CPU-only works but is slower
- Reduce context length if needed

## Programmatic Usage

```typescript
import { getAIModel, getProviderConfig, isLocalProvider } from '@crawler/core/ai';

// Get configured model for generateObject/generateText
const model = getAIModel();

// Check current provider
const config = getProviderConfig();
console.log(`Using ${config.provider} with model ${config.model}`);

// Adjust behavior for local models
if (isLocalProvider()) {
  // Maybe use longer timeouts, more retries, etc.
}
```

## Authentication

### Web App (apps/web)

The web app uses session-based authentication:

1. Client calls `POST /api/game/start` to create a session
2. Server returns a `sessionToken` (valid for 2 hours)
3. Client includes token in `X-Session-Token` header on `/api/ai` requests
4. If session expires (401), client automatically refreshes

No manual configuration needed - sessions are managed automatically via Redis.

### OSS Demo (crawler-core)

The OSS demo app requires no authentication - it's designed for local development where you control the server and pay for your own AI provider. Just configure your AI provider and run.
