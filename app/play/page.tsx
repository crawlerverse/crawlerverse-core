'use client';

/**
 * Play Page - Demo game for crawler-core package
 *
 * Client component that generates a stable seed on mount
 * for deterministic character generation.
 */

import { useState } from 'react';
import { PlayGame } from '@/components/game/PlayGame';

export default function PlayPage() {
  const [seed] = useState(() => Date.now());
  return <PlayGame title="Crawler Demo" seed={seed} />;
}
