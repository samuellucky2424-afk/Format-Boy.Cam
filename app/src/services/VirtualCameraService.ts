export class VirtualCameraService {
  private stream: MediaStream | null = null;

  async start(video: HTMLVideoElement): Promise<MediaStream | null> {
    const capture = video as HTMLVideoElement & {
      captureStream?: () => MediaStream;
      mozCaptureStream?: () => MediaStream;
      webkitCaptureStream?: () => MediaStream;
    };

    this.stream =
      capture.captureStream?.() ||
      capture.mozCaptureStream?.() ||
      capture.webkitCaptureStream?.() ||
      null;

    return this.stream;
  }

  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
  }
}
