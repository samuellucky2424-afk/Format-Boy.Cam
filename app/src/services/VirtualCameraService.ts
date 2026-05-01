// VirtualCameraService
// Captures frames from a <video> or <canvas> element and sends them to the
// Electron main process which writes them to the Format-Boy CAM pipe publisher.
//
// Frame pipeline:
//   Canvas (RGBA) → R↔B swap in main.js → PipeFrameHeader → publisher stdin
//   → file bridge → FormatBoyVirtualCameraMF.dll → FrameServer → apps

declare global {
  interface Window {
    // Electron ipcRenderer injected when nodeIntegration is true
    require?: (module: 'electron') => { ipcRenderer: Electron.IpcRenderer };
  }
}

// Get ipcRenderer in an Electron context, or null in a browser context.
function getIpc(): Electron.IpcRenderer | null {
  try {
    if (typeof window !== 'undefined' && window.require) {
      const { ipcRenderer } = window.require('electron');
      return ipcRenderer;
    }
  } catch {
    // Not running inside Electron
  }
  return null;
}

export class VirtualCameraService {
  private _canvas: OffscreenCanvas | null = null;
  private _ctx: OffscreenCanvasRenderingContext2D | null = null;
  private _timerId: ReturnType<typeof setTimeout> | null = null;
  private _video: HTMLVideoElement | null = null;
  private _videoFrameCallbackId: number | null = null;
  private _running = false;
  private _lastFrameAt = 0;
  // Diagnostics
  private _sentFrameCount = 0;
  private _lastReportAt = 0;
  private _notReadyCount = 0;

  // Width / height of the virtual camera output (must match kDefaultWidth/Height in C++)
  static readonly WIDTH  = 1280;
  static readonly HEIGHT = 720;
  static readonly FPS    = 15;
  static readonly FRAME_INTERVAL_MS = 1000 / VirtualCameraService.FPS;

  // Legacy MediaStream capture — kept for browser/non-Electron environments
  private _stream: MediaStream | null = null;

  // ---------------------------------------------------------------------------
  // start(videoEl)
  // Begins capturing frames from the given <video> element and forwarding
  // them to the virtual camera.  Also returns a MediaStream for preview.
  // ---------------------------------------------------------------------------
  async start(video: HTMLVideoElement): Promise<MediaStream | null> {
    this.stop();
    this._video = video;

    const ipc = getIpc();
    if (ipc) {
      // Electron path — drive the pipe publisher at 30 fps
      this._canvas = new OffscreenCanvas(VirtualCameraService.WIDTH, VirtualCameraService.HEIGHT);
      this._ctx    = this._canvas.getContext('2d', { willReadFrequently: true }) as
                       OffscreenCanvasRenderingContext2D;
      this._running = true;
      this._lastFrameAt = 0;

      if (typeof video.requestVideoFrameCallback === 'function') {
        this._scheduleVideoFrame(video, ipc);
      } else {
        this._scheduleFrame(video, ipc);
      }
    } else {
      // MediaStream capture is only needed for browser/non-Electron fallback.
      const capture = video as HTMLVideoElement & {
        captureStream?: () => MediaStream;
        mozCaptureStream?: () => MediaStream;
      };
      this._stream =
        capture.captureStream?.() ||
        capture.mozCaptureStream?.() ||
        null;
    }

    return this._stream;
  }

  // ---------------------------------------------------------------------------
  // stop()
  // ---------------------------------------------------------------------------
  stop() {
    this._running = false;
    if (this._timerId !== null) {
      clearTimeout(this._timerId);
      this._timerId = null;
    }
    if (this._video && this._videoFrameCallbackId !== null && typeof this._video.cancelVideoFrameCallback === 'function') {
      this._video.cancelVideoFrameCallback(this._videoFrameCallbackId);
      this._videoFrameCallbackId = null;
    }
    if (this._stream) {
      this._stream.getTracks().forEach((t) => t.stop());
      this._stream = null;
    }
    this._canvas = null;
    this._ctx    = null;
    this._video = null;
  }

