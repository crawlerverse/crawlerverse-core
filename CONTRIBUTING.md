# Contributing to @crawlerverse/core

Thanks for your interest in contributing!

## Development Setup

1. **Clone the repo:**
   ```bash
   git clone https://github.com/crawlerverse/core.git
   cd core
   ```

2. **Install dependencies:**
   ```bash
   pnpm install
   ```

3. **Run the demo:**
   ```bash
   pnpm dev  # http://localhost:3001
   ```

4. **Run tests:**
   ```bash
   pnpm test           # Run once
   pnpm test:watch     # Watch mode
   pnpm test:coverage  # Coverage report
   ```

## Code Quality

Before submitting a PR:

```bash
pnpm type-check  # TypeScript errors
pnpm lint        # ESLint
pnpm test        # All tests pass
```

## Pull Request Process

1. **Fork the repo** and create a feature branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** with tests:
   - Add tests for new features
   - Update tests for bug fixes
   - Follow existing code style

3. **Commit with clear messages:**
   ```bash
   git commit -m "feat: add new scheduler paradigm"
   git commit -m "fix: resolve combat damage calculation"
   ```

4. **Push and create PR:**
   ```bash
   git push origin feature/your-feature-name
   ```
   Then open a PR on GitHub.

5. **CI must pass** - GitHub Actions runs type-check, lint, and tests.

## Code Style

- **TypeScript** - No `any` types without good reason
- **Tests** - Vitest for unit tests, focus on behavior not implementation
- **Immutability** - Pure functions, no mutation of inputs
- **Zod schemas** - Validate all external data (AI responses, user input)

## Questions?

Open an issue or start a discussion on GitHub.
