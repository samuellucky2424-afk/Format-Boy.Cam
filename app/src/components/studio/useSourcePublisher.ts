// The single owner of the Reactor `source` slot (adapted from fxswap37).
// Every input mode only produces a MediaStreamTrack and hands it here; this
// hook is the only code that calls publish/unpublish on `source`.
import { useEffect, useRef, useState } from 'react';
import { useX2 } from '@reactor-models/x2';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function useSourcePublisher(track: MediaStreamTrack | null): string | null {
  const { publish, unpublish, status } = useX2();
  const [error, setError] = useState<string | null>(null);

  // What the producer currently wants on the wire.
  const desiredRef = useRef<MediaStreamTrack | null>(null);
  // What this hook believes is on the wire.
  const publishedRef = useRef<MediaStreamTrack | null>(null);
  // True while a reconcile loop is in flight — guarantees a single writer.
  const busyRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    desiredRef.current = track;
    if (status !== 'ready') {
      publishedRef.current = null;
      return;
    }

    const reconcile = async () => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        while (mountedRef.current && desiredRef.current !== publishedRef.current) {
          const want = desiredRef.current;
          try {
            if (want) {
              await publish('source', want);
            } else {
              await unpublish('source');
            }
            publishedRef.current = want;
            setError(null);
          } catch (e) {
            setError(errorMessage(e));
            break;
          }
        }
      } finally {
        busyRef.current = false;
      }
    };
    void reconcile();
  }, [track, status, publish, unpublish]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(
    () => () => {
      if (publishedRef.current) {
        publishedRef.current = null;
        void unpublish('source').catch(() => {});
      }
    },
    [unpublish],
  );

  return error;
}
