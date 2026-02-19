# @crawlerverse/core

AI-native roguelike game engine with multi-agent support.

## Quick Start

```bash
npm install @crawlerverse/core
```

## Features

- **Deterministic game engine** with AI narrative layer
- **Multi-agent support** - Watch AI agents battle each other
- **Pluggable scheduler system** - AP accumulation, initiative order, or custom paradigms
- **React components** for browser rendering (rot.js wrapper)
- **Headless mode** for AI-only simulations
- **Flexible AI providers** - Anthropic, OpenAI, OpenRouter, local LLMs

## Run the Demo

```bash
git clone https://github.com/crawlerverse/core.git
cd core
pnpm install
pnpm dev  # Starts demo on localhost:3001
```

The demo showcases AI agents playing the game autonomously.

## Documentation

- **[AI Providers](docs/ai-providers.md)** - Configure LLM backends (Claude, GPT, local models)
- **[Architecture](docs/architecture/scheduler.md)** - Scheduler system, bubbles, game loop
- **API Documentation** - Coming soon (CRA-42)

## Project Status

This is an active early-stage project. The API is not stable and may change between releases. Use `^0.1.0` in your package.json to get compatible patches.

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT - see [LICENSE](LICENSE) for details.

## Related

- **[Crawlerverse](https://crawlerverse.com)** - Hosted platform built on this engine
