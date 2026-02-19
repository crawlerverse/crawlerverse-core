'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

export interface CameraFocus {
  x: number;
  y: number;
}

interface CrawlerLike {
  id: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
}

interface MonsterLike {
  id: string;
  x: number;
  y: number;
}

export interface UseAutoCameraOptions {
  crawlers: readonly CrawlerLike[];
  monsters: readonly MonsterLike[];
  isInCombat: boolean;
  speedMultiplier: number;
}

export interface UseAutoCameraResult {
  focus: CameraFocus;
  targetFocus: CameraFocus;
}

const LERP_DURATION_MS = 300;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function computeTargetFocus(
  crawlers: readonly CrawlerLike[],
  monsters: readonly MonsterLike[],
  isInCombat: boolean
): CameraFocus {
  const livingCrawlers = crawlers.filter((c) => c.hp > 0);

  if (livingCrawlers.length === 0) {
    // All dead - focus on first crawler position
    return crawlers.length > 0 ? { x: crawlers[0].x, y: crawlers[0].y } : { x: 0, y: 0 };
  }

  if (isInCombat && monsters.length > 0) {
    // Combat: center on all combatants
    const allEntities = [...livingCrawlers, ...monsters];
    const sumX = allEntities.reduce((sum, e) => sum + e.x, 0);
    const sumY = allEntities.reduce((sum, e) => sum + e.y, 0);
    return {
      x: sumX / allEntities.length,
      y: sumY / allEntities.length,
    };
  }

  // Exploration: follow lead crawler (first living)
  return { x: livingCrawlers[0].x, y: livingCrawlers[0].y };
}

export function useAutoCamera({
  crawlers,
  monsters,
  isInCombat,
  speedMultiplier,
}: UseAutoCameraOptions): UseAutoCameraResult {
  const targetFocus = useMemo(
    () => computeTargetFocus(crawlers, monsters, isInCombat),
    [crawlers, monsters, isInCombat]
  );

  const [focus, setFocus] = useState<CameraFocus>(targetFocus);
  const animationRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const startFocusRef = useRef<CameraFocus>(targetFocus);
  const currentFocusRef = useRef<CameraFocus>(targetFocus);

  // Keep currentFocusRef in sync with focus state
  currentFocusRef.current = focus;

  useEffect(() => {
    // Start lerping from current position to new target
    startTimeRef.current = performance.now();
    startFocusRef.current = { ...currentFocusRef.current };

    const animate = (now: number) => {
      const elapsed = now - (startTimeRef.current ?? now);
      const duration = LERP_DURATION_MS / speedMultiplier;
      const t = Math.min(elapsed / duration, 1);

      // Ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);

      setFocus({
        x: lerp(startFocusRef.current.x, targetFocus.x, eased),
        y: lerp(startFocusRef.current.y, targetFocus.y, eased),
      });

      if (t < 1) {
        animationRef.current = requestAnimationFrame(animate);
      }
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [targetFocus.x, targetFocus.y, speedMultiplier]);

  return { focus, targetFocus };
}
