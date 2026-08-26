// VirtualCameraService
// Captures frames from a <video> or <canvas> element and sends them to the
// Electron main process which writes them to the Henshin pipe publisher.
//
// Frame pipeline:
//   Canvas (RGBA) → R↔B swap in main.js → PipeFrameHeader → publisher stdin
//   → file bridge → HenshinVirtualCameraMF.dll → FrameServer → apps

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
  private _running = false;
  private _lastFrameAt = 0;
  // Diagnostics
  private _sentFrameCount = 0;
  private _lastReportAt = 0;
  private _notReadyCount = 0;
  private _drawFailureCount = 0;

  // Width / height of the virtual camera output (must match kDefaultWidth/Height in C++)
  static readonly WIDTH  = 1280;
  static readonly HEIGHT = 720;
  // The Windows virtual-camera driver advertises 30 fps. Publishing at 15 fps
  // made every second frame a duplicate and produced visibly choppy output.
  static readonly FPS    = 30;
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
      // Electron path — keep the pipe publisher fed at the configured FPS.
      this._canvas = new OffscreenCanvas(VirtualCameraService.WIDTH, VirtualCameraService.HEIGHT);
      this._ctx    = this._canvas.getContext('2d', { willReadFrequently: true }) as
                       OffscreenCanvasRenderingContext2D;
      this._ctx.fillStyle = 'black';
      this._ctx.fillRect(0, 0, VirtualCameraService.WIDTH, VirtualCameraService.HEIGHT);
      this._running = true;
      this._lastFrameAt = 0;
      this._notReadyCount = 0;
      this._drawFailureCount = 0;

      this._scheduleFrame(video, ipc);
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
    if (this._stream) {
      this._stream.getTracks().forEach((t) => t.stop());
      this._stream = null;
    }
    this._canvas = null;
    this._ctx    = null;
    this._video = null;
  }

  // ---------------------------------------------------------------------------
  // _scheduleFrame — steady publisher loop that accounts for time spent rendering
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

  // ---------------------------------------------------------------------------
  // _captureAndSend — draw one frame to OffscreenCanvas and ship it
  // ---------------------------------------------------------------------------
  private _captureAndSend(video: HTMLVideoElement, ipc: Electron.IpcRenderer) {
    if (!this._ctx || !this._canvas) return;

    const videoReady =
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      video.videoWidth > 0 &&
      video.videoHeight > 0;

    if (!videoReady) {
      this._notReadyCount++;
      const warnEvery = Math.max(1, VirtualCameraService.FPS * 2);
      // Keep sending the current canvas frame so WhatsApp receives a stable
      // camera stream while the remote PRO video is warming up or recovering.
      if (this._notReadyCount % warnEvery === 1) {
        console.warn(
          `[VirtualCameraService] source video not ready ` +
          `(readyState=${video.readyState}, paused=${video.paused}, ` +
          `ended=${video.ended}); reusing last virtual camera frame`
        );
        // Best-effort recovery: nudge playback if it's just paused.
        if (video.paused && !video.ended) {
          video.play().catch(() => {});
        }
      }
    } else {
      this._notReadyCount = 0;
      try {
        // Preserve the remote frame's aspect ratio instead of stretching it.
        const scale = Math.min(
          VirtualCameraService.WIDTH / video.videoWidth,
          VirtualCameraService.HEIGHT / video.videoHeight,
        );
        const drawWidth = Math.round(video.videoWidth * scale);
        const drawHeight = Math.round(video.videoHeight * scale);
        const drawX = Math.floor((VirtualCameraService.WIDTH - drawWidth) / 2);
        const drawY = Math.floor((VirtualCameraService.HEIGHT - drawHeight) / 2);

        this._ctx.fillStyle = 'black';
        this._ctx.fillRect(0, 0, VirtualCameraService.WIDTH, VirtualCameraService.HEIGHT);
        this._ctx.drawImage(
          video,
          drawX,
          drawY,
          drawWidth,
          drawHeight,
        );
        this._drawFailureCount = 0;
      } catch (err) {
        this._drawFailureCount++;
        const warnEvery = Math.max(1, VirtualCameraService.FPS * 2);
        if (this._drawFailureCount % warnEvery === 1) {
          console.warn('[VirtualCameraService] drawImage failed; reusing last frame:', err);
        }
      }
    }

    try {
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
