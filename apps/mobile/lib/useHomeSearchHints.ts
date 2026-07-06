import { useEffect, useState } from 'react';
import { getHomeSearchHints, subscribeHomeSearchHints } from '@/lib/homeSearchHints';

export function useHomeSearchHints(): string[] {
  const [hints, setHints] = useState<string[]>(() => getHomeSearchHints());

  useEffect(() => subscribeHomeSearchHints(() => setHints(getHomeSearchHints())), []);

  return hints;
}
