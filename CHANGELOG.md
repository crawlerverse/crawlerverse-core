# @crawlerverse/core

## 0.1.2

### Patch Changes

- Fix browser bundling errors by replacing pino logger with console in client components. Browser-side React components (PlayGame, GameCanvas, InventoryPanel) now use native console methods instead of pino logger, eliminating "unable to determine transport target for pino-pretty" errors when consuming the package.

## 0.1.1

### Patch Changes

- c598c7e: Move @types/canvas-confetti to dependencies so TypeScript consumers can compile without errors