  // ---------------------------------------------------------------------------
  // _scheduleFrame — 30 fps loop that accounts for time spent rendering
  // ---------------------------------------------------------------------------
  private _scheduleFrame(video: HTMLVideoElement, ipc: Electron.IpcRenderer) {
    if (!this._running) return;

    const now     = Date.now();
    const elapsed = now - this._lastFrameAt;
    const delay   = Math.max(0, VirtualCameraService.FRAME_INTERVAL_MS - elapsed);

    this._timerId = setTimeout(() => {
      this._lastFrameAt = Date.now();
      this._captureAndSend(video, ipc);
      this._scheduleFrame(video, ipc);
    }, delay);
  }

  private _scheduleVideoFrame(video: HTMLVideoElement, ipc: Electron.IpcRenderer) {
    if (!this._running || typeof video.requestVideoFrameCallback !== 'function') {
      return;
    }

    this._videoFrameCallbackId = video.requestVideoFrameCallback(() => {
      if (!this._running) {
        return;
      }

      const now = Date.now();
      if (now - this._lastFrameAt >= VirtualCameraService.FRAME_INTERVAL_MS) {
        this._lastFrameAt = now;
        this._captureAndSend(video, ipc);
      }

      this._scheduleVideoFrame(video, ipc);
    });
  }
  // ---------------------------------------------------------------------------
  // _captureAndSend — draw one frame to OffscreenCanvas and ship it
  // ---------------------------------------------------------------------------
  private _captureAndSend(video: HTMLVideoElement, ipc: Electron.IpcRenderer) {
    if (!this._ctx || !this._canvas) return;

    if (video.readyState < 2) {
      this._notReadyCount++;
      // Surface a warning once per ~30 misses (1 s at 30 fps) so the dev
      // console makes it obvious that the source video is stalled rather
      // than silently sending nothing.
      if (this._notReadyCount % 30 === 1) {
        console.warn(
          `[VirtualCameraService] source video not ready ` +
          `(readyState=${video.readyState}, paused=${video.paused}, ` +
          `ended=${video.ended}); virtual camera will fall back to black`
        );
        // Best-effort recovery: nudge playback if it's just paused.
        if (video.paused && !video.ended) {
          video.play().catch(() => {});
        }
      }
      return;
    }
    this._notReadyCount = 0;

    try {
      // Stretch to the camera resolution (1280×720)
      this._ctx.drawImage(
        video, 0, 0,
        VirtualCameraService.WIDTH, VirtualCameraService.HEIGHT,
      );

      const imageData = this._ctx.getImageData(
        0, 0,
        VirtualCameraService.WIDTH, VirtualCameraService.HEIGHT,
      );

      // imageData.data is Uint8ClampedArray (RGBA).
      // Main process does the R↔B swap, so we send as-is.
      ipc.send('sendVirtualCameraFrame', {
        buffer: imageData.data,                // Uint8ClampedArray → Buffer in main
        width:  VirtualCameraService.WIDTH,
        height: VirtualCameraService.HEIGHT,
      });

      this._sentFrameCount++;
      const now = Date.now();
      if (this._lastReportAt === 0) this._lastReportAt = now;
      if (now - this._lastReportAt >= 5000) {
        const fps = (this._sentFrameCount * 1000) / (now - this._lastReportAt);
        console.log(
          `[VirtualCameraService] sent ${this._sentFrameCount} frames in ` +
          `${now - this._lastReportAt} ms (${fps.toFixed(1)} fps)`
        );
        this._sentFrameCount = 0;
        this._lastReportAt = now;
      }
    } catch (err) {
      // Tainted canvas or video not ready — log so it's not silent.
      console.warn('[VirtualCameraService] _captureAndSend failed:', err);
    }
  }
}

