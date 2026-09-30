import { useCallback, useLayoutEffect, useRef } from 'react';
import type { DebugCacheRawMode } from './debugCache';
import { formatBodyByRawMode } from './rawBodyFormatting';

interface BodyBeautifyOptions {
  body: string;
  rawMode: DebugCacheRawMode;
  identity: unknown;
  contentType: string;
  onFormatted: (body: string) => void;
  onFailure: () => void;
}

export function useBodyBeautify({
  body,
  rawMode,
  identity,
  contentType,
  onFormatted,
  onFailure,
}: BodyBeautifyOptions): () => Promise<void> {
  const generation = useRef(0);

  useLayoutEffect(() => {
    generation.current += 1;
    return () => {
      // Invalidate on edits, operation/mode changes, and unmount, including
      // edits that later return to the same text while the parser is loading.
      generation.current += 1;
    };
  }, [body, rawMode, identity, contentType]);

  return useCallback(async () => {
    const pendingGeneration = ++generation.current;
    const formatted = await formatBodyByRawMode(body, rawMode);
    if (generation.current !== pendingGeneration) return;
    if (formatted !== undefined) onFormatted(formatted);
    else onFailure();
  }, [body, rawMode, onFormatted, onFailure]);
}
