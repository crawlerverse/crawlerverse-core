'use client';

/**
 * Observe Page - Observer mode demo for crawler-core package
 *
 * Client component that generates a stable seed on mount
 * for deterministic dungeon generation. Renders two AI crawlers
 * exploring the dungeon with auto-following camera.
 */

import { useState } from 'react';
import { ObserverMode } from '@/components/game/ObserverMode';

export default function ObservePage() {
  // Generate seed client-side to avoid hydration mismatch
  const [seed] = useState(() => Math.floor(Math.random() * 1000000));

  return (
    <ObserverMode
      title="Observer Mode"
      seed={seed}
      crawlerCount={2}
      aiDelayMs={500}
    />
  );
}
