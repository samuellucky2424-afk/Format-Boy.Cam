// Binds Henshin's own VirtualCameraService to the VISIBLE Live <video>
// (Fast: X2MainVideoView's displayed element, Pro: Stage <video>).
// Structure copied from fxswap37; the service calls are adapted to the
// Henshin API (start(video) / stop() — no setLive). The native pipeline,
// pipe publisher and IPC are 100% Henshin's.
import { useEffect, useRef, type RefObject } from 'react';
import { VirtualCameraService } from '@/services/VirtualCameraService';

function resolveVideo(host: HTMLElement | null): HTMLVideoElement | null {
  if (!host) return null;
  if (host instanceof HTMLVideoElement) return host;
  return host.querySelector('video');
}

export function useVirtualCameraCapture(
  hostRef: RefObject<HTMLElement | null> | RefObject<HTMLVideoElement | null>,
  live: boolean,
  enabled: boolean,
  sourceKey: string,
) {
  const serviceRef = useRef<VirtualCameraService | null>(null);
  const boundElRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const sync = () => {
      if (cancelled) return;
      const el = resolveVideo(hostRef.current);
      const active = live && Boolean(el);

      if (!active) {
        if (serviceRef.current) {
          serviceRef.current.stop();
          serviceRef.current = null;
          boundElRef.current = null;
        }
        return;
      }

      if (el === boundElRef.current && serviceRef.current) return;

      serviceRef.current?.stop();
      serviceRef.current = null;
      boundElRef.current = el;

      if (!el) return;
      const service = new VirtualCameraService();
      serviceRef.current = service;
      void service.start(el).catch((error) => {
        console.error('[useVirtualCameraCapture] start failed:', error);
      });
    };

    sync();
    const host = hostRef.current;
    const observer =
      host && typeof MutationObserver === 'function'
        ? new MutationObserver(sync)
        : null;
    observer?.observe(host, { childList: true, subtree: true });
    const poll = window.setInterval(sync, 1000);
    return () => {
      cancelled = true;
      observer?.disconnect();
      window.clearInterval(poll);
      serviceRef.current?.stop();
      serviceRef.current = null;
      boundElRef.current = null;
    };
  }, [enabled, hostRef, sourceKey, live]);
}
